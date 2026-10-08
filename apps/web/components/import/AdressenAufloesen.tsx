"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { importAdressenAufloesen, importPinsErmitteln } from "@/lib/import-actions";

export interface AdressStand {
  /** Neue Akteure, die einen Sitz brauchen. */
  gesamt: number;
  gefunden: number;
  offen: number;
  /** E68 PR 3: Pins im PLZ-Gebiet (ungefaehr) und davon noch nicht genau gesucht. */
  ungefaehr: number;
  genauOffen: number;
  ohneTreffer: { text: string; grund: string; zeilen: number }[];
}

/**
 * Sitz neuer Akteure (AP2.7 PR b, E68 PR 3): „Adressen zuordnen" laeuft
 * sofort lokal fuer alle Zeilen (PLZ/Ort pruefen, Pin im PLZ-Gebiet,
 * Genauigkeit plz_gebiet) — ein Aufruf, kein Netz. Befunde (unbekannte PLZ,
 * Ort passt nicht) bleiben mit „Meinten Sie …?" stehen (Nacharbeit).
 * Optional „genaue Pins ermitteln": je eindeutiger Adresse eine Anfrage an
 * den Adressdienst, eine je Sekunde, fortsetzbar, mit Fortschritt.
 */
export function AdressenAufloesen({ laufId, stand }: { laufId: string; stand: AdressStand }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  async function zuordnen(erneut = false) {
    setLaeuft(true);
    setFehler(null);
    try {
      const erg = await importAdressenAufloesen(laufId, erneut);
      if (!erg.ok) setFehler(erg.fehler ?? "Fehlgeschlagen.");
    } finally {
      setLaeuft(false);
      router.refresh();
    }
  }

  async function genauePins() {
    setLaeuft(true);
    setFehler(null);
    let bearbeitet = 0;
    let verbessert = 0;
    try {
      for (;;) {
        const erg = await importPinsErmitteln(laufId);
        if (!erg.ok) {
          setFehler(erg.fehler ?? "Fehlgeschlagen.");
          break;
        }
        bearbeitet += erg.bearbeitet ?? 0;
        verbessert += erg.verbessert ?? 0;
        setFortschritt(`${bearbeitet} Adresse(n) gesucht, ${verbessert} genauer, ${erg.offen ?? 0} noch offen …`);
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
        <h3>adressen zuordnen.</h3>
        <p className="c">
          Neue Akteure brauchen PLZ, Ort und einen Pin (E66). Die Zuordnung läuft lokal über die PLZ-Gebiete: PLZ und Ort
          werden geprüft, der Pin liegt im PLZ-Gebiet (Genauigkeit „plz-gebiet"). Passt etwas nicht, bleibt die Adresse mit
          Vorschlag stehen. „Genaue Pins ermitteln" fragt danach den Adressdienst — eine Anfrage je Sekunde, jederzeit
          fortsetzbar.
        </p>
      </header>
      <div className="imp-aktionen">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => zuordnen(false)} disabled={laeuft || stand.offen === 0}>
          <i className="ph ph-map-pin" aria-hidden />
          {laeuft ? "Läuft …" : stand.offen === 0 ? "Alle Adressen zugeordnet" : `${stand.offen} Adresse(n) zuordnen`}
        </button>
        {stand.ohneTreffer.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => zuordnen(true)} disabled={laeuft}>
            <i className="ph ph-arrow-counter-clockwise" aria-hidden />
            Erneut prüfen ({stand.ohneTreffer.length} mit Befund)
          </button>
        )}
        {stand.genauOffen > 0 && (
          <button type="button" className="btn btn--sm" onClick={genauePins} disabled={laeuft}>
            <i className="ph ph-crosshair" aria-hidden />
            Genaue Pins ermitteln ({stand.genauOffen})
          </button>
        )}
        <span className="c">
          {stand.gesamt} neue(r) Akteur(e) · {stand.gefunden} mit Pin · {stand.ungefaehr} im PLZ-Gebiet · {stand.ohneTreffer.length} mit Befund
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
