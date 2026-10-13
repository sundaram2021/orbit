import { Suspense } from "react";
import { fetchServerOrbitUser } from "@/lib/supabase-server-helpers";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata = {
  title: "Workspace overview — Orbit",
  description:
    "Your Orbit workspace: orchestrate agents, follow tasks, and explore evaluation traces.",
};

async function DashboardContent() {
  const user = await fetchServerOrbitUser();
  return <DashboardView initialUser={user} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="dash-loading">Loading workspace…</div>}>
      <DashboardContent />
    </Suspense>
  );
}
