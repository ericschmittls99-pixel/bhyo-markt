"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { importVorlageSpeichern, importZuordnungSpeichern } from "@/lib/import-actions";
import { IGNORIEREN, PERSON } from "@/lib/import-konstanten";
import type { Zielfeld, Zuordnung } from "@/lib/import-zuordnung";

export interface SpalteAnzeige {
  name: string;
  /** Bis zu drei Beispielwerte — fuer erkannte Personen-Spalten leer. */
  beispiele: string[];
  /** Alle verschiedenen Werte mit Haeufigkeit (fuer Code-Zielfelder) — fuer Personen-Spalten leer. */
  werte: { wert: string; anzahl: number }[];
}

export interface CodeOptionen {
  materialart: { code: string; label: string }[];
  produkt: { code: string; label: string }[];
  sektor: { code: string; label: string }[];
  beleg_typ: { code: string; label: string }[];
  menge_einheit: { code: string; label: string }[];
}

const GRUPPEN: { key: Zielfeld["gruppe"]; label: string }[] = [
  { key: "akteur", label: "Akteur" },
  { key: "strom", label: "Strom" },
  { key: "beleg", label: "Beleg" },
];

/**
 * Spalten- und Werte-Zuordnung eines Laufs (AP2.7 PR b, E67). Der Vorschlag
 * kommt vom Server (vorschlagZuordnung), der Mensch korrigiert; erkannte
 * Personen-Spalten zeigen keine Werte. Gespeichert wird nur, was zugeordnet
 * ist — die Pruefung sitzt in der Action, die Meldungen erscheinen hier.
 */
