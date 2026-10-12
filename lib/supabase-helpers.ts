import { createOrbitBrowserClient } from "./supabase-client";
import { OrbitTask } from "@/types/orbit-types";

export async function createBrowserTask(task: Omit<OrbitTask, "id">) {
  const supabase = createOrbitBrowserClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert([task])
    .select()
    .single();

  if (error) throw error;
  return data as OrbitTask;
}

