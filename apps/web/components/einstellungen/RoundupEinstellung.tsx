"use client";

/**
 * AP2.9 (E76): Schalter fuer die eigene Roundup-Mail (Werktage 07:07, nur
 * wenn seit dem letzten Roundup etwas Neues da ist). Ziel der Fusszeile in
 * der Mail (#roundup). Die Pruefung sitzt in der Aktion; hier nur die Anzeige.
 */
import { useState, useTransition } from "react";

import { roundupSetzen } from "@/lib/benutzer-actions";

export function RoundupEinstellung({ an }: { an: boolean }) {
  const [wert, setWert] = useState(an);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="einst-roundup" id="roundup" aria-labelledby="roundup-titel">
      <h2 id="roundup-titel">roundup.</h2>
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
          <span>Tägliche Roundup-Mail</span>
          <span className="c">An Werktagen um 07:07 Uhr, nur wenn seit dem letzten Roundup neue Hinweise in deiner Inbox liegen. Die Mail nennt Zähler je Typ und einen Link, keine Inhalte.</span>
        </span>
      </label>
      {fehler && <p className="pf-fehler einst-fehler">{fehler}</p>}
    </section>
  );
}
