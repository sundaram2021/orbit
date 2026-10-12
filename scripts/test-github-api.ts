import { readFileSync } from "fs";
const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envRaw.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}
import { Octokit } from "@octokit/rest";
import { createServiceClient } from "../lib/supabase-service";

async function run() {
  const svc = createServiceClient();
  const { data: conns } = await svc.from("github_connections").select("*");
  const conn = conns?.[0];
  if (!conn) {
    console.log("No connection found");
    return;
  }
  console.log("Found user:", conn.user_id, "GH:", conn.github_username);
  const octokit = new Octokit({ auth: conn.provider_token });
  
  const authUser = await octokit.users.getAuthenticated();
  console.log("Auth user login:", authUser.data.login);

  // Check token scopes
  const userRes = await octokit.request("GET /user");
  console.log("Scopes:", userRes.headers["x-oauth-scopes"]);

  // 1. Check listForAuthenticatedUser
  const assigned = await octokit.issues.listForAuthenticatedUser({
    filter: "assigned",
    state: "open",
    per_page: 20,
  });
  console.log("Assigned count (listForAuthenticatedUser):", assigned.data.length);
  for (const a of assigned.data) {
    console.log(" - [list]", a.repository_url, "#" + a.number, a.title, a.pull_request ? "(PR)" : "(Issue)");
  }

  // 2. Check search for assigned issues
  const searchAssigned = await octokit.search.issuesAndPullRequests({
    q: `assignee:${authUser.data.login} is:open is:issue`,
    per_page: 20,
  });
  console.log("Search assigned issues count:", searchAssigned.data.total_count);
  for (const a of searchAssigned.data.items) {
    console.log(" - [search-issue]", a.repository_url, "#" + a.number, a.title);
  }

  // 3. Check review requested
  const searchReview = await octokit.search.issuesAndPullRequests({
    q: `review-requested:${authUser.data.login} is:open is:pr`,
    per_page: 20,
  });
  console.log("Search review requested count:", searchReview.data.total_count);
  for (const a of searchReview.data.items) {
    console.log(" - [search-review]", a.repository_url, "#" + a.number, a.title);
  }
}

run().catch(console.error);
