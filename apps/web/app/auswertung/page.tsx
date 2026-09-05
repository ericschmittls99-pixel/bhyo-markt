import { FilterBar } from "@/components/FilterBar";
import { getAuswertung } from "@/lib/auswertung";
import { CLUSTER_FARBE, CLUSTER_LABEL, QUALITAET_RING } from "@/lib/farben";
import {
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

function z(n: number, dez = 0): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: dez });
}

export default async function AuswertungPage({
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
    cluster: ersterWert(sp.cluster),
  };

  const [regionen, materialarten, a] = await Promise.all([
    listRegionen(),
    listMaterialarten(filter.cluster),
    getAuswertung(filter),
  ]);

  const basis = new URLSearchParams();
  for (const [k, v] of Object.entries({
    region: filter.regionId,
    q: filter.suche,
    materialart: filter.materialart,
    qualitaet: filter.qualitaet,
    status: filter.status,
    landkreis: filter.landkreis,
    jahr: filter.jahr,
    cluster: filter.cluster,
  }))
    if (v) basis.set(k, v);
  const exportHref = `/api/auswertung/export?${basis.toString()}`;

  const matMax = Math.max(1, ...a.materialart.flatMap((m) => [m.atro, m.fm]));
  const clusterMax = Math.max(1, ...a.cluster.map((c) => c.atro));
  const jahrMax = Math.max(
    1,
    ...a.jahre.flatMap((j) => [j.datenjahr, j.erhebungsjahr]),
  );

  return (
    <main className="app-main">
      <div className="toolbar">
        <h1>Auswertung</h1>
        <a className="btn" href={exportHref}>
          Export CSV
        </a>
      </div>

      <FilterBar
        filter={filter}
        regionen={regionen}
        materialarten={materialarten}
      />

      {/* 1. KPI */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Gesamtmenge (t atro)</div>
          <div className="kpi-value">{z(a.kpi.gesamtAtro)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Anzahl Ströme</div>
          <div className="kpi-value">{a.kpi.anzahl}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Qualitätsanteil A + B</div>
          <div className="kpi-value">{a.kpi.anteilAB}&thinsp;%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Landkreise</div>
          <div className="kpi-value">{a.kpi.landkreise}</div>
        </div>
      </div>

      {/* 2. Menge nach Cluster */}
      <div className="card">
        <div className="card-title">Menge nach Cluster</div>
        <div className="stack" style={{ gap: 14 }}>
          {Object.keys(CLUSTER_LABEL).map((cl) => {
            const atro = a.cluster.find((c) => c.cluster === cl)?.atro ?? 0;
            return (
              <div key={cl}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{CLUSTER_LABEL[cl]}</strong>
                  <span className="muted">{z(atro, 1)} t atro</span>
                </div>
                <div className="bar2">
                  <div
                    className="bar2-fill"
                    style={{
                      width: `${(atro / clusterMax) * 100}%`,
                      background: CLUSTER_FARBE[cl],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Menge nach Materialart */}
      <div className="card">
        <div className="card-title">Menge nach Materialart</div>
        {a.materialart.length ? (
          <div className="stack" style={{ gap: 14 }}>
            {a.materialart.map((m) => (
              <div key={m.label}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{m.label}</strong>
                  <span className="muted">
                    {z(m.atro, 1)} t atro · {z(m.fm, 1)} t FM/a
                  </span>
                </div>
                <div className="bar2">
                  <div
                    className="bar2-fill"
                    style={{ width: `${(m.atro / matMax) * 100}%`, background: "var(--waldgruen)" }}
                    title="t atro"
                  />
                </div>
                <div className="bar2">
                  <div
                    className="bar2-fill"
                    style={{ width: `${(m.fm / matMax) * 100}%`, background: "var(--lime)" }}
                    title="t FM/a"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Keine Daten.</p>
        )}
      </div>

      {/* 3. Qualitätsverteilung */}
      <div className="card">
        <div className="card-title">Qualitätsverteilung</div>
        <div className="qbar">
          {a.qualitaet.map((q) =>
            q.anteil > 0 ? (
              <div
                key={q.stufe}
                className="qseg"
                style={{
                  width: `${q.anteil}%`,
                  background: QUALITAET_RING[q.stufe],
                  color: q.stufe === "C" || q.stufe === "D" ? "var(--navy)" : "#fff",
                }}
              >
                {q.stufe} {q.anteil}%
              </div>
            ) : null,
          )}
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="register">
            <thead>
              <tr>
                <th>Stufe</th>
                <th>Anzahl</th>
                <th>Menge (t atro)</th>
                <th>Anteil</th>
              </tr>
            </thead>
            <tbody>
              {a.qualitaet.map((q) => (
                <tr key={q.stufe}>
                  <td>Qualität {q.stufe}</td>
                  <td>{q.anzahl}</td>
                  <td>{z(q.menge, 1)}</td>
                  <td>{q.anteil}&thinsp;%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Abdeckung nach Landkreis */}
      <div className="card">
        <div className="card-title">Abdeckung nach Landkreis</div>
        <div className="table-wrap">
          <table className="register">
            <thead>
              <tr>
                <th>Landkreis</th>
                <th>Ströme</th>
                <th>t atro/a</th>
                <th>Ø-Qualität</th>
              </tr>
            </thead>
            <tbody>
              {a.landkreise.length ? (
                a.landkreise.map((l) => (
                  <tr key={l.landkreis}>
                    <td>{l.landkreis}</td>
                    <td>{l.stroeme}</td>
                    <td>{z(l.atro, 1)}</td>
                    <td>{l.qSchnitt != null ? z(l.qSchnitt, 1) : "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="muted">
                    Keine Landkreis-Daten.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">Ø-Qualität: A=1, B=2, C=3, D=4 (kleiner = besser).</p>
      </div>

      {/* 5. Zeitliche Entwicklung */}
      <div className="card">
        <div className="card-title">
          Zeitliche Entwicklung (Anzahl Ströme je Jahr)
        </div>
        {a.jahre.length ? (
          <>
            <div className="jahr-chart">
              {a.jahre.map((j) => (
                <div className="jahr-col" key={j.jahr}>
                  <div className="jahr-bars">
                    <div
                      className="jbar"
                      style={{
                        height: `${(j.datenjahr / jahrMax) * 100}%`,
                        background: "var(--navy)",
                      }}
                      title={`Datenjahr: ${j.datenjahr}`}
                    />
                    <div
                      className="jbar"
                      style={{
                        height: `${(j.erhebungsjahr / jahrMax) * 100}%`,
                        background: "var(--lime)",
                      }}
                      title={`Erhebungsjahr: ${j.erhebungsjahr}`}
                    />
                  </div>
                  <span className="m">{j.jahr}</span>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 18, marginTop: 8 }}>
              <span className="leg">
                <i style={{ background: "var(--navy)" }} /> Datenjahr (Zeitraum)
              </span>
              <span className="leg">
                <i style={{ background: "var(--lime)" }} /> Erhebungsjahr (Beleg)
              </span>
            </div>
          </>
        ) : (
          <p className="muted">Keine Daten.</p>
        )}
      </div>

      {/* 6. Zuletzt aktualisiert */}
      <div className="card">
        <div className="card-title">Zuletzt aktualisiert</div>
        {a.log.length ? (
          <ul className="historie">
            {a.log.map((h, i) => (
              <li key={i}>
                <span className="muted">
                  {h.zeitpunkt} · {h.entitaet}
                </span>
                <br />
                {h.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Noch keine Einträge.</p>
        )}
      </div>
    </main>
  );
}
