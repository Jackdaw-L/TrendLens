import { SavedScreen } from "@/components/saved-screen";
import { loadRadarDataset } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const dataset = await loadRadarDataset();
  return <SavedScreen articles={dataset.articles} topics={dataset.topics} />;
}
