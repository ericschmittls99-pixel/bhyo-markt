"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importDoppelzeileEntscheiden } from "@/lib/import-actions";

export interface DoppelzeileAnzeige {
  id: string;
  zeilennummer: number;
  von: string;
  akteur: string;
  inhalt: string;
}

/**
 * Doppelzeilen (AP2.7 PR f, Weggabelung 7, Eric 07.10.2026): exakte
 * Doppelzeilen derselben Datei stehen „aehnlich" — wie ein starker Akteur-
 * Treffer gegen den Bestand. Voreinstellung ist Ueberspringen (gesammelt
 * oder je Zeile), „trotzdem importieren" bleibt moeglich.
 */
export function Doppelzeilen({ laufId, zeilen }: { laufId: string; zeilen: DoppelzeileAnzeige[] }) {
  const router = useRouter();
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  function entscheiden(zeileId: string | null, entscheidung: "ueberspringen" | "importieren") {
    starte(async () => {
      const erg = await importDoppelzeileEntscheiden(laufId, zeileId, entscheidung);
      setMeldung(erg.ok ? null : (erg.fehler ?? "Fehlgeschlagen."));
      if (erg.ok) router.refresh();
    });
  }

  if (zeilen.length === 0) return null;
  return (
    <section className="imp-akteure">
      <header className="einst-kopf">
        <h3>doppelzeilen.</h3>
        <p className="c">
          {zeilen.length} Zeile(n) sind in allen Feldern gleich wie eine frühere Zeile derselben Datei. Voreinstellung: überspringen. Erst nach
          der Entscheidung läuft der Probelauf.
        </p>
      </header>
      <div className="imp-aktionen">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => entscheiden(null, "ueberspringen")} disabled={laeuft}>
          <i className="ph ph-skip-forward" aria-hidden />
          Alle {zeilen.length} Doppelzeile(n) überspringen
        </button>
        {meldung && <span className="pf-fehler">{meldung}</span>}
      </div>
      <table className="einst-tabelle imp-tabelle">
        <thead>
          <tr>
            <th>Zeile</th>
            <th>Akteur</th>
            <th>Inhalt</th>
            <th>Gleich wie</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.id}>
              <td className="kv--num">{z.zeilennummer}</td>
              <td>{z.akteur || "—"}</td>
              <td className="c">{z.inhalt}</td>
              <td>Zeile {z.von}</td>
              <td>
                <span className="imp-aktionen">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => entscheiden(z.id, "ueberspringen")} disabled={laeuft}>
                    Überspringen
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => entscheiden(z.id, "importieren")} disabled={laeuft}>
                    Trotzdem importieren
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
