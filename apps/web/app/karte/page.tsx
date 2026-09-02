import { Karte } from "@/components/Karte";
import { DetailPanel } from "@/components/DetailPanel";
import { FilterBar } from "@/components/FilterBar";
import { MapLegende } from "@/components/MapLegende";
import {
  getDetail,
  getRegionKreis,
  listMapPunkte,
  listMaterialarten,
  listRegionen,
  type RegisterFilter,
} from "@/lib/register";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function ersterWert(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length ? s : undefined;
}

export default async function KartePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filter: RegisterFilter = {
    regionId: ersterWert(sp.region),
    suche: ersterWert(sp.q),
    materialart: ersterWert(sp.materialart),
    qualitaet: ersterWert(sp.qualitaet),
    status: ersterWert(sp.status),
    landkreis: ersterWert(sp.landkreis),
    jahr: ersterWert(sp.jahr),
  };

  const detailId = ersterWert(sp.detail);
  const detailArt = ersterWert(sp.art) === "output" ? "output" : "biomasse";

  const [regionen, materialarten, punkte, regionKreis, detail] =
    await Promise.all([
      listRegionen(),
      listMaterialarten(),
      listMapPunkte(filter),
      filter.regionId ? getRegionKreis(filter.regionId) : Promise.resolve(null),
      detailId ? getDetail(detailArt, detailId) : Promise.resolve(null),
    ]);

  const basis = new URLSearchParams();
  if (filter.regionId) basis.set("region", filter.regionId);
  if (filter.suche) basis.set("q", filter.suche);
  if (filter.materialart) basis.set("materialart", filter.materialart);
  if (filter.qualitaet) basis.set("qualitaet", filter.qualitaet);
  if (filter.status) basis.set("status", filter.status);
  if (filter.landkreis) basis.set("landkreis", filter.landkreis);
  if (filter.jahr) basis.set("jahr", filter.jahr);
  const basisStr = basis.toString();

  return (
    <main className="app-main">
      <div className="toolbar">
        <h1>Karte</h1>
        <span className="muted">{punkte.length} Standorte</span>
      </div>

      <FilterBar
        filter={filter}
        regionen={regionen}
        materialarten={materialarten}
      />

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <Karte punkte={punkte} regionKreis={regionKreis} basisStr={basisStr} />
      </div>

      <MapLegende />

      {detail && <DetailPanel detail={detail} closeHref={`?${basisStr}`} />}
    </main>
  );
}
