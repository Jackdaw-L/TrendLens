import { SavedScreen } from "@/components/saved-screen";
import { loadRadarListDataset, loadSavedArticles } from "@/lib/radar-store";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const [dataset, articles] = await Promise.all([loadRadarListDataset(), loadSavedArticles()]);
  return <SavedScreen articles={articles} topics={dataset.topics} />;
}
