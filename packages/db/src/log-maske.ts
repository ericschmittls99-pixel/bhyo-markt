/**
 * E73 (08.10.2026): Host und Datenbanknutzer einer Verbindungsangabe als
 * GitHub-Maske (::add-mask::) ausgeben — bevor ein Skript sie nennt. Logs
 * eines oeffentlichen Repos sind oeffentlich; GitHub maskiert nur das ganze
 * Secret, keine Bruchstuecke (Befund Eric: der erste Schritt zerlegte das
 * Secret an Leerzeichen, und Node druckte das Bruchstueck im Fehlerobjekt).
 *
 * Regeln: nie werfen, nie die Eingabe oder Teile davon ausgeben; nur was
 * maskiert werden soll (Host, Nutzer) geht nach stdout — als Maske. Beide
 * Schreibweisen: URL (postgres://user:pw@host/db?…) und key=value-DSN
 * (host=… user=… password=… sslmode=…, durch Leerzeichen getrennt).
 */

/** Was aus einem Verbindungswert zu maskieren ist — leer, wenn nichts erkennbar ist. */
export function maskenFuer(wert: string | undefined): string[] {
  if (!wert) return [];
  const masken = new Set<string>();
  const merke = (v: string | undefined) => {
    const t = (v ?? "").trim();
    if (t.length >= 3) masken.add(t);
  };
  // URL-Form: //user:pw@host:port/… — Host bis zum naechsten /, ?, : oder Leerraum
  const host = /@([^/?:\s]+)/.exec(wert);
  if (host) merke(host[1]);
  const user = /\/\/([^:@/\s]+)[:@]/.exec(wert);
  if (user) {
    try {
      merke(decodeURIComponent(user[1]!));
    } catch {
      merke(user[1]);
    }
  }
  // key=value-Form (libpq): host=… user=…, durch Leerzeichen getrennt; Passwort-Schluessel bewusst nicht ausgegeben.
  for (const m of wert.matchAll(/(?:^|\s)(host|hostaddr|user)=([^\s'"]+)/g)) merke(m[2]);
  return [...masken];
}

/** CLI: alle Umgebungsvariablen URL_* lesen und je Fund eine Maskenzeile drucken. Kein Fehlerpfad gibt Eingaben aus. */
export function maskenAusUmgebung(env: NodeJS.ProcessEnv): string[] {
  const zeilen: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("URL_")) continue;
    for (const m of maskenFuer(v)) zeilen.push(`::add-mask::${m}`);
  }
  return zeilen;
}

if (process.argv[1]?.endsWith("log-maske.ts")) {
  let zeilen: string[] = [];
  try {
    zeilen = maskenAusUmgebung(process.env);
  } catch {
    // Absichtlich ohne Details: nichts aus der Eingabe darf ins Log.
    console.log("LOG-MASKE: Bestandteile nicht erkennbar — nichts maskiert.");
  }
  for (const z of zeilen) console.log(z);
  console.log(`LOG-MASKE: ${zeilen.length} Maske(n) gesetzt.`);
}
