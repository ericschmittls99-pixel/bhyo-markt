/**
 * F8/E30: Die Wache — die EINZIGE Stelle, an der Rechte durchgesetzt werden.
 *
 * Nicht eine Kopie je Datei: Jede Server-Action und jede schreibende Route
 * ruft `verlangeSchreibrecht()` bzw. `verlangeVerwaltungsrecht()` auf. Wer
 * eine zweite Prueflogik daneben baut, hat zwei Wahrheiten — und irgendwann
 * nur noch eine, die stimmt. `scripts/wache-abdeckung.ts` meldet deshalb
 * jeden Schreibpfad, der hier nicht vorbeikommt.
 *
 * Die Oberflaeche blendet zusaetzlich aus; ersetzen kann sie diese Pruefung
 * nie — wer die Server-Action direkt aufruft, umgeht die Oberflaeche.
 */
import { benutzer } from "@bhyo/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { currentUserEmail, withDb } from "@/lib/db";
import {
  bestimmeZugang,
  darf,
  normalisiereEmail,
  type Anforderung,
  type Rolle,
  type Zugang,
} from "@/lib/rollen";

/** Wird geworfen, wenn die Rolle nicht reicht. Traegt den Zugang fuer die Anzeige. */
export class KeinRecht extends Error {
  constructor(
    readonly zugang: Zugang,
    readonly verlangt: Anforderung,
  ) {
    super(`Kein ${verlangt === "verwalten" ? "Verwaltungs" : "Schreib"}recht.`);
    this.name = "KeinRecht";
  }
}

/**
 * Liest den Zugang der angemeldeten Person. Die Identitaet kommt aus dem von
 * der Middleware gesetzten Header (dort gegen den JWKS verifiziert), die
 * Rolle aus der Datenbank — Access entscheidet, wer hereinkommt, die
 * Anwendung entscheidet, was diese Person darf.
 */
export async function aktuellerZugang(): Promise<Zugang> {
  const roh = await currentUserEmail();
  if (!roh) return { art: "nicht_angemeldet" };
  const email = normalisiereEmail(roh);

  const eintrag = await withDb(async (db) => {
    const [z] = await db
      .select({ rolle: benutzer.rolle, aktiv: benutzer.aktiv, name: benutzer.name })
      .from(benutzer)
      .where(eq(benutzer.email, email))
      .limit(1);
    return z ?? null;
  });

  return bestimmeZugang(email, eintrag ?? null);
}

/**
 * Kontaktadresse fuer die Zugangsseite: die E-Mail des ersten aktiven Admins,
 * aus der Datenbank gelesen statt fest eingetragen — damit sie stimmt, wenn
 * sich die Admins aendern. `null`, wenn es keinen aktiven Admin gibt; die
 * Seite zeigt dann einen neutralen Hinweis statt einer leeren Zeile.
 */
export async function adminKontakt(): Promise<string | null> {
  return withDb(async (db) => {
    const [z] = await db
      .select({ email: benutzer.email })
      .from(benutzer)
      .where(and(eq(benutzer.rolle, "admin"), eq(benutzer.aktiv, true)))
      .orderBy(asc(benutzer.email))
      .limit(1);
    return z?.email ?? null;
  });
}

/** Wirft `KeinRecht`, wenn die Rolle nicht reicht; gibt sonst den Zugang zurueck. */
export async function verlange(
  was: Anforderung,
): Promise<Extract<Zugang, { art: "erlaubt" }>> {
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") throw new KeinRecht(zugang, was);
  if (!darf(zugang.rolle, was)) throw new KeinRecht(zugang, was);
  return zugang;
}

/** Schreiben: erfassen, bearbeiten, Status setzen, verwerfen. */
export function verlangeSchreibrecht() {
  return verlange("schreiben");
}

/** Verwalten: Benutzer anlegen, Rolle aendern, deaktivieren. */
export function verlangeVerwaltungsrecht() {
  return verlange("verwalten");
}

/**
 * Fuer API-Routen: liefert entweder den Zugang oder die fertige 403-Antwort.
 * Dieselbe Entscheidung wie `verlange`, nur ohne Ausnahme — damit Routen
 * nicht jede fuer sich einen try/catch bauen und dabei abweichen.
 */
export async function wacheFuerRoute(
  was: Anforderung,
): Promise<
  | { ok: true; zugang: Extract<Zugang, { art: "erlaubt" }> }
  | { ok: false; antwort: Response }
> {
  try {
    return { ok: true, zugang: await verlange(was) };
  } catch (e) {
    if (!(e instanceof KeinRecht)) throw e;
    const status = e.zugang.art === "nicht_angemeldet" ? 401 : 403;
    return {
      ok: false,
      antwort: Response.json({ error: fehlertext(e) }, { status }),
    };
  }
}

/**
 * Fuer Server-Actions, die ein Ergebnisobjekt zurueckgeben statt zu werfen:
 * liefert entweder die geprueffte E-Mail oder das fertige Fehlerergebnis.
 * Lebt hier und nicht als Helfer je Action-Datei — sonst haette jede Datei
 * ihre eigene Uebersetzung und damit ihre eigene Abweichung.
 */
export async function schreibrechtFuerAction(): Promise<
  { email: string } | { ok: false; fehler: string }
> {
  try {
    const { email } = await verlangeSchreibrecht();
    return { email };
  } catch (e) {
    return { ok: false, fehler: fehlertext(e) ?? "Kein Schreibrecht." };
  }
}

/**
 * Wie `schreibrechtFuerAction`, nur fuer die Benutzerverwaltung. Gibt `null`
 * zurueck, wenn das Recht da ist — sonst das fertige Fehlerergebnis.
 */
export async function verwaltungsrechtFuerAction(): Promise<{
  ok: false;
  fehler: string;
} | null> {
  try {
    await verlangeVerwaltungsrecht();
    return null;
  } catch (e) {
    return { ok: false, fehler: fehlertext(e) ?? "Kein Verwaltungsrecht." };
  }
}

/**
 * Fuer Server-Actions, die ein Ergebnisobjekt zurueckgeben statt zu werfen:
 * liefert die Fehlermeldung, die die Oberflaeche anzeigt. Bewusst ohne
 * technische Einzelheiten — der Grund steht auf der Zugangsseite.
 */
export function fehlertext(e: unknown): string | null {
  if (!(e instanceof KeinRecht)) return null;
  switch (e.zugang.art) {
    case "nicht_angemeldet":
      return "Nicht authentifiziert.";
    case "unbekannt":
      return "Für diese Adresse ist noch kein Zugang eingerichtet.";
    case "deaktiviert":
      return "Der Zugang wurde deaktiviert.";
    default:
      return e.verlangt === "verwalten"
        ? "Diese Aktion ist Admins vorbehalten."
        : "Für diese Aktion fehlt das Schreibrecht.";
  }
}

export type { Rolle };
