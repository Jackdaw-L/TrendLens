import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getSupabaseAdminClient } from "@/lib/supabase-server";

export type SourceConfig = {
  id: string;
  name: string;
  url: string;
  category: string;
  language?: string;
  weight?: number;
  enabled?: boolean;
  fetch_interval?: string;
};

const sourceFilePath = path.join(process.cwd(), "sources.yaml");

export async function loadSourceConfigs(): Promise<SourceConfig[]> {
  const supabaseSources = await loadSourceConfigsFromSupabase();
  if (supabaseSources.length > 0) return supabaseSources;

  return loadSourceConfigsFromFile();
}

async function loadSourceConfigsFromFile(): Promise<SourceConfig[]> {
  const raw = await fs.readFile(sourceFilePath, "utf8");
  const parsed = YAML.parse(raw) as { sources?: SourceConfig[] };
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}

export async function setSourceEnabled(id: string, enabled: boolean) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("trendlens_sources")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (!error) {
      const sources = await loadSourceConfigsFromSupabase();
      if (sources.length > 0) return sources;
    }

    console.warn(`Failed to update TrendLens source in Supabase: ${error?.message ?? "row not found"}`);
  }

  const sources = await loadSourceConfigs();
  const nextSources = sources.map((source) =>
    source.id === id
      ? {
          ...source,
          enabled,
        }
      : source,
  );

  await writeSourceConfigs(nextSources);
  return nextSources;
}

export async function deleteSource(id: string) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("trendlens_sources").delete().eq("id", id);

    if (!error) {
      // 写墓碑：阻止流水线按 sources.yaml 增量 seed 时把删除过的信源复活。
      const { error: tombstoneError } = await supabase
        .from("trendlens_source_tombstones")
        .upsert({ id, deleted_at: new Date().toISOString() }, { onConflict: "id" });
      if (tombstoneError) {
        console.warn(`Failed to record TrendLens source tombstone: ${tombstoneError.message}`);
      }

      const sources = await loadSourceConfigsFromSupabase();
      if (sources.length > 0) return sources;
    }

    console.warn(`Failed to delete TrendLens source in Supabase: ${error?.message ?? "row not found"}`);
  }

  const sources = await loadSourceConfigs();
  const nextSources = sources.filter((source) => source.id !== id);
  await writeSourceConfigs(nextSources);
  return nextSources;
}

async function writeSourceConfigs(sources: SourceConfig[]) {
  const content = YAML.stringify({ sources });
  await fs.writeFile(sourceFilePath, content, "utf8");
}

async function loadSourceConfigsFromSupabase(): Promise<SourceConfig[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("trendlens_sources")
    .select("id,name,url,category,language,weight,enabled,fetch_interval")
    .order("name", { ascending: true });

  if (error) {
    console.warn(`Failed to load TrendLens sources from Supabase: ${error.message}`);
    return [];
  }

  return (data ?? []).map((source) => ({
    id: String(source.id),
    name: String(source.name),
    url: String(source.url),
    category: String(source.category),
    language: source.language ? String(source.language) : undefined,
    weight: source.weight == null ? undefined : Number(source.weight),
    enabled: source.enabled == null ? undefined : Boolean(source.enabled),
    fetch_interval: source.fetch_interval ? String(source.fetch_interval) : undefined,
  }));
}
