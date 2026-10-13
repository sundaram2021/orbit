import { NextResponse } from "next/server";
import { createOrbitServerClient } from "@/lib/supabase-server";
import { orbitEnv } from "@/lib/env";
import { namespaceFor } from "@/lib/memory";

interface RawMemory {
  id?: string;
  memory?: string;
  content?: string | null;
  summary?: string | null;
  createdAt?: string;
  updatedAt?: string;
  spaceContainerTag?: string | null;
  isLatest?: boolean;
}

interface RawDocument {
  id?: string;
  documentId?: string;
  customId?: string | null;
  title?: string | null;
  content?: string | null;
  summary?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  memoryEntries?: RawMemory[];
  memories?: RawMemory[];
}

/** Normalize v3 documents into the shape @supermemory/memory-graph expects. */
function toGraphDocuments(raw: RawDocument[]) {
  const now = new Date().toISOString();
  return raw.map((d, i) => {
    const entries = d.memoryEntries ?? d.memories ?? [];
    return {
      id: d.id ?? d.documentId ?? d.customId ?? `doc-${i}`,
      title: d.title ?? d.customId ?? "Untitled",
      summary: d.summary ?? d.content?.slice(0, 200) ?? null,
      documentType: "text",
      createdAt: d.createdAt ?? now,
      updatedAt: d.updatedAt ?? now,
      memories: entries.map((m, j) => ({
        id: m.id ?? `mem-${i}-${j}`,
        memory: m.memory ?? m.content ?? m.summary ?? "",
        content: m.content ?? null,
        isStatic: false,
        spaceId: m.spaceContainerTag ?? "",
        isLatest: m.isLatest ?? true,
        isForgotten: false,
        forgetAfter: null,
        forgetReason: null,
        version: 1,
        parentMemoryId: null,
        rootMemoryId: null,
        createdAt: m.createdAt ?? now,
        updatedAt: m.updatedAt ?? now,
        spaceContainerTag: m.spaceContainerTag ?? null,
      })),
    };
  });
}

/**
 * Documents + memories for the user's namespace, powering the
 * @supermemory/memory-graph visualization. Key stays server-side.
 */
export async function GET() {
  const supabase = await createOrbitServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!orbitEnv.supermemoryApiKey) {
    return NextResponse.json({ documents: [], error: "supermemory not configured" });
  }

  try {
    const { fetchWithTimeout, safeJson } = await import("@/lib/fetch-utils");
    const res = await fetchWithTimeout(
      "https://api.supermemory.ai/v3/documents/documents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${orbitEnv.supermemoryApiKey}`,
        },
        body: JSON.stringify({
          page: 1,
          limit: 200,
          sort: "createdAt",
          order: "desc",
          containerTag: namespaceFor(user.id),
        }),
      },
      15000
    );
    if (!res.ok) {
      return NextResponse.json(
        { documents: [], error: `supermemory (${res.status})`, retryable: true },
        { status: 502 }
      );
    }
    const data = await safeJson<{
      documents?: RawDocument[];
      data?: { documents?: RawDocument[] };
    }>(res);
    const raw =
      data?.documents ?? data?.data?.documents ?? (Array.isArray(data) ? (data as RawDocument[]) : []);
    return NextResponse.json({ documents: toGraphDocuments(raw) });
  } catch (err) {
    return NextResponse.json(
      {
        documents: [],
        error: (err as Error).message.slice(0, 200),
        retryable: true,
      },
      { status: 502 }
    );
  }
}