export function ZuordnungTabelle({
  laufId,
  spalten,
  zielfelder,
  vorschlag,
  werteVorschlag,
  optionen,
  vorlagen,
  aktiveVorlage,
  wahl,
}: {
  laufId: string;
  /** PR e: gewaehltes Blatt und Kopfzeile — wird mit der Zuordnung gespeichert. */
  wahl: { blatt?: string; kopfzeile?: number };
  spalten: SpalteAnzeige[];
  zielfelder: Zielfeld[];
  vorschlag: Record<string, string>;
  werteVorschlag: Record<string, Record<string, string>>;
  optionen: CodeOptionen;
  /** Gespeicherte Vorlagen; angewendet wird serverseitig ueber ?vorlage=<id> (vorlageAnwenden). */
  vorlagen: { id: string; name: string; quelle: string | null }[];
  aktiveVorlage: string | null;
}) {
  const router = useRouter();
  const [ziel, setZiel] = useState<Record<string, string>>(vorschlag);
  const [werte, setWerte] = useState<Record<string, Record<string, string>>>(werteVorschlag);
  const [meldungen, setMeldungen] = useState<string[]>([]);
  const [vorlageName, setVorlageName] = useState(aktiveVorlage ? (vorlagen.find((v) => v.id === aktiveVorlage)?.name ?? "") : "");
  const [vorlageQuelle, setVorlageQuelle] = useState(aktiveVorlage ? (vorlagen.find((v) => v.id === aktiveVorlage)?.quelle ?? "") : "");
  const [vorlageMeldung, setVorlageMeldung] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  function aktuelleZuordnung(): Zuordnung {
    const zuordnung: Zuordnung = { spalten: ziel, werte: {} };
    for (const { def } of codeZiele) zuordnung.werte[def.key] = werte[def.key] ?? {};
    return zuordnung;
  }

  function vorlageSpeichern() {
    starte(async () => {
      const erg = await importVorlageSpeichern(laufId, vorlageName, vorlageQuelle, aktuelleZuordnung());
      setVorlageMeldung(erg.ok ? `Vorlage „${vorlageName.trim()}“ gespeichert.` : (erg.fehler ?? "Speichern fehlgeschlagen."));
      if (erg.ok) router.refresh();
    });
  }
  const zielNachKey = useMemo(() => new Map(zielfelder.map((z) => [z.key, z])), [zielfelder]);

  // Code-Zielfelder, die gerade einer Spalte zugeordnet sind → Werte-Tabellen darunter.
  const codeZiele = spalten
    .map((sp) => ({ sp, def: zielNachKey.get(ziel[sp.name] ?? "") }))
    .filter((x): x is { sp: SpalteAnzeige; def: Zielfeld } => !!x.def && x.def.typ === "code" && !!x.def.werte);

  const pflichtOffen = zielfelder.filter((z) => z.pflicht && !Object.values(ziel).includes(z.key));

  function speichern() {
    const zuordnung = aktuelleZuordnung();
    starte(async () => {
      const erg = await importZuordnungSpeichern(laufId, zuordnung, wahl);
      if (erg.ok) {
        setMeldungen([]);
        router.refresh();
      } else setMeldungen(erg.fehlerListe ?? [erg.fehler ?? "Speichern fehlgeschlagen."]);
    });
  }

  return (
    <section className="imp-zuordnung">
      <header className="einst-kopf">
        <h3>spalten zuordnen.</h3>
        <p className="c">
          Jede Spalte bekommt ein Zielfeld oder wird ignoriert. Personen-Spalten (Ansprechpartner, E-Mail, Telefon …) sind
          erkannt oder werden hier markiert — ihre Inhalte werden nie übernommen.
        </p>
      </header>
      {vorlagen.length > 0 && (
        <label className="pf imp-vorlage-wahl">
          <span>Vorlage anwenden</span>
          <span className="pf-feld">
            <select
              value={aktiveVorlage ?? ""}
              onChange={(e) => router.push(e.target.value ? `/import/${laufId}?vorlage=${e.target.value}` : `/import/${laufId}`)}
            >
              <option value="">— Vorschlag aus der Kopfzeile —</option>
              {vorlagen.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.quelle ? ` (${v.quelle})` : ""}
                </option>
              ))}
            </select>
          </span>
        </label>
      )}
      <table className="einst-tabelle imp-tabelle">
        <thead>
          <tr>
            <th>Spalte</th>
            <th>Beispielwerte</th>
            <th>Zielfeld</th>
          </tr>
        </thead>
        <tbody>
          {spalten.map((sp) => {
            const z = ziel[sp.name] ?? "";
            return (
              <tr key={sp.name} className={z === PERSON ? "imp-person" : undefined}>
                <td>{sp.name}</td>
                <td className="imp-beispiele">
                  {z === PERSON ? <span className="pill pill--muted">Person – wird nicht übernommen</span> : sp.beispiele.join(" · ") || <span className="c">—</span>}
                </td>
                <td>
                  <select
                    value={z}
                    aria-label={`Zielfeld für ${sp.name}`}
                    onChange={(e) => setZiel((alt) => ({ ...alt, [sp.name]: e.target.value }))}
                  >
                    <option value="">— nicht zugeordnet (wird ignoriert) —</option>
                    <option value={IGNORIEREN}>Ignorieren</option>
                    <option value={PERSON}>Person – wird nicht übernommen</option>
                    {GRUPPEN.map((g) => (
                      <optgroup key={g.key} label={g.label}>
                        {zielfelder
                          .filter((d) => d.gruppe === g.key)
                          .map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.label}
                              {d.pflicht ? " *" : ""}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="c">
        Ohne Spalte für TS-Anteil oder Aschegehalt bleiben die Werte „unbekannt“ (Strom unvollständig, kein „geprüft“ ohne
        Ergänzung). Ohne Spalte oder Wert für den Zeitraum gilt der Zeitraum des Laufs, der vor dem Probelauf abgefragt wird.
      </p>
      {pflichtOffen.length > 0 && (
        <p className="pf-fehler">Pflichtfelder ohne Spalte: {pflichtOffen.map((z) => z.label).join(", ")} — ohne sie würde jede Zeile scheitern.</p>
      )}

      {codeZiele.map(({ sp, def }) => {
        const liste = def.werte ? optionen[def.werte] : [];
        const map = werte[def.key] ?? {};
        return (
          <div key={def.key} className="imp-werte">
            <h4>
              Werte für {def.label} <span className="c">(Spalte „{sp.name}“)</span>
            </h4>
            {sp.werte.length === 0 ? (
              <p className="c">Die Spalte ist leer.</p>
            ) : (
              <table className="einst-tabelle imp-tabelle">
                <thead>
                  <tr>
                    <th>Wert in der Datei</th>
                    <th>Zeilen</th>
                    <th>Code</th>
                  </tr>
                </thead>
                <tbody>
                  {sp.werte.map((w) => (
                    <tr key={w.wert}>
                      <td>{w.wert}</td>
                      <td className="kv--num">{w.anzahl}</td>
                      <td>
                        <select
                          value={map[w.wert] ?? ""}
                          aria-label={`Code für ${w.wert}`}
                          onChange={(e) => setWerte((alt) => ({ ...alt, [def.key]: { ...(alt[def.key] ?? {}), [w.wert]: e.target.value } }))}
                        >
                          <option value="">— nicht zugeordnet (Zeilenfehler) —</option>
                          {liste.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {meldungen.length > 0 && (
        <ul className="pf-fehler imp-meldungen">
          {meldungen.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="imp-vorlage einst-anlegen">
        <label className="pf">
          <span>Als Vorlage speichern — Name</span>
          <span className="pf-feld">
            <input type="text" value={vorlageName} onChange={(e) => setVorlageName(e.target.value)} placeholder="z. B. Landwirtschaftskammer Jahresmeldung" maxLength={120} />
          </span>
        </label>
        <label className="pf">
          <span>Herkunft der Dateien (optional)</span>
          <span className="pf-feld">
            <input type="text" value={vorlageQuelle} onChange={(e) => setVorlageQuelle(e.target.value)} placeholder="wer liefert diese Dateien" />
          </span>
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={vorlageSpeichern} disabled={laeuft || vorlageName.trim() === ""}>
          <i className="ph ph-bookmark-simple" aria-hidden />
          Vorlage speichern
        </button>
        {vorlageMeldung && <p className="c einst-fehler">{vorlageMeldung}</p>}
      </div>
      <div className="imp-aktionen">
        {/* Eric 06.10.2026: Pflichtfeld ohne Spalte (und ohne Lauf-Standard) sperrt „Weiter" — die Action prueft es noch einmal. */}
        <button type="button" className="btn btn--primary btn--sm" onClick={speichern} disabled={laeuft || pflichtOffen.length > 0}>
          <i className="ph ph-check" aria-hidden />
          {laeuft ? "Wird gespeichert …" : "Zuordnung speichern und Zeilen übernehmen"}
        </button>
        <span className="c">Danach ist der Roh-Upload gelöscht; gespeichert sind nur die zugeordneten Felder.</span>
      </div>
    </section>
  );
}
