"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importBelegDatenSetzen, importProbelauf } from "@/lib/import-actions";

/**
 * Belegdaten des Laufs und Probelauf (AP2.7 PR b, E67): Erhebungsdatum und
 * — bei den oberen vier Belegtypen (E33) — Gueltig-bis fuer den Lauf-Beleg
 * werden abgefragt, nicht geraten. Der Probelauf laeuft browser-gesteuert
 * in Stapeln von 100 Zeilen; jede Zeile geht durch die Bausteine des
 * Formulars, am Ende rollt alles zurueck — angelegt wird nichts.
 */
export function Probelauf({
  laufId,
  status,
  erhebungsdatum,
  gueltigBis,
  gueltigBisPflicht,
  ersteZeile,
  zaehler,
}: {
  laufId: string;
  status: string;
  erhebungsdatum: string | null;
  gueltigBis: string | null;
  gueltigBisPflicht: boolean;
  ersteZeile: number | null;
  zaehler: Record<string, number> | null;
}) {
  const router = useRouter();
  const [e, setE] = useState(erhebungsdatum ?? "");
  const [g, setG] = useState(gueltigBis ?? "");
  const [belegMeldung, setBelegMeldung] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();
  const [probelaufLaeuft, setProbelaufLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  const [probelaufFehler, setProbelaufFehler] = useState<string | null>(null);
  const belegdatenDa = !!erhebungsdatum && (!gueltigBisPflicht || !!gueltigBis);

  function belegdatenSpeichern() {
    starte(async () => {
      const erg = await importBelegDatenSetzen(laufId, e, g);
      if (erg.ok) {
        setBelegMeldung(null);
        router.refresh();
      } else setBelegMeldung(erg.fehler ?? Object.values(erg.feldFehler ?? {}).join(" · "));
    });
  }

  async function probelaufStarten() {
    if (ersteZeile == null) return;
    setProbelaufLaeuft(true);
    setProbelaufFehler(null);
    let ab: number | null = ersteZeile;
    let ok = 0;
    let fehler = 0;
    try {
      while (ab != null) {
        const erg = await importProbelauf(laufId, ab);
        if (!erg.ok) {
          setProbelaufFehler(erg.fehler ?? "Fehlgeschlagen.");
          break;
        }
        ok += erg.okZeilen ?? 0;
        fehler += erg.fehlerZeilen ?? 0;
        setFortschritt(`${ok + fehler} Zeile(n) geprüft — ${ok} ok, ${fehler} mit Fehler …`);
        ab = erg.naechste ?? null;
      }
    } finally {
      setProbelaufLaeuft(false);
      setFortschritt(null);
      router.refresh();
    }
  }

  return (
    <section className="imp-akteure">
      <header className="einst-kopf">
        <h3>probelauf.</h3>
        <p className="c">
          Der Lauf-Beleg (ein Beleg je Belegtyp, Quelle = Dateiname und Lauf-ID, bereinigte Kopie als Datei) braucht ein
          Erhebungsdatum{gueltigBisPflicht ? " und bei diesem Belegtyp ein Gültig-bis (E33)" : ""}. Der Probelauf prüft jede Zeile
          durch dieselben Regeln wie das Formular und legt nichts an.
        </p>
      </header>
      <div className="einst-anlegen imp-vorlage">
        <label className="pf">
          <span>Erhebungsdatum des Lauf-Belegs</span>
          <span className="pf-feld">
            <input type="date" value={e} onChange={(ev) => setE(ev.target.value)} required />
          </span>
        </label>
        <label className="pf">
          <span>Gültig bis{gueltigBisPflicht ? " (Pflicht)" : " (nur für obere Belegtypen je Zeile)"}</span>
          <span className="pf-feld">
            <input type="date" value={g} onChange={(ev) => setG(ev.target.value)} />
          </span>
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={belegdatenSpeichern} disabled={laeuft || !e}>
          <i className="ph ph-calendar-check" aria-hidden />
          Belegdaten speichern
        </button>
        {belegMeldung && <p className="pf-fehler einst-fehler">{belegMeldung}</p>}
      </div>
      <div className="imp-aktionen">
        <button type="button" className="btn btn--primary btn--sm" onClick={probelaufStarten} disabled={probelaufLaeuft || !belegdatenDa || ersteZeile == null}>
          <i className="ph ph-play" aria-hidden />
          {probelaufLaeuft ? "Probelauf läuft …" : status === "probelauf" ? "Probelauf wiederholen" : "Probelauf starten"}
        </button>
        {!belegdatenDa && <span className="c">Erst Belegdaten speichern.</span>}
        {zaehler?.probelauf_ok != null && (
          <span className="c">
            Letzter Probelauf: {zaehler.probelauf_ok} ok, {zaehler.probelauf_fehler ?? 0} mit Fehler.
          </span>
        )}
        {fortschritt && <span className="c">{fortschritt}</span>}
        {probelaufFehler && <span className="pf-fehler">{probelaufFehler}</span>}
      </div>
    </section>
  );
}
