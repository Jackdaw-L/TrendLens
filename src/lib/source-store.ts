import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

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
  const raw = await fs.readFile(sourceFilePath, "utf8");
  const parsed = YAML.parse(raw) as { sources?: SourceConfig[] };
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}

export async function setSourceEnabled(id: string, enabled: boolean) {
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
  const sources = await loadSourceConfigs();
  const nextSources = sources.filter((source) => source.id !== id);
  await writeSourceConfigs(nextSources);
  return nextSources;
}

async function writeSourceConfigs(sources: SourceConfig[]) {
  const content = YAML.stringify({ sources });
  await fs.writeFile(sourceFilePath, content, "utf8");
}
