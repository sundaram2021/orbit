import { createOrbitServerClient } from "./supabase-server";
import { OrbitTask, OrbitActivity, OrbitRepo, OrbitUser } from "@/types/orbit-types";

export async function fetchServerOrbitUser(): Promise<OrbitUser | null> {
  try {
    const supabase = await createOrbitServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const userMetadata = user.user_metadata || {};
    return {
      id: user.id,
      email: user.email,
      name: userMetadata.full_name || userMetadata.name || userMetadata.user_name || "Alex Chen",
      avatarUrl: userMetadata.avatar_url,
      githubUsername: userMetadata.user_name || userMetadata.preferred_username || "sundaram2021",
    };
  } catch (err) {
    console.warn("Could not fetch server user:", err);
    return null;
  }
}

export async function fetchServerTasks(): Promise<OrbitTask[]> {
  try {
    const supabase = await createOrbitServerClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data as OrbitTask[];
  } catch (err) {
    console.warn("Could not fetch server tasks:", err);
    return [];
  }
}

export async function fetchServerActivities(): Promise<OrbitActivity[]> {
  try {
    const supabase = await createOrbitServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data as OrbitActivity[];
  } catch (err) {
    console.warn("Could not fetch server activities:", err);
    return [];
  }
}

export async function fetchServerRepositories(): Promise<OrbitRepo[]> {
  try {
    const supabase = await createOrbitServerClient();
    const { data, error } = await supabase
      .from("repositories")
      .select("*")
      .order("created_at", { ascending: true });

    if (error || !data) return [];
    return data as OrbitRepo[];
  } catch (err) {
    console.warn("Could not fetch server repositories:", err);
    return [];
  }
}
