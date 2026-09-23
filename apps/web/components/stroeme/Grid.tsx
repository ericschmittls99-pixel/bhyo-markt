"use client";

import { Foto } from "@/components/stroeme/Foto";
import { Orb } from "@/components/stroeme/Orb";
import {
  KonfidenzPill,
  StatusPillV2,
  VerfuegbarkeitsPill,
} from "@/components/stroeme/Pillen";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { fmtOutputPreis } from "@/lib/energie";
import { fmtPreis, fmtMenge, fmtZeitraum } from "@/lib/format";
import { KATEGORIE_LABEL, type Strom } from "@/lib/stroeme-modell";

const RING_UMFANG = 65.97; // 2 * PI * r bei r = 10,5

function preisText(s: Strom): string {
  if (s.art === "biomasse") {
    // Review 22.09.: auf der Karte nur der Mittelwert, kein Korridor.
    return s.preisMittel != null ? `${fmtPreis(s.preisMittel)} €/t` : "–";
  }
  // E20: erfasste Einheit nicht roh anzeigen, sondern umrechnen (€/MWh, €/t).
  return fmtOutputPreis(s.produktCode, s.preis, s.preisEinheit);
}

/** Foto-Grid von stroeme. (V2, Default-Ansicht). Klick oeffnet das Detail-Modal. */
export function Grid({ stroeme }: { stroeme: Strom[] }) {
  const { setze } = useUrlZustand();
  return (
    <div className="st-grid">
      {stroeme.map((s) => {
        const item = s.art === "biomasse" ? s.materialartLabel : s.produktLabel;
        const titel = s.akteurName ?? s.bezeichnung ?? "–";
        return (
          <button
            key={s.id}
            type="button"
            className="st-card"
            aria-label={titel}
            onClick={() => setze({ detail: s.id }, "push")}
          >
            <span className="st-card-foto">
              <Foto strom={s} groesse="lg" alt={`${item ?? ""} – Symbolbild`} />
              {item && <span className="pill-glas">{item.toLowerCase()}.</span>}
              <span className="st-card-orb">
                <Orb strom={s} size={24} />
              </span>
              <span
                className="st-card-ring"
                title={`Erfassung ${s.vollstaendigkeit} % vollständig`}
              >
                <svg
                  role="img"
                  aria-label={`Erfassung ${s.vollstaendigkeit} % vollständig`}
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10.5" fill="none" className="rest" strokeWidth="3" />
                  <circle
                    cx="12"
                    cy="12"
                    r="10.5"
                    fill="none"
                    className="anteil"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={RING_UMFANG}
                    strokeDashoffset={(RING_UMFANG * (1 - s.vollstaendigkeit / 100)).toFixed(2)}
                  />
                </svg>
              </span>
            </span>
            <span className="st-card-body">
              <span className="st-card-titel">
                <h3>{titel}</h3>
                <p>{[s.ort, s.landkreis].filter(Boolean).join(", ") || "–"}</p>
              </span>
              <span className="st-card-zeile">
                <span className="pill-wert">
                  {s.art === "biomasse"
                    ? s.mengeFm != null
                      ? `${fmtMenge(s.mengeFm)} t FM/a`
                      : "–"
                    : s.mengeWert != null
                      ? `${fmtMenge(s.mengeWert)} ${s.mengeEinheit ?? ""}`.trim()
                      : "–"}
                </span>
                <span className="st-card-neben">
                  {s.art === "biomasse"
                    ? s.mengeAtro != null
                      ? `${fmtMenge(s.mengeAtro)} t atro/a`
                      : ""
                    : (s.kategorie && KATEGORIE_LABEL[s.kategorie]) || ""}
                </span>
              </span>
              <span className="st-card-zeile">
                <span className="st-card-pillen">
                  <KonfidenzPill stufe={s.qualitaet} />
                  <StatusPillV2 status={s.status} />
                </span>
                <span className="st-card-neben">{preisText(s)}</span>
              </span>
              <span className="st-card-verf">
                {s.verfuegbarkeit && (
                  <VerfuegbarkeitsPill art={s.art} ergebnis={s.verfuegbarkeit} />
                )}
                <span>Verfügbar {fmtZeitraum(s.zeitraumVon, s.zeitraumBis)}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
