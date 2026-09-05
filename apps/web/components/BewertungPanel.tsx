"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClusterStack } from "@/components/ClusterStack";
import { Karte } from "@/components/Karte";
import type { FokusregionZeile } from "@/lib/bewertung";
import type { RegionUmriss } from "@/lib/register";

const STATUS_LABEL: Record<string, string> = {
  arbeitsfassung: "Arbeitsfassung",
  eingefroren: "eingefroren",
};

/**
 * Bewertungs-Tab: Liste der Fokusregionen mit abgeleitetem Status (Left-Join
 * Region↔Lauf; fehlender Lauf = „nicht gestartet"). „Projekt starten" bietet
 * zwei Wege: bestehende Fokusregion auswaehlen oder eine neue per Karte zeichnen
 * (Weg 2 – wird erst beim Start persistiert).
 */
export function BewertungPanel({
  fokusregionen,
  regionUmrisse,
}: {
  fokusregionen: FokusregionZeile[];
  regionUmrisse: RegionUmriss[];
}) {
  const router = useRouter();
  const [modus, setModus] = useState<null | "auswahl" | "definieren">(null);
  const [auswahlRegion, setAuswahlRegion] = useState("");
  const [busy, setBusy] = useState(false);

  const ohneLauf = fokusregionen.filter((f) => !f.laufId);

  async function starteExisting(regionId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/projekte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regionId }),
      });
      if (res.ok) {
        setModus(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function starteNeu(name: string, bbox: [number, number, number, number]) {
    const res = await fetch("/api/projekte", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, bbox }),
    });
    if (res.ok) {
      setModus(null);
      router.refresh();
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Bewertung</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setModus("auswahl")}
        >
          Projekt starten
        </button>
      </div>

      {modus && (
        <div className="card">
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className={`btn${modus === "auswahl" ? " btn--primary" : ""}`}
              onClick={() => setModus("auswahl")}
            >
              Projekt auswählen
            </button>
            <button
              type="button"
              className={`btn${modus === "definieren" ? " btn--primary" : ""}`}
              onClick={() => setModus("definieren")}
            >
              Region definieren
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setModus(null)}
            >
              Schließen
            </button>
          </div>

          {modus === "auswahl" && (
            <div className="row" style={{ gap: 8 }}>
              <select
                value={auswahlRegion}
                onChange={(e) => setAuswahlRegion(e.target.value)}
              >
                <option value="">Fokusregion wählen…</option>
                {ohneLauf.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!auswahlRegion || busy}
                onClick={() => starteExisting(auswahlRegion)}
              >
                Starten
              </button>
              {!ohneLauf.length && (
                <span className="muted">
                  Alle Fokusregionen sind bereits gestartet.
                </span>
              )}
            </div>
          )}

          {modus === "definieren" && (
            <>
              <p className="hint">
                Rechteck über den gewünschten Ausschnitt ziehen, benennen und
                starten. Die Region wird erst beim Start gespeichert.
              </p>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <Karte
                  punkte={[]}
                  regionGebiet={null}
                  regionUmrisse={regionUmrisse}
                  basisStr=""
                  zeichnenAktiv
                  erstellenLabel="Projekt starten"
                  onErstellen={starteNeu}
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">Fokusregionen</div>
        <div className="table-wrap">
          <table className="register">
            <thead>
              <tr>
                <th>Fokusregion</th>
                <th>Cluster</th>
                <th>Lauf-ID</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fokusregionen.length ? (
                fokusregionen.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.name}</strong>
                    </td>
                    <td>
                      <ClusterStack verteilung={f.clusterVerteilung} />
                    </td>
                    <td className="muted">{f.laufId ?? "—"}</td>
                    <td>
                      {f.laufStatus ? (
                        <span className="pill">
                          {STATUS_LABEL[f.laufStatus] ?? f.laufStatus}
                        </span>
                      ) : (
                        <span className="pill pill--muted">nicht gestartet</span>
                      )}
                    </td>
                    <td>
                      {!f.laufId && (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => starteExisting(f.id)}
                        >
                          Projekt starten
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty">
                    Noch keine Fokusregionen. Über die Karte („Fokusregion
                    zeichnen") oder „Projekt starten → Region definieren" anlegen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
