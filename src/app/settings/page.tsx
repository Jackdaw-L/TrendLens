import { SettingsScreen } from "@/components/settings-screen";
import { loadRadarListDataset } from "@/lib/radar-store";
import { loadSourceConfigs } from "@/lib/source-store";

export const revalidate = 180;

export default async function SettingsPage() {
  const [dataset, sources] = await Promise.all([loadRadarListDataset(), loadSourceConfigs()]);
  return <SettingsScreen dataset={dataset} initialSources={sources} />;
}
