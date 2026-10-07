"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importAkteurEntscheiden, importAkteureAufloesen, importAkteurSektorWaehlen } from "@/lib/import-actions";
import type { AkteurGruppeAnzeige } from "@/lib/import-akteure";

/**
 * Akteure eines Laufs aufloesen (AP2.7 PR b, E67): je Gruppe (Normname +
 * PLZ) das Ergebnis des Matchers — identisch uebernommen, starker Treffer als
 * Vorschlag mit Bestaetigung (einzeln oder gesammelt), sonst neuer Akteur.
 * PR f (Weggabelung 6): verschiedene Sektoren bei einem Akteur sind ein
 * Konflikt mit Pflichtentscheidung je Akteur — Auswahl aus den Werten der
 * Datei, keine stille Uebernahme des ersten.
 */
export function AkteureAufloesen({ laufId, status, gruppen, sektorLabels }: { laufId: string; status: string; gruppen: AkteurGruppeAnzeige[]; sektorLabels: Record<string, string> }) {
  const router = useRouter();
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();
  const [sektorWahl, setSektorWahl] = useState<Record<string, string>>({});
  const vorschlaege = gruppen.filter((g) => g.ergebnis === "vorschlag");
  const konflikte = gruppen.filter((g) => g.sektorKonflikt).length;
  const offeneGruppen = gruppen.filter((g) => g.ergebnis === "offen").length;

  function lauf(fn: () => Promise<{ ok?: boolean; fehler?: string }>) {
    starte(async () => {
      const erg = await fn();
      setMeldung(erg.ok ? null : (erg.fehler ?? "Fehlgeschlagen."));
      if (erg.ok) router.refresh();
    });
  }

  /** Stapelweise, bis nichts mehr offen ist — der Stand steht in den Zeilen, ein Abbruch kostet nichts. */
  function aufloesen() {
    starte(async () => {
      let erledigt = 0;
      for (;;) {
        const erg = await importAkteureAufloesen(laufId);
        if (!erg.ok) {
          setMeldung(erg.fehler ?? "Fehlgeschlagen.");
          break;
        }
        erledigt += erg.bearbeitet ?? 0;
        setFortschritt(`${erledigt} Akteur(e) geprüft, ${erg.offen ?? 0} noch offen …`);
        if (!erg.offen || !erg.bearbeitet) {
          setMeldung(null);
          break;
        }
      }
      setFortschritt(null);
      router.refresh();
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
        <button type="button" className="btn btn--primary btn--sm" onClick={aufloesen} disabled={laeuft || (status === "aufgeloest" && offeneGruppen === 0)}>
          <i className="ph ph-buildings" aria-hidden />
          {laeuft ? "Löst auf …" : status === "aufgeloest" ? "Akteure aufgelöst" : offeneGruppen > 0 && offeneGruppen < gruppen.length ? `Fortsetzen (${offeneGruppen} offen)` : "Akteure auflösen"}
        </button>
        {fortschritt && <span className="c">{fortschritt}</span>}
        {vorschlaege.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => lauf(() => importAkteurEntscheiden(laufId, null, "vorhanden"))} disabled={laeuft}>
            <i className="ph ph-checks" aria-hidden />
            Alle {vorschlaege.length} Vorschläge übernehmen
          </button>
        )}
        {konflikte > 0 && <span className="c">{konflikte} Akteur(e) mit Sektor-Konflikt — je Akteur einen Sektor wählen, sonst startet der Probelauf nicht.</span>}
        {meldung && <span className="pf-fehler">{meldung}</span>}
      </div>
      {(status === "aufgeloest" || gruppen.some((g) => g.ergebnis !== "offen" || g.sektorKonflikt)) && (
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
                  {g.sektorKonflikt && (
                    <>
                      {" "}
                      <span className="pill pill--accent">Sektor-Konflikt</span>{" "}
                      <span className="c">{g.sektoren.map((s) => sektorLabels[s] ?? s).join(" / ")}</span>
                    </>
                  )}
                </td>
                <td>
                  {g.sektorKonflikt && (
                    <span className="imp-aktionen">
                      <select value={sektorWahl[g.schluessel] ?? ""} onChange={(e) => setSektorWahl((alt) => ({ ...alt, [g.schluessel]: e.target.value }))} aria-label={`Sektor für ${g.name}`}>
                        <option value="">Sektor wählen …</option>
                        {g.sektoren.map((s) => (
                          <option key={s} value={s}>
                            {sektorLabels[s] ?? s}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => lauf(() => importAkteurSektorWaehlen(laufId, g.schluessel, sektorWahl[g.schluessel] ?? ""))} disabled={laeuft || !sektorWahl[g.schluessel]}>
                        Sektor übernehmen
                      </button>
                    </span>
                  )}
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
