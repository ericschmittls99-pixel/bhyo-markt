import Link from "next/link";

import { BelegLink, QualitaetPill, StatusPill } from "@/components/Pills";
import {
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

const STATUS = ["entwurf", "in_pruefung", "geprueft", "verworfen"];

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

      <div className="card">
        <form method="get" className="field-row" style={{ marginBottom: 4 }}>
          <input type="hidden" name="tab" value={tab} />
          <div className="field">
            <label>Region</label>
            <select name="region" defaultValue={filter.regionId ?? ""}>
              <option value="">Alle Regionen</option>
              {regionen.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Suche</label>
            <input
              type="search"
              name="q"
              defaultValue={filter.suche ?? ""}
              placeholder="Quelle, Akteur, Landkreis"
            />
          </div>
          {tab === "biomasse" && (
            <div className="field">
              <label>Materialart</label>
              <select name="materialart" defaultValue={filter.materialart ?? ""}>
                <option value="">Alle</option>
                {materialarten.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Qualität</label>
            <select name="qualitaet" defaultValue={filter.qualitaet ?? ""}>
              <option value="">Alle</option>
              {["A", "B", "C", "D"].map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select name="status" defaultValue={filter.status ?? ""}>
              <option value="">Alle</option>
              {STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <label>&nbsp;</label>
            <button className="btn" type="submit">
              Filtern
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <RegisterTabelle zeilen={zeilen} tab={tab} />
      </div>
    </main>
  );
}

function RegisterTabelle({
  zeilen,
  tab,
}: {
  zeilen: RegisterZeile[];
  tab: "biomasse" | "output";
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
            <tr key={z.id}>
              <td>
                <div className="stack">
                  <strong>{z.bezeichnung ?? z.akteurName ?? "—"}</strong>
                  <span className="muted">
                    {[z.akteurName, z.ort, z.landkreis]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </div>
              </td>
              <td>{z.kategorie ?? "—"}</td>
              <td className="muted">
                {z.zeitraumVon && z.zeitraumBis
                  ? `${z.zeitraumVon} – ${z.zeitraumBis}`
                  : "—"}
              </td>
              <td>{z.menge ?? "—"}</td>
              <td>
                <QualitaetPill stufe={z.qualitaet} />
              </td>
              <td>
                <BelegLink beleg={z.beleg} />
              </td>
              <td>
                <StatusPill status={z.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
