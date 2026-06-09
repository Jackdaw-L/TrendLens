import { HomeScreen } from "@/components/home-screen";
import { loadRadarListDataset, loadSavedArticleIds } from "@/lib/radar-store";

export const revalidate = 180;

export default async function Home() {
  const [dataset, favoriteIds] = await Promise.all([loadRadarListDataset(), loadSavedArticleIds()]);
  return <HomeScreen dataset={dataset} favoriteIds={favoriteIds} />;
}
