"use client";

/**
 * AP2.9 (E76): Schalter fuer die eigene Roundup-Mail (Werktage 07:07, nur
 * wenn seit dem letzten Roundup etwas Neues da ist). Ziel der Fusszeile in
 * der Mail (#roundup). Die Pruefung sitzt in der Aktion; hier nur die Anzeige.
 */
import { useState, useTransition } from "react";

import { roundupSetzen } from "@/lib/benutzer-actions";
import { testversandAnMich } from "@/lib/mail-actions";

/**
 * AP2.9 Umschalten: `testversand` blendet den Knopf nur ein, wenn der angemeldete Admin die
 * hinterlegte Testadresse ist — die tragende Pruefung sitzt in der Aktion (mail.testversand).
 */
export function RoundupEinstellung({ an, testversand = false }: { an: boolean; testversand?: boolean }) {
  const [wert, setWert] = useState(an);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [testErgebnis, setTestErgebnis] = useState<string | null>(null);
  const [testFehler, setTestFehler] = useState<string | null>(null);
  const [testLaeuft, starteTest] = useTransition();
  return (
    <section className="einst-roundup" id="roundup" aria-labelledby="roundup-titel">
      <h2 id="roundup-titel">tages-mail.</h2>
      <label className="fp-toggle">
        <input
          type="checkbox"
          checked={wert}
          disabled={pending}
          onChange={(e) => {
            const neu = e.target.checked;
            setWert(neu);
            start(async () => {
              const erg = await roundupSetzen(neu);
              if (!erg.ok) {
                setWert(!neu);
                setFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
              } else setFehler(null);
            });
          }}
        />
        <span className="fp-toggle-text">
          <span>Tages-Mail aus der Inbox</span>
          <span className="c">An Werktagen um 07:07 Uhr, nur wenn seit dem letzten Roundup neue Hinweise in deiner Inbox liegen. Die Mail nennt Zähler je Typ und einen Link, keine Inhalte.</span>
        </span>
      </label>
      {fehler && <p className="pf-fehler einst-fehler">{fehler}</p>}
      {testversand && (
        <div className="einst-testversand">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={testLaeuft}
            onClick={() =>
              starteTest(async () => {
                const erg = await testversandAnMich();
                if (!erg.ok) {
                  setTestErgebnis(null);
                  setTestFehler(erg.fehler ?? "Testversand fehlgeschlagen.");
                  return;
                }
                setTestFehler(null);
                setTestErgebnis(erg.modus === "graph" ? "Testmail gesendet – bitte das Postfach prüfen." : "Probemodus: Testmail nur protokolliert, nicht gesendet.");
              })
            }
          >
            <i className="ph ph-paper-plane-tilt" aria-hidden /> Testmail an mich senden
          </button>
          <span className="c">Prüft den Versandweg vor dem Umschalten; geht nur an deine eigene Adresse.</span>
          {testErgebnis && <p className="einst-testversand-ergebnis" role="status">{testErgebnis}</p>}
          {testFehler && <p className="pf-fehler einst-fehler" role="alert">{testFehler}</p>}
        </div>
      )}
    </section>
  );
}
