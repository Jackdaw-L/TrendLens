import { SettingsScreen } from "@/components/settings-screen";
import { loadPendingProposals } from "@/lib/proposal-store";
import { loadRadarListDataset } from "@/lib/radar-store";
import { loadSourceConfigs } from "@/lib/source-store";
import { loadJobAlerts } from "@/lib/job-store";

export const revalidate = 180;

export default async function SettingsPage() {
  const [dataset, sources, proposals, alerts] = await Promise.all([
    loadRadarListDataset(),
    loadSourceConfigs(),
    loadPendingProposals(),
    loadJobAlerts(),
  ]);
  return <SettingsScreen dataset={dataset} initialSources={sources} initialProposals={proposals} alerts={alerts} />;
}
