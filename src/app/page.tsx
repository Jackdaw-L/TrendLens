import { HomeScreen } from "@/components/home-screen";
import { loadRadarListDataset } from "@/lib/radar-store";

export const revalidate = 180;

export default async function Home() {
  const dataset = await loadRadarListDataset();
  return <HomeScreen dataset={dataset} />;
}
