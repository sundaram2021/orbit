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

function DashboardSkeleton() {
  return (
    <main className="dashboard" aria-busy="true" aria-label="Loading workspace">
      <div className="dash-main">
        <div className="dash-content space-y-3 p-4">
          <div className="animate-pulse rounded-md bg-muted/60 h-10 w-1/3" aria-hidden="true" />
          <div className="animate-pulse rounded-md bg-muted/60 h-24 w-full" aria-hidden="true" />
          <div className="animate-pulse rounded-md bg-muted/60 h-40 w-full" aria-hidden="true" />
          <div className="animate-pulse rounded-md bg-muted/60 h-40 w-full" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
