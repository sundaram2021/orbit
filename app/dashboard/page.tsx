import {
  fetchServerOrbitUser,
  fetchServerTasks,
  fetchServerActivities,
  fetchServerRepositories,
} from "@/lib/supabase-server-helpers";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata = {
  title: "Workspace overview — Orbit",
  description:
    "Your Orbit workspace: orchestrate agents, follow tasks, and explore evaluation traces.",
};

export default async function DashboardPage() {
  const [user, tasks, activities, repositories] = await Promise.all([
    fetchServerOrbitUser(),
    fetchServerTasks(),
    fetchServerActivities(),
    fetchServerRepositories(),
  ]);

  return (
    <DashboardView
      initialUser={user}
      initialTasks={tasks}
      initialActivities={activities}
      initialRepositories={repositories}
    />
  );
}
