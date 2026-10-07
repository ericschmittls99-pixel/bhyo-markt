"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { importLaufVerwerfen } from "@/lib/import-actions";

/**
 * Lauf verwerfen (AP2.7 PR g, Eric 07.10.2026): fuer einen Lauf, der nie
 * ausgefuehrt wurde — Zeilen (Zwischendaten) werden geloescht, der Lauf wird
 * „verworfen" und bleibt mit Zaehlern und Protokoll stehen. Ersteller,
 * Pruefer und Admin; Rueckfrage inline wie beim Zuruecknehmen.
 */
export function Verwerfen({ laufId, zeilen }: { laufId: string; zeilen: number }) {
  const router = useRouter();
  const [bestaetigt, setBestaetigt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function verwerfen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const erg = await importLaufVerwerfen(laufId);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Fehlgeschlagen.");
        setBestaetigt(false);
        return;
      }
      router.refresh();
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="imp-akteure">
      <header className="einst-kopf">
        <h3>verwerfen.</h3>
        <p className="c">
          Beendet diesen Lauf, ohne etwas anzulegen: {zeilen} Zeile(n) Zwischendaten werden gelöscht, der Lauf bleibt als
          „verworfen“ mit Zählern und Protokoll stehen. Ohne Aktivität verwirft der tägliche Job einen nie ausgeführten Lauf
          nach 30 Tagen von selbst.
        </p>
      </header>
      <div className="imp-aktionen">
        {!bestaetigt ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBestaetigt(true)} disabled={laeuft}>
            <i className="ph ph-trash-simple" aria-hidden />
            Lauf verwerfen …
          </button>
        ) : (
          <span className="ak-confirm">
            <span>Lauf endgültig verwerfen? Die Zeilen sind danach weg, Ströme gab es noch keine.</span>
            <button type="button" className="btn btn--primary btn--sm" onClick={verwerfen} disabled={laeuft}>
              {laeuft ? "Läuft …" : "Ja, Lauf verwerfen"}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBestaetigt(false)} disabled={laeuft}>
              Abbrechen
            </button>
          </span>
        )}
        {fehler && <span className="pf-fehler">{fehler}</span>}
      </div>
    </section>
  );
}
