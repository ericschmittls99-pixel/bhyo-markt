import { BewertungPanel } from "@/components/BewertungPanel";
import { listFokusregionen } from "@/lib/bewertung";
import { listRegionGebiete } from "@/lib/register";

export const dynamic = "force-dynamic";

export default async function BewertungPage() {
  const [fokusregionen, regionUmrisse] = await Promise.all([
    listFokusregionen(),
    listRegionGebiete(),
  ]);

  return (
    <main className="app-main">
      <BewertungPanel
        fokusregionen={fokusregionen}
        regionUmrisse={regionUmrisse}
      />
    </main>
  );
}
