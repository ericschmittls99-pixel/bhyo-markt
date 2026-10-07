"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { importZuruecknehmen } from "@/lib/import-actions";

/**
 * Zuruecknehmen (AP2.7 PR d, E67): nur Admins, nur fuer einen ausgefuehrten
 * Lauf, nur solange kein Strom des Laufs danach bearbeitet wurde. Die
 * Rueckfrage ist inline (wie beim Zusammenfuehren), kein Browser-Dialog.
 * Der Server prueft Recht, Status und Bearbeitung noch einmal in der
 * Transaktion — die Oberflaeche blendet nur aus.
 */
export function Zuruecknehmen({ laufId, zaehler }: { laufId: string; zaehler: Record<string, number> | null }) {
  const router = useRouter();
  const [bestaetigt, setBestaetigt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const importiert = zaehler?.importiert ?? 0;

  async function zuruecknehmen() {
    setLaeuft(true);
    setFehler(null);
    try {
      const erg = await importZuruecknehmen(laufId);
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
        <h3>zurücknehmen.</h3>
        <p className="c">
          Löscht die {importiert} in diesem Lauf angelegten Ströme samt Lauf-Beleg und die dabei neu angelegten Akteure, sofern
          nichts anderes mehr auf sie verweist. Abgewiesen, sobald ein Strom des Laufs nach dem Import bearbeitet wurde — dann
          bleibt nur die Einzelpflege. Die Zeilen bleiben erhalten und werden wieder „offen“; jede Löschung steht im Protokoll.
        </p>
      </header>
      <div className="imp-aktionen">
        {!bestaetigt ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBestaetigt(true)} disabled={laeuft}>
            <i className="ph ph-arrow-counter-clockwise" aria-hidden />
            Import zurücknehmen …
          </button>
        ) : (
          <span className="ak-confirm">
            <span>Endgültig zurücknehmen? Kein Rückgängig, Backups halten die Daten noch 30 Tage.</span>
            <button type="button" className="btn btn--primary btn--sm" onClick={zuruecknehmen} disabled={laeuft}>
              {laeuft ? "Läuft …" : "Ja, Import zurücknehmen"}
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
