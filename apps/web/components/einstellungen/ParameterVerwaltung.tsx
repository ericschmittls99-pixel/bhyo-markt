"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/Avatar";
import { fmtDatum, fmtDatumZeit } from "@/lib/format";
import { einheitLabel, istSeitEinfuehrung, SEIT_EINFUEHRUNG, wertMitEinheit } from "@/lib/parameter";
import { parameterSetzen, parameterZuruecknehmen } from "@/lib/parameter-actions";
import type { ParameterUebersicht, VerlaufZeile } from "@/lib/parameter-server";

/**
 * Reiter „Parameter" (AP2.3 PR a, E60): je Parameter der heute geltende Wert
 * mit „gilt seit", geplante Änderungen mit „Zurücknehmen", „Ändern" als
 * Dialog (Wert, gültig ab, Begründung) und der aufklappbare Verlauf. Die
 * tragenden Regeln sitzen in den Aktionen und in der Datenbank (CHECK,
 * Trigger); die Oberfläche prüft nur vorab.
 */
export function ParameterVerwaltung({ parameter, heute }: { parameter: ParameterUebersicht[]; heute: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ParameterUebersicht | null>(null);
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<Record<string, string>>({});

  const gruppen = [...new Set(parameter.map((p) => p.gruppe))];

  function zuruecknehmen(p: ParameterUebersicht, z: VerlaufZeile) {
    starte(async () => {
      const r = await parameterZuruecknehmen(z.id);
      setFehler((alt) => ({ ...alt, [p.schluessel]: r.ok ? "" : (r.fehler ?? "Zurücknehmen fehlgeschlagen.") }));
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="einst-inhalt">
      {gruppen.map((g) => (
        <section key={g} className="param-gruppe">
          <header className="einst-kopf">
            <h2>{g.toLowerCase()}.</h2>
            <p className="c">
              Eine Änderung gilt ab einem Datum, nie rückwirkend. Der alte Wert bleibt im Verlauf; nur eine geplante
              Änderung lässt sich zurücknehmen.
            </p>
          </header>
          <table className="einst-tabelle param-tabelle">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Aktueller Wert</th>
                <th>Gilt seit</th>
                <th>Geplant</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {parameter
                .filter((p) => p.gruppe === g)
                .map((p) => (
                  <ParameterZeile
                    key={p.schluessel}
                    p={p}
                    fehler={fehler[p.schluessel]}
                    laeuft={laeuft}
                    onAendern={() => setDialog(p)}
                    onZuruecknehmen={(z) => zuruecknehmen(p, z)}
                  />
                ))}
            </tbody>
          </table>
        </section>
      ))}

      {dialog && (
        <AendernDialog
          p={dialog}
          heute={heute}
          onSchliessen={() => setDialog(null)}
          onFertig={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ParameterZeile({
  p,
  fehler,
  laeuft,
  onAendern,
  onZuruecknehmen,
}: {
  p: ParameterUebersicht;
  fehler?: string;
  laeuft: boolean;
  onAendern: () => void;
  onZuruecknehmen: (z: VerlaufZeile) => void;
}) {
  const [verlaufOffen, setVerlaufOffen] = useState(false);
  return (
    <>
      <tr>
        <td>
          <strong>{p.bezeichnung}</strong>
          <div className="param-schluessel">{p.schluessel}</div>
        </td>
        <td className="param-wert">{wertMitEinheit(p.aktuell, p.einheit)}</td>
        <td>{istSeitEinfuehrung(p.aktuellSeit) ? SEIT_EINFUEHRUNG : fmtDatum(p.aktuellSeit)}</td>
        <td>
          {p.geplant.length === 0 ? (
            <span className="c">—</span>
          ) : (
            <ul className="param-geplant">
              {p.geplant.map((z) => (
                <li key={z.id}>
                  <span>
                    ab {fmtDatum(z.gueltigAb)}: {wertMitEinheit(z.wert, p.einheit)}
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={laeuft} onClick={() => onZuruecknehmen(z)}>
                    Zurücknehmen
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fehler && <p className="pf-fehler">{fehler}</p>}
        </td>
        <td className="param-aktionen">
          <button type="button" className="btn btn--sm" onClick={onAendern}>
            Ändern
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-expanded={verlaufOffen}
            onClick={() => setVerlaufOffen((v) => !v)}
          >
            Verlauf
            <i className={`ph-bold ph-caret-${verlaufOffen ? "up" : "down"}`} aria-hidden />
          </button>
        </td>
      </tr>
      {verlaufOffen && (
        <tr className="param-verlauf-zeile">
          <td colSpan={5}>
            <table className="param-verlauf">
              <thead>
                <tr>
                  <th>Wert</th>
                  <th>Gültig ab</th>
                  <th>Von</th>
                  <th>Am</th>
                  <th>Begründung</th>
                </tr>
              </thead>
              <tbody>
                {p.verlauf.map((z) => (
                  <tr key={z.id}>
                    <td>{wertMitEinheit(z.wert, p.einheit)}</td>
                    <td>{istSeitEinfuehrung(z.gueltigAb) ? SEIT_EINFUEHRUNG : fmtDatum(z.gueltigAb)}</td>
                    <td>
                      {z.erstelltVon ? (
                        <span className="einst-avatar">
                          <Avatar nutzer={z.erstelltVon} groesse="s" />
                          {z.erstelltVon.name ?? z.erstelltVon.email}
                        </span>
                      ) : (
                        <span className="c">Migration</span>
                      )}
                    </td>
                    <td>{istSeitEinfuehrung(z.gueltigAb) ? "—" : fmtDatumZeit(z.erstelltAm)}</td>
                    <td className="param-begruendung">{z.begruendung}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function AendernDialog({
  p,
  heute,
  onSchliessen,
  onFertig,
}: {
  p: ParameterUebersicht;
  heute: string;
  onSchliessen: () => void;
  onFertig: () => void;
}) {
  const [status, action, laeuft] = useActionState(parameterSetzen, { ok: false });
  useEffect(() => {
    if (status.ok) onFertig();
  }, [status.ok, onFertig]);
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onSchliessen();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSchliessen]);

  return (
    <div className="modal-scrim" role="presentation" onClick={onSchliessen}>
      <form
        action={action}
        role="dialog"
        aria-modal="true"
        aria-label={`${p.bezeichnung} ändern`}
        className="modal param-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{p.bezeichnung.toLowerCase()} ändern.</h2>
        <p className="c">{p.beschreibung}</p>
        <input type="hidden" name="schluessel" value={p.schluessel} />
        <label className="pf">
          <span>
            Neuer Wert ({p.min} bis {p.max} {einheitLabel(p.einheit)})
          </span>
          <span className="pf-feld">
            <input type="number" name="wert" min={p.min} max={p.max} step={1} defaultValue={p.aktuell} required />
          </span>
        </label>
        <label className="pf">
          <span>Gültig ab</span>
          <span className="pf-feld">
            <input type="date" name="gueltig_ab" min={heute} defaultValue={heute} required />
          </span>
        </label>
        <label className="pf">
          <span>Begründung</span>
          <span className="pf-feld">
            <textarea name="begruendung" rows={3} required placeholder="Warum ändert sich der Wert?" />
          </span>
        </label>
        <p className="param-hinweis">
          <i className="ph ph-info" aria-hidden />
          Gilt für Einträge mit Stichtag ab diesem Datum. Bestehende Fälligkeiten bleiben unverändert.
        </p>
        {status.fehler && <p className="pf-fehler">{status.fehler}</p>}
        <div className="modal-aktionen">
          <button type="button" className="btn btn--sm" onClick={onSchliessen} disabled={laeuft}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--sm btn--primary" disabled={laeuft}>
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}
