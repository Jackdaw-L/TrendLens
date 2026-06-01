import { SettingsScreen } from "@/components/settings-screen";
import { loadRadarDataset } from "@/lib/radar-store";
import { loadSourceConfigs } from "@/lib/source-store";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [dataset, sources] = await Promise.all([loadRadarDataset(), loadSourceConfigs()]);
  return <SettingsScreen dataset={dataset} initialSources={sources} />;
}
