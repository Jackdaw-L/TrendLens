import { getSupabaseAdminClient } from "@/lib/supabase-server";

export type JobAlert = {
  kind: "daily" | "weekly";
  scheduled_date: string;
  message: string;
};

export async function loadJobAlerts(): Promise<JobAlert[]> {
  const db = getSupabaseAdminClient();
  if (!db) return [];
  const { data, error } = await db.from("trendlens_job_alerts")
    .select("kind,scheduled_date,message").is("resolved_at", null)
    .order("scheduled_date", { ascending: false }).limit(3);
  if (error) {
    console.warn("Could not load job alerts:", error.message);
    return [];
  }
  return (data ?? []) as JobAlert[];
}
