import { sandboxExec } from "../sandbox/tensorlake";
import { registerTool, type ToolContext } from "./registry";

const MAX_OUT = 12000;

/** Confine every file path inside the repo checkout. */
export function jailPath(workdir: string, input: string): string {
  const clean = input.trim().replace(/^\/+/, "").replace(/\0/g, "");
  if (!clean || clean === "." || /(^|\/)\.\.(\/|$)/.test(clean)) {
    throw new Error(`Path rejected (outside repo): ${input}`);
  }
  return `${workdir}/${clean}`;
}

function truncate(out: string, hint: string): string {
  if (out.length <= MAX_OUT) return out;
  return `${out.slice(0, MAX_OUT)}\n…[truncated ${out.length - MAX_OUT} chars — ${hint}]`;
}

function needSandbox(ctx: ToolContext): { sandboxId: string; workdir: string } {
  if (!ctx.sandboxId || !ctx.workdir) {
    throw new Error("No active sandbox for this agent.");
  }
  return { sandboxId: ctx.sandboxId, workdir: ctx.workdir };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function registerSandboxFileTools(): void {
  registerTool({
    name: "read_file",
    description:
      "Read a file from the repo checkout with line numbers. Use offset/limit for large files (windowed, 200 lines default).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path" },
        offset: { type: "string", description: "1-based start line (default 1)" },
        limit: { type: "string", description: "Max lines (default 200, max 500)" },
      },
      required: ["path"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { sandboxId, workdir } = needSandbox(ctx);
      const file = jailPath(workdir, input.path);
      const offset = Math.max(1, Number(input.offset ?? 1) || 1);
      const limit = Math.min(500, Math.max(1, Number(input.limit ?? 200) || 200));
      const end = offset + limit - 1;
      const total = await sandboxExec(
        { id: sandboxId, mock: false },
        `wc -l < ${shellQuote(file)}`
      );
      const body = await sandboxExec(
        { id: sandboxId, mock: false },
        `sed -n '${offset},${end}p' ${shellQuote(file)} | nl -ba -s: -v${offset} -w1`
      );
      if (body.exitCode !== 0) {
        return { ok: false, output: `Cannot read ${input.path}: ${body.stderr.slice(0, 300)}` };
      }
      const totalLines = Number(total.stdout.trim()) || 0;
      const shown = `[File: ${input.path} (${totalLines} lines, showing ${offset}–${offset + limit - 1})]\n${body.stdout}`;
      return { ok: true, output: truncate(shown, "use offset/limit to page") };
    },
  });

  registerTool({
    name: "write_file",
    description: "Create or overwrite a file in the repo checkout with the given content.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path" },
        content: { type: "string", description: "Full file content" },
      },
      required: ["path", "content"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { sandboxId, workdir } = needSandbox(ctx);
      const file = jailPath(workdir, input.path);
      // Base64 avoids all quoting pitfalls for arbitrary content.
      const b64 = Buffer.from(input.content ?? "", "utf8").toString("base64");
      const r = await sandboxExec(
        { id: sandboxId, mock: false },
        `mkdir -p $(dirname ${shellQuote(file)}) && echo ${shellQuote(b64)} | base64 -d > ${shellQuote(file)} && wc -c < ${shellQuote(file)}`
      );
      if (r.exitCode !== 0) {
        return { ok: false, output: `Write failed: ${r.stderr.slice(0, 300)}` };
      }
      return { ok: true, output: `Wrote ${input.path} (${r.stdout.trim()} bytes).` };
    },
  });

  registerTool({
    name: "edit_file",
    description:
      "Exact string replacement in a file. old must match exactly once. A syntax check runs after the edit; failures roll back automatically.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path" },
        old: { type: "string", description: "Exact text to replace (must occur exactly once)" },
        new: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old", "new"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { sandboxId, workdir } = needSandbox(ctx);
      const file = jailPath(workdir, input.path);
      const sb = { id: sandboxId, mock: false };
      const oldB64 = Buffer.from(input.old ?? "", "utf8").toString("base64");
      const newB64 = Buffer.from(input.new ?? "", "utf8").toString("base64");
      // Count occurrences first (python3 for exact matching).
      const count = await sandboxExec(
        sb,
        `python3 -c ${shellQuote(`import sys,base64;data=open(${JSON.stringify(file)},"rb").read().decode("utf-8",errors="replace");old=base64.b64decode(${JSON.stringify(oldB64)}).decode("utf-8");print(data.count(old))`)}`
      );
      const n = Number(count.stdout.trim());
      if (count.exitCode !== 0 || Number.isNaN(n)) {
        return { ok: false, output: `Edit failed: cannot read ${input.path}.` };
      }
      if (n === 0) return { ok: false, output: "Edit rejected: old text not found. Read the file first." };
      if (n > 1) {
        return { ok: false, output: `Edit rejected: old text matches ${n} times. Provide more surrounding context.` };
      }
      const applied = await sandboxExec(
        sb,
        `cp ${shellQuote(file)} ${shellQuote(file)}.orbitbak && python3 -c ${shellQuote(`import base64;f=${JSON.stringify(file)};data=open(f).read();open(f,"w").write(data.replace(base64.b64decode(${JSON.stringify(oldB64)}).decode("utf-8"),base64.b64decode(${JSON.stringify(newB64)}).decode("utf-8"),1))`)}`
      );
      if (applied.exitCode !== 0) {
        return { ok: false, output: `Edit failed: ${applied.stderr.slice(0, 300)}` };
      }
      // Lint guard with rollback.
      const lint = await lintCheck(sb, file);
      if (!lint.ok) {
        await sandboxExec(sb, `mv ${shellQuote(file + ".orbitbak")} ${shellQuote(file)}`);
        return { ok: false, output: `Edit rolled back — syntax check failed:\n${lint.output}\nDo NOT re-run the same edit.` };
      }
      await sandboxExec(sb, `rm -f ${shellQuote(file + ".orbitbak")}`);
      return { ok: true, output: `Edited ${input.path} (syntax check passed).` };
    },
  });

  registerTool({
    name: "glob",
    description: "Find files by glob pattern (e.g. src/**/*.ts). Capped at 100 results.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern relative to repo root" },
      },
      required: ["pattern"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { sandboxId, workdir } = needSandbox(ctx);
      if (input.pattern.includes("..")) {
        return { ok: false, output: "Pattern rejected." };
      }
      const r = await sandboxExec(
        { id: sandboxId, mock: false },
        `cd ${shellQuote(workdir)} && find . -path ${shellQuote("./" + input.pattern)} -not -path './node_modules/*' -not -path './.git/*' | head -100`
      );
      const lines = r.stdout.trim() ? r.stdout.trim().split("\n") : [];
      return {
        ok: true,
        output: truncate(lines.join("\n") || "(no matches)", "narrow the pattern"),
      };
    },
  });

  registerTool({
    name: "grep",
    description: "Regex search across the repo (bounded: 100 hits). Prefer this over catting large trees.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: { type: "string", description: "Subdirectory to search (default: repo root)" },
      },
      required: ["pattern"],
    },
    permission: "auto",
    handler: async (input, ctx) => {
      const { sandboxId, workdir } = needSandbox(ctx);
      const dir = input.path ? jailPath(workdir, input.path) : workdir;
      const r = await sandboxExec(
        { id: sandboxId, mock: false },
        `cd ${shellQuote(workdir)} && grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build -m5 -e ${shellQuote(input.pattern)} ${shellQuote(dir)} | head -100`
      );
      const out = r.stdout.trim() || "(no matches)";
      return { ok: true, output: truncate(out, "narrow pattern or path") };
    },
  });
}

async function lintCheck(
  sb: { id: string; mock: boolean },
  file: string
): Promise<{ ok: boolean; output: string }> {
  const q = `'${file.replace(/'/g, `'\\''`)}'`;
  if (file.endsWith(".py")) {
    const r = await sandboxExec(sb, `python3 -m py_compile ${q} 2>&1`);
    return r.exitCode === 0 ? { ok: true, output: "" } : { ok: false, output: r.stdout.slice(0, 500) };
  }
  if (/\.(mjs|cjs|js|jsx)$/.test(file)) {
    const r = await sandboxExec(sb, `node --check ${q} 2>&1`);
    return r.exitCode === 0 ? { ok: true, output: "" } : { ok: false, output: r.stdout.slice(0, 500) };
  }
  return { ok: true, output: "" };
}
