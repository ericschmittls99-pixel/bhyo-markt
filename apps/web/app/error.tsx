"use client";

import { dbFehlerMeldung } from "@bhyo/db";

/**
 * Fehlerseite der Anwendung: Ein Datenbank-Timeout oder ein Verbindungsabriss
 * (Zeitbudget des Clients, packages/db/src/client.ts) erscheint als
 * verstaendlicher Satz mit Neu-laden-Knopf, nicht als nackter 1101. Andere
 * Fehler bekommen denselben Rahmen mit allgemeinem Text; der Digest steht
 * klein dabei, damit er sich im Log wiederfinden laesst.
 */
export default function Fehler({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const meldung =
    dbFehlerMeldung(error) ?? "Beim Laden der Seite ist ein Fehler aufgetreten. Bitte die Seite neu laden.";
  return (
    <main className="fehler-seite" role="alert">
      <h1>etwas ist schiefgelaufen.</h1>
      <p>{meldung}</p>
      <button type="button" className="btn btn--primary" onClick={() => reset()}>
        Neu laden
      </button>
      {error.digest && <p className="c">Kennung {error.digest}</p>}
    </main>
  );
}
