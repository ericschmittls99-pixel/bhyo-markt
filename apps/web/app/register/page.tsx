import Link from "next/link";

import { DetailPanel } from "@/components/DetailPanel";
import { FilterBar } from "@/components/FilterBar";
import { RegisterRow } from "@/components/RegisterRow";
import {
  getDetail,
  listBiomasse,
  listMaterialarten,
  listOutput,
  listRegionen,
  type RegisterZeile,
} from "@/lib/register";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function ersterWert(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length ? s : undefined;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const tab = ersterWert(sp.tab) === "output" ? "output" : "biomasse";
  const filter = {
    regionId: ersterWert(sp.region),
    suche: ersterWert(sp.q),
    materialart: ersterWert(sp.materialart),
    qualitaet: ersterWert(sp.qualitaet),
    status: ersterWert(sp.status),
    landkreis: ersterWert(sp.landkreis),
    jahr: ersterWert(sp.jahr),
    outputGruppe: ersterWert(sp.outputgruppe),
  };

  const [regionen, materialarten, zeilen] = await Promise.all([
    listRegionen(),
    listMaterialarten(),
    tab === "biomasse" ? listBiomasse(filter) : listOutput(filter),
  ]);

  const anzahl = zeilen.length;
  const summe = zeilen.reduce((acc, z) => acc + (z.mengeNum ?? 0), 0);
  const bewertet = zeilen.filter((z) => z.qualitaet);
  const anteilAB = bewertet.length
    ? Math.round(
        (bewertet.filter((z) => z.qualitaet === "A" || z.qualitaet === "B")
          .length /
          bewertet.length) *
          100,
      )
    : 0;

  // Detail-Panel: URL-getrieben ueber ?detail=<id> (im aktuellen Tab).
  const detailId = ersterWert(sp.detail);
  const detail = detailId ? await getDetail(tab, detailId) : null;

  // Basis-Query (Tab + aktive Filter), um Detail beim Oeffnen/Schliessen zu
  // setzen bzw. zu entfernen, ohne Filter/Tab zu verlieren.
  const basis = new URLSearchParams();
  basis.set("tab", tab);
  if (filter.regionId) basis.set("region", filter.regionId);
  if (filter.suche) basis.set("q", filter.suche);
  if (filter.materialart) basis.set("materialart", filter.materialart);
  if (filter.qualitaet) basis.set("qualitaet", filter.qualitaet);
  if (filter.status) basis.set("status", filter.status);
  if (filter.landkreis) basis.set("landkreis", filter.landkreis);
  if (filter.jahr) basis.set("jahr", filter.jahr);
  if (filter.outputGruppe) basis.set("outputgruppe", filter.outputGruppe);
  const basisStr = basis.toString();
  const detailHref = (id: string) => `?${basisStr}&detail=${id}`;
  const closeHref = `?${basisStr}`;

  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (filter.regionId) p.set("region", filter.regionId);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <main className="app-main">
      <div className="toolbar">
        <div className="tabs">
          <Link href={query({ tab: "biomasse" })} aria-current={tab === "biomasse"}>
            Biomasse
          </Link>
          <Link href={query({ tab: "output" })} aria-current={tab === "output"}>
            Output
          </Link>
        </div>
        <Link className="btn btn--primary" href={`/register/${tab}/neu`}>
          + Neu anlegen
        </Link>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">
            {tab === "biomasse" ? "Ströme erfasst" : "Bedarfe erfasst"}
          </div>
          <div className="kpi-value">{anzahl}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            {tab === "biomasse" ? "Summe (t atro)" : "Summe (Bedarfsmenge)"}
          </div>
          <div className="kpi-value">
            {summe.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Qualitätsanteil A + B</div>
          <div className="kpi-value">{anteilAB}&thinsp;%</div>
        </div>
      </div>

      <FilterBar
        filter={filter}
        regionen={regionen}
        materialarten={materialarten}
        hidden={{ tab }}
        kategorie={tab === "output" ? "outputgruppe" : "materialart"}
      />

      <div className="card">
        <RegisterTabelle
          zeilen={zeilen}
          tab={tab}
          detailId={detailId}
          detailHref={detailHref}
        />
      </div>

      {detail && <DetailPanel detail={detail} closeHref={closeHref} />}
    </main>
  );
}

function RegisterTabelle({
  zeilen,
  tab,
  detailId,
  detailHref,
}: {
  zeilen: RegisterZeile[];
  tab: "biomasse" | "output";
  detailId: string | undefined;
  detailHref: (id: string) => string;
}) {
  if (!zeilen.length) {
    return (
      <div className="empty">
        Noch keine {tab === "biomasse" ? "Biomasseströme" : "Output-Bedarfe"}{" "}
        erfasst. Über „Neu anlegen" den ersten Datensatz anlegen.
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="register">
        <thead>
          <tr>
            <th>Quelle / Akteur</th>
            <th>{tab === "biomasse" ? "Materialart" : "Vektor"}</th>
            <th>Zeitraum</th>
            <th>Menge</th>
            <th>Qualität</th>
            <th>Beleg</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <RegisterRow
              key={z.id}
              zeile={z}
              detailHref={detailHref(z.id)}
              aktiv={z.id === detailId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
