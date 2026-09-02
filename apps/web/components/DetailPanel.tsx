import type { ReactNode } from "react";
import Link from "next/link";

import { QualitaetPill, StatusPill } from "@/components/Pills";
import type { DetailDaten } from "@/lib/register";

const TYP_LABEL: Record<string, string> = {
  dokument_link: "Dokument/Link",
  gespraech: "Gespräch",
  angebot: "Angebot",
  absichtserklaerung: "Absichtserklärung",
  vertrag: "Vertrag",
  betriebsdaten: "Betriebsdaten",
};
const MONATE = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function Zeile({ label, wert }: { label: string; wert: ReactNode }) {
  if (wert == null || wert === "") return null;
  return (
    <div className="dl-row">
      <dt>{label}</dt>
      <dd>{wert}</dd>
    </div>
  );
}

/**
 * Read-only Detail-Panel (Spec Abschnitt 3): rechts einschwebende Ansicht eines
 * Datensatzes. Bewusst KEIN Bearbeiten-Formular – reine Anzeige inkl.
 * Aenderungshistorie. Schliessen ueber Backdrop oder ×, beides URL-getrieben.
 */
export function DetailPanel({
  detail,
  closeHref,
}: {
  detail: DetailDaten;
  closeHref: string;
}) {
  const d = detail;
  const saisonMax = d.saisonalitaet ? Math.max(1, ...d.saisonalitaet) : 1;

  return (
    <>
      <Link href={closeHref} className="detail-backdrop" aria-label="Schließen" />
      <aside className="detail-drawer" aria-label="Detailansicht">
        <div className="detail-head">
          <div className="stack">
            <span className="muted">
              {d.art === "biomasse" ? "Biomassestrom" : "Output-Bedarf"}
            </span>
            <h2>{d.bezeichnung ?? d.akteurName ?? "—"}</h2>
          </div>
          <Link className="btn btn--ghost" href={closeHref} aria-label="Schließen">
            ×
          </Link>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted">Qualität (abgeleitet):</span>
          <QualitaetPill stufe={d.qualitaet} />
          <StatusPill status={d.status} />
        </div>

        <section className="detail-sec">
          <div className="card-title">Quelle</div>
          <dl className="dl">
            <Zeile
              label="Akteur"
              wert={[d.akteurName, d.sektor].filter(Boolean).join(" · ") || null}
            />
            <Zeile label="Ort" wert={d.ort} />
            <Zeile label="Landkreis" wert={d.landkreis} />
            <Zeile label="Kontaktperson" wert={d.kontaktperson} />
          </dl>
        </section>

        <section className="detail-sec">
          <div className="card-title">
            {d.art === "biomasse" ? "Materialart & Zeitraum" : "Vektor & Zeitraum"}
          </div>
          <dl className="dl">
            <Zeile
              label={d.art === "biomasse" ? "Materialart" : "Vektor"}
              wert={d.kategorie}
            />
            <Zeile
              label="Zeitraum"
              wert={
                d.zeitraumVon && d.zeitraumBis
                  ? `${d.zeitraumVon} – ${d.zeitraumBis}`
                  : null
              }
            />
          </dl>
        </section>

        <section className="detail-sec">
          <div className="card-title">
            {d.art === "biomasse" ? "Mengen" : "Bedarf"}
          </div>
          <dl className="dl">
            {d.mengen.map((m) => (
              <Zeile key={m.label} label={m.label} wert={m.wert} />
            ))}
          </dl>
        </section>

        {d.preis && (
          <section className="detail-sec">
            <div className="card-title">Preis-Korridor</div>
            <p style={{ margin: 0 }}>{d.preis}</p>
          </section>
        )}

        {d.saisonalitaet && (
          <section className="detail-sec">
            <div className="card-title">Saisonalität (% je Monat)</div>
            <div className="saison saison--mini">
              {d.saisonalitaet.map((v, i) => (
                <div className="bar" key={i}>
                  <div
                    className="fill"
                    style={{ height: `${(v / saisonMax) * 100}%` }}
                    aria-hidden
                  />
                  <span className="m">{MONATE[i]}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="detail-sec">
          <div className="card-title">Beleg</div>
          {d.beleg ? (
            <dl className="dl">
              <Zeile label="Typ" wert={TYP_LABEL[d.beleg.typ] ?? d.beleg.typ} />
              <Zeile
                label="Quellenangabe"
                wert={
                  d.beleg.href ? (
                    <a href={d.beleg.href} target="_blank" rel="noopener noreferrer">
                      {d.beleg.quellenangabe ?? "Beleg öffnen"}
                    </a>
                  ) : (
                    d.beleg.quellenangabe
                  )
                }
              />
              <Zeile label="Erhebungsdatum" wert={d.beleg.erhebungsdatum} />
              <Zeile
                label="Extern nachvollziehbar"
                wert={d.beleg.externNachvollziehbar ? "ja" : "nein"}
              />
              {d.beleg.amtlich != null && (
                <Zeile
                  label="Amtliche Quelle"
                  wert={d.beleg.amtlich ? "ja" : "nein"}
                />
              )}
              <Zeile label="Gesprächsdatum" wert={d.beleg.gespraechsdatum} />
              <Zeile label="Gesprächspartner" wert={d.beleg.gespraechspartner} />
              <Zeile label="Nächste Verifizierung" wert={d.beleg.gueltigBis} />
            </dl>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Kein Beleg hinterlegt.
            </p>
          )}
        </section>

        <section className="detail-sec">
          <div className="card-title">Änderungshistorie</div>
          {d.historie.length ? (
            <ul className="historie">
              {d.historie.map((h, i) => (
                <li key={i}>
                  <span className="muted">{h.zeitpunkt}</span>
                  <br />
                  {h.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Noch keine Einträge.
            </p>
          )}
        </section>
      </aside>
    </>
  );
}
