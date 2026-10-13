import { cache } from "react";
import { createOrbitServerClient } from "./supabase-server";
import { OrbitTask, OrbitActivity, OrbitRepo, OrbitUser } from "@/types/orbit-types";

export const fetchServerOrbitUser = cache(async (): Promise<OrbitUser | null> => {
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
});

export const fetchServerTasks = cache(async (): Promise<OrbitTask[]> => {
  try {
    const supabase = await createOrbitServerClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,status,kind,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) return [];
    return data as unknown as OrbitTask[];
  } catch (err) {
    console.warn("Could not fetch server tasks:", err);
    return [];
  }
});

export const fetchServerActivities = cache(async (): Promise<OrbitActivity[]> => {
  try {
    const supabase = await createOrbitServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("activities")
      .select("id,title,description,type,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) return [];
    return data as unknown as OrbitActivity[];
  } catch (err) {
    console.warn("Could not fetch server activities:", err);
    return [];
  }
});

export const fetchServerRepositories = cache(async (): Promise<OrbitRepo[]> => {
  try {
    const supabase = await createOrbitServerClient();
    const { data, error } = await supabase
      .from("repositories")
      .select("id,full_name,html_url,private,updated_at")
      .order("created_at", { ascending: true })
      .limit(50);

    if (error || !data) return [];
    return data as unknown as OrbitRepo[];
  } catch (err) {
    console.warn("Could not fetch server repositories:", err);
    return [];
  }
});
