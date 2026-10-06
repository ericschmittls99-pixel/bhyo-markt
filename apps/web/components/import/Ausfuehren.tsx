"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { importAusfuehren } from "@/lib/import-actions";

/**
 * Ausfuehren (AP2.7 PR c, E67): browser-gesteuert in Stapeln von 100 Zeilen,
 * fortsetzbar ueber die naechste Zeilennummer. Jeder Stapel wird einzeln
 * festgeschrieben; ein Abbruch laesst die bisherigen Stapel stehen.
 */
export function Ausfuehren({ laufId, status, ersteZeile, zaehler }: { laufId: string; status: string; ersteZeile: number | null; zaehler: Record<string, number> | null }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const probelaufFehler = zaehler?.probelauf_fehler ?? 0;

  async function starten() {
    if (ersteZeile == null) return;
    setLaeuft(true);
    setFehler(null);
    let ab: number | null = ersteZeile;
    let importiert = 0;
    let fehlerZeilen = 0;
    try {
      while (ab != null) {
        const erg = await importAusfuehren(laufId, ab);
        if (!erg.ok) {
          setFehler(erg.fehler ?? "Fehlgeschlagen.");
          break;
        }
        importiert += erg.importiert ?? 0;
        fehlerZeilen += erg.fehlerZeilen ?? 0;
        setFortschritt(`${importiert} Ströme angelegt, ${fehlerZeilen} Zeile(n) mit Fehler …`);
        ab = erg.naechste ?? null;
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
        <h3>ausführen.</h3>
        <p className="c">
          Legt die offenen Zeilen als Ströme an (Status Entwurf, ungeprüft), neue Akteure einmal je Akteur, den Lauf-Beleg
          einmal je Belegtyp. Zeilen mit Fehler bleiben in der Nacharbeit; alle aktiven Prüfer und Admins bekommen einen
          Inbox-Eintrag zum Lauf.
          {probelaufFehler > 0 ? ` Der Probelauf meldete ${probelaufFehler} Zeile(n) mit Fehler — sie werden übersprungen und bleiben in der Nacharbeit.` : ""}
        </p>
      </header>
      <div className="imp-aktionen">
        <button type="button" className="btn btn--primary btn--sm" onClick={starten} disabled={laeuft || status !== "probelauf" || ersteZeile == null}>
          <i className="ph ph-rocket-launch" aria-hidden />
          {laeuft ? "Läuft …" : ersteZeile == null ? "Keine offene Zeile" : "Import ausführen"}
        </button>
        {fortschritt && <span className="c">{fortschritt}</span>}
        {fehler && <span className="pf-fehler">{fehler}</span>}
      </div>
    </section>
  );
}
