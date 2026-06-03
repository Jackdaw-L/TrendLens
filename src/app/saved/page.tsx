import { SavedScreen } from "@/components/saved-screen";
import { loadRadarListDataset } from "@/lib/radar-store";

export const revalidate = 180;

export default async function SavedPage() {
  const dataset = await loadRadarListDataset();
  return <SavedScreen articles={dataset.articles} topics={dataset.topics} />;
}
