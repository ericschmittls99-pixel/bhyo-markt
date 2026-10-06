"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importAkteurEntscheiden, importAkteureAufloesen } from "@/lib/import-actions";
import type { AkteurGruppeAnzeige } from "@/lib/import-akteure";

/**
 * Akteure eines Laufs aufloesen (AP2.7 PR b, E67): je Gruppe (Normname +
 * PLZ) das Ergebnis des Matchers — identisch uebernommen, starker Treffer als
 * Vorschlag mit Bestaetigung (einzeln oder gesammelt), sonst neuer Akteur.
 */
export function AkteureAufloesen({ laufId, status, gruppen }: { laufId: string; status: string; gruppen: AkteurGruppeAnzeige[] }) {
  const router = useRouter();
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();
  const vorschlaege = gruppen.filter((g) => g.ergebnis === "vorschlag");

  function lauf(fn: () => Promise<{ ok?: boolean; fehler?: string }>) {
    starte(async () => {
      const erg = await fn();
      setMeldung(erg.ok ? null : (erg.fehler ?? "Fehlgeschlagen."));
      if (erg.ok) router.refresh();
    });
  }

  return (
    <section className="imp-akteure">
      <header className="einst-kopf">
        <h3>akteure auflösen.</h3>
        <p className="c">
          Je eindeutigem Akteur (Name und PLZ) einmal: identisch wird übernommen, ein starker Treffer wartet auf Bestätigung,
          sonst wird der Akteur beim Ausführen neu angelegt.
        </p>
      </header>
      <div className="imp-aktionen">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => lauf(() => importAkteureAufloesen(laufId))} disabled={laeuft}>
          <i className="ph ph-buildings" aria-hidden />
          {status === "aufgeloest" ? "Erneut auflösen" : "Akteure auflösen"}
        </button>
        {vorschlaege.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => lauf(() => importAkteurEntscheiden(laufId, null, "vorhanden"))} disabled={laeuft}>
            <i className="ph ph-checks" aria-hidden />
            Alle {vorschlaege.length} Vorschläge übernehmen
          </button>
        )}
        {meldung && <span className="pf-fehler">{meldung}</span>}
      </div>
      {status === "aufgeloest" && (
        <table className="einst-tabelle imp-tabelle">
          <thead>
            <tr>
              <th>Akteur in der Datei</th>
              <th>Sitz</th>
              <th>Zeilen</th>
              <th>Ergebnis</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {gruppen.map((g) => (
              <tr key={g.schluessel}>
                <td>{g.name}</td>
                <td>{[g.plz, g.ort].filter(Boolean).join(" ") || "—"}</td>
                <td className="kv--num">{g.zeilenIds.length}</td>
                <td>
                  {g.ergebnis === "identisch" && g.akteurId && (
                    <>
                      <span className="pill pill--accent">identisch</span> <Link href={`/akteure/${g.akteurId}`}>vorhandener Akteur</Link>
                    </>
                  )}
                  {g.ergebnis === "vorschlag" && (
                    <>
                      <span className="pill pill--accent">stark</span> {g.vorschlagName}
                      {g.vorschlagId && (
                        <>
                          {" "}
                          <Link href={`/akteure/${g.vorschlagId}`}>ansehen</Link>
                        </>
                      )}
                    </>
                  )}
                  {g.ergebnis === "neu" && <span className="pill pill--muted">neuer Akteur</span>}
                  {g.ergebnis === "offen" && <span className="pill pill--muted">offen</span>}
                </td>
                <td>
                  {g.ergebnis === "vorschlag" && (
                    <span className="imp-aktionen">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => lauf(() => importAkteurEntscheiden(laufId, g.schluessel, "vorhanden"))} disabled={laeuft}>
                        Übernehmen
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => lauf(() => importAkteurEntscheiden(laufId, g.schluessel, "neu"))} disabled={laeuft}>
                        Neu anlegen
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
