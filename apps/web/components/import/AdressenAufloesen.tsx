"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { importAdressenAufloesen } from "@/lib/import-actions";

export interface AdressStand {
  /** Neue Akteure, die einen Sitz brauchen. */
  gesamt: number;
  gefunden: number;
  offen: number;
  ohneTreffer: { text: string; grund: string; zeilen: number }[];
}

/**
 * Sitz neuer Akteure per Adresssuche (AP2.7 PR b, E67): der Browser ruft
 * die Action stapelweise, bis nichts mehr offen ist — fortsetzbar, der Stand
 * steht in den Zeilen. Ohne eindeutigen Treffer bleibt die Adresse mit Grund
 * stehen (Nacharbeit).
 */
export function AdressenAufloesen({ laufId, stand }: { laufId: string; stand: AdressStand }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function starten(erneut = false) {
    setLaeuft(true);
    setFehler(null);
    let erledigt = 0;
    try {
      for (let erster = true; ; erster = false) {
        const erg = await importAdressenAufloesen(laufId, erneut && erster);
        if (!erg.ok) {
          setFehler(erg.fehler ?? "Fehlgeschlagen.");
          break;
        }
        erledigt += erg.bearbeitet ?? 0;
        setFortschritt(`${erledigt} Adresse(n) gesucht, ${erg.offen ?? 0} noch offen …`);
        if (!erg.offen || !erg.bearbeitet) break;
      }
    } finally {
      setLaeuft(false);
      setFortschritt(null);
      router.refresh();
    }
  }

  return (
    <section className="imp-akteure">
      <header className="einst-kopf">
        <h3>adressen auflösen.</h3>
        <p className="c">
          Neue Akteure brauchen PLZ, Ort und einen Pin (E66). Die Adresssuche läuft je eindeutiger Adresse einmal, in
          kleinen Stapeln; ohne eindeutigen Treffer bleibt die Adresse offen und die Zeilen gehen in die Nacharbeit.
        </p>
      </header>
      <div className="imp-aktionen">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => starten(false)} disabled={laeuft || stand.offen === 0}>
          <i className="ph ph-map-pin" aria-hidden />
          {laeuft ? "Sucht …" : stand.offen === 0 ? "Alle Adressen bearbeitet" : `${stand.offen} Adresse(n) suchen`}
        </button>
        {stand.ohneTreffer.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => starten(true)} disabled={laeuft}>
            <i className="ph ph-arrow-counter-clockwise" aria-hidden />
            Erneut suchen ({stand.ohneTreffer.length} ohne Treffer)
          </button>
        )}
        <span className="c">
          {stand.gesamt} neue(r) Akteur(e) · {stand.gefunden} mit Pin · {stand.ohneTreffer.length} ohne eindeutigen Treffer
        </span>
        {fortschritt && <span className="c">{fortschritt}</span>}
        {fehler && <span className="pf-fehler">{fehler}</span>}
      </div>
      {stand.ohneTreffer.length > 0 && (
        <table className="einst-tabelle imp-tabelle">
          <thead>
            <tr>
              <th>Adresse in der Datei</th>
              <th>Zeilen</th>
              <th>Befund</th>
            </tr>
          </thead>
          <tbody>
            {stand.ohneTreffer.map((o) => (
              <tr key={o.text + o.grund}>
                <td>{o.text || "—"}</td>
                <td className="kv--num">{o.zeilen}</td>
                <td className="c">{o.grund}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
