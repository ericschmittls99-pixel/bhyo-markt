"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { sitzText } from "@/lib/akteure-modell";
import { akteureZusammenfuehren, keineDubletteAufheben, keineDubletteMarkieren } from "@/lib/dubletten-actions";
import { konflikte, type Entscheidungen, type Gewinner, type KonfliktFeld } from "@/lib/dubletten-modell";
import type { DublettenAkteur, DublettenPaar, KeineDublette } from "@/lib/dubletten";
import { fmtDatum } from "@/lib/format";

const FELD_LABEL: Record<KonfliktFeld, string> = { name: "Name", sektor: "Sektor", sitz: "Sitz" };

/**
 * Liste der moeglichen Dubletten (AP2.5 PR c): je Paar beide Akteure mit
 * Sektor, Sitz, Kreis und Zaehlern, der Grad als zurueckgenommene Pille
 * (keine Ampel), die Aehnlichkeit in Prozent (Rundung nur hier). Aktionen
 * (beide Pruefer/Admin): „keine Dublette" und „Zusammenfuehren" — Letzteres
 * oeffnet unter der Zeile die Zielwahl, die Feldkonflikte (voreingestellt
 * gewinnt das Ziel) und die Bestaetigung mit den Zahlen, die umziehen.
 * Darunter die markierten Paare mit „Markierung aufheben".
 */
