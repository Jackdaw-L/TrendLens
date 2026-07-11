import { SettingsScreen } from "@/components/settings-screen";
import { loadPendingProposals } from "@/lib/proposal-store";
import { loadRadarListDataset } from "@/lib/radar-store";
import { loadSourceConfigs } from "@/lib/source-store";

export const revalidate = 180;

export default async function SettingsPage() {
  const [dataset, sources, proposals] = await Promise.all([
    loadRadarListDataset(),
    loadSourceConfigs(),
    loadPendingProposals(),
  ]);
  return <SettingsScreen dataset={dataset} initialSources={sources} initialProposals={proposals} />;
}