export function DublettenListe({
  paare,
  markiert,
  sektoren,
  darfMarkieren,
  darfZusammenfuehren,
}: {
  paare: DublettenPaar[];
  markiert: KeineDublette[];
  sektoren: { code: string; label: string }[];
  darfMarkieren: boolean;
  darfZusammenfuehren: boolean;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function markieren(p: DublettenPaar) {
    start(async () => {
      const erg = await keineDubletteMarkieren(p.a.id, p.b.id);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Markieren fehlgeschlagen.");
        return;
      }
      setFehler(null);
      setToast(`„${p.a.name}" · „${p.b.name}" als keine Dublette markiert.`);
      router.refresh();
    });
  }

  function aufheben(m: KeineDublette) {
    start(async () => {
      const erg = await keineDubletteAufheben(m.id);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Aufheben fehlgeschlagen.");
        return;
      }
      setFehler(null);
      setToast(`Markierung „${m.a.name}" · „${m.b.name}" aufgehoben — das Paar wird wieder vorgeschlagen.`);
      router.refresh();
    });
  }

  return (
    <>
      {fehler && <p className="pf-fehler" role="alert">{fehler}</p>}
      {toast && <p className="ov-note">{toast}</p>}
      {paare.length === 0 ? (
        <p className="ov-note ak-leer-text">Keine möglichen Dubletten.</p>
      ) : (
      <table className="einst-tabelle ak-tabelle db-tabelle">
        <thead>
          <tr>
            <th>Akteur A</th>
            <th>Akteur B</th>
            <th>Ähnlichkeit</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {paare.map((p) => {
            const key = `${p.a.id}|${p.b.id}`;
            return (
              <DublettenZeile
                key={key}
                paar={p}
                sektoren={sektoren}
                offen={offen === key}
                onOeffnen={() => setOffen(offen === key ? null : key)}
                onMarkieren={() => markieren(p)}
                onFehler={setFehler}
                onFertig={(text) => {
                  setOffen(null);
                  setFehler(null);
                  setToast(text);
                  router.refresh();
                }}
                darfMarkieren={darfMarkieren}
                darfZusammenfuehren={darfZusammenfuehren}
                pending={pending}
              />
            );
          })}
        </tbody>
      </table>
      )}
      {markiert.length > 0 && (
        <section className="ov-sec ak-sec db-markiert">
          <h3>als keine dublette markiert.</h3>
          <table className="einst-tabelle ak-tabelle db-tabelle">
            <thead>
              <tr>
                <th>Akteur A</th>
                <th>Akteur B</th>
                <th>Markiert</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {markiert.map((m) => (
                <tr key={m.id}>
                  <AkteurZelle a={m.a} />
                  <AkteurZelle a={m.b} />
                  <td>{fmtDatum(m.seit.slice(0, 10))}</td>
                  <td>
                    {darfMarkieren ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => aufheben(m)} disabled={pending}>
                        Markierung aufheben
                      </button>
                    ) : (
                      <span className="c">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function AkteurZelle({ a }: { a: DublettenAkteur }) {
  return (
    <td>
      <Link href={`/akteure/${a.id}`} className="ak-link">
        <strong>{a.name}</strong>
      </Link>
      <div className="param-schluessel">{a.sektorLabel}</div>
      <div className="c">{sitzText(a)}{a.kreisName ? ` · ${a.kreisName}` : ""}</div>
      <div className="c">
        {a.stroeme} {a.stroeme === 1 ? "Strom" : "Ströme"} · {a.kontaktpersonen} {a.kontaktpersonen === 1 ? "Kontaktperson" : "Kontaktpersonen"}
      </div>
    </td>
  );
}

function DublettenZeile({
  paar,
  sektoren,
  offen,
  onOeffnen,
  onMarkieren,
  onFehler,
  onFertig,
  darfMarkieren,
  darfZusammenfuehren,
  pending,
}: {
  paar: DublettenPaar;
  sektoren: { code: string; label: string }[];
  offen: boolean;
  onOeffnen: () => void;
  onMarkieren: () => void;
  onFehler: (t: string) => void;
  onFertig: (t: string) => void;
  darfMarkieren: boolean;
  darfZusammenfuehren: boolean;
  pending: boolean;
}) {
  // Voreinstellung: Ziel ist der Akteur mit mehr Stroemen (bei Gleichstand A).
  const [zielSeite, setZielSeite] = useState<"a" | "b">(paar.b.stroeme > paar.a.stroeme ? "b" : "a");
  const [entscheidungen, setEntscheidungen] = useState<Entscheidungen>({});
  const [bestaetigt, setBestaetigt] = useState(false);
  const [laeuft, start] = useTransition();
  const ziel = zielSeite === "a" ? paar.a : paar.b;
  const quelle = zielSeite === "a" ? paar.b : paar.a;
  const felder = konflikte(ziel, quelle);
  const sektorLabel = (code: string) => sektoren.find((s) => s.code === code)?.label ?? code;
  const wert = (a: DublettenAkteur, f: KonfliktFeld) => (f === "name" ? a.name : f === "sektor" ? sektorLabel(a.sektor) : sitzText(a));

  function zusammenfuehren() {
    start(async () => {
      const erg = await akteureZusammenfuehren(quelle.id, ziel.id, entscheidungen);
      if (!erg.ok) {
        onFehler(erg.fehler ?? "Zusammenführen fehlgeschlagen.");
        return;
      }
      onFertig(`„${quelle.name}" in „${ziel.name}" zusammengeführt: ${erg.stroeme ?? 0} Strom/Ströme und ${erg.kontaktpersonen ?? 0} Kontaktperson(en) umgezogen.`);
    });
  }

  return (
    <>
      <tr>
        <AkteurZelle a={paar.a} />
        <AkteurZelle a={paar.b} />
        <td>
          <span className="ak-pillen">
            <span className={`pill ${paar.grad === "stark" ? "pill--accent" : "pill--muted"}`}>{paar.grad}</span>
            <span className="c">{Math.round(paar.aehnlichkeit * 100)} %{paar.gleicherOrt ? " · gleicher Ort" : ""}</span>
          </span>
        </td>
        <td>
          <span className="ak-pillen">
            {darfMarkieren && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onMarkieren} disabled={pending || laeuft}>
                keine Dublette
              </button>
            )}
            {darfZusammenfuehren && (
              <button type="button" className="btn btn--sm" onClick={onOeffnen} disabled={pending || laeuft} aria-expanded={offen}>
                <i className="ph ph-arrows-merge" aria-hidden />
                Zusammenführen
              </button>
            )}
          </span>
        </td>
      </tr>
      {offen && darfZusammenfuehren && (
        <tr className="db-panel-zeile">
          <td colSpan={4}>
            <div className="db-panel">
              <fieldset className="db-feld">
                <legend>Ziel (bleibt bestehen)</legend>
                {(["a", "b"] as const).map((s) => (
                  <label key={s} className="db-option">
                    <input type="radio" name={`ziel-${paar.a.id}`} checked={zielSeite === s} onChange={() => { setZielSeite(s); setEntscheidungen({}); setBestaetigt(false); }} />
                    <span>{s === "a" ? paar.a.name : paar.b.name}</span>
                  </label>
                ))}
              </fieldset>
              {felder.length > 0 && (
                <fieldset className="db-feld">
                  <legend>Feldkonflikte — voreingestellt gewinnt das Ziel</legend>
                  {felder.map((f) => (
                    <div key={f} className="db-konflikt">
                      <span className="db-konflikt-label">{FELD_LABEL[f]}</span>
                      {(["ziel", "quelle"] as Gewinner[]).map((g) => (
                        <label key={g} className="db-option">
                          <input
                            type="radio"
                            name={`${f}-${paar.a.id}`}
                            checked={(entscheidungen[f] ?? "ziel") === g}
                            onChange={() => setEntscheidungen((e) => ({ ...e, [f]: g }))}
                          />
                          <span>
                            {wert(g === "ziel" ? ziel : quelle, f)} <span className="c">({g === "ziel" ? "Ziel" : "Quelle"})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </fieldset>
              )}
              <p className="ov-note">
                Endgültig, kein Rückgängig: {quelle.stroeme} {quelle.stroeme === 1 ? "Strom/Beleg" : "Ströme/Belege"}, {quelle.kontaktpersonen}{" "}
                {quelle.kontaktpersonen === 1 ? "Kontaktperson" : "Kontaktpersonen"} und {quelle.interessen} Interesse(n) ziehen von „{quelle.name}" nach „{ziel.name}"; „{quelle.name}" wird gelöscht.
                Gesperrte Ströme anderer Personen weisen das Zusammenführen ab.
              </p>
              <div className="ak-aktionen">
                {!bestaetigt ? (
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => setBestaetigt(true)} disabled={laeuft}>
                    Zusammenführen …
                  </button>
                ) : (
                  <span className="ak-confirm">
                    <span>Wirklich zusammenführen?</span>
                    <button type="button" className="btn btn--primary btn--sm" onClick={zusammenfuehren} disabled={laeuft}>
                      Ja, endgültig zusammenführen
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBestaetigt(false)} disabled={laeuft}>
                      Abbrechen
                    </button>
                  </span>
                )}
                <button type="button" className="btn btn--ghost btn--sm" onClick={onOeffnen} disabled={laeuft}>
                  Schließen
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
