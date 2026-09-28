/**
 * F8/E30, E42: Die Wache — die EINZIGE Stelle, an der Rechte serverseitig
 * durchgesetzt werden. Sie liest den Zugang (Access-Identitaet aus dem
 * verifizierten Header, Rolle aus `benutzer`) und fragt die Matrix
 * (`darf()` in matrix.ts). Jede Server-Action und jede schreibende Route
 * nennt ihre AKTION und ruft `verlange(aktion)` bzw. eine der Huellen
 * hier auf; `scripts/rechte-check.ts` meldet jeden Schreibpfad, der das
 * nicht tut. Die Oberflaeche blendet nur aus — ersetzen kann sie diese
 * Pruefung nie, weil eine Server-Action ein HTTP-Endpunkt ist.
 */
import { benutzer } from "@bhyo/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { currentUserEmail, withDb } from "@/lib/db";
import { type Aktion, darf, nurAdmin } from "./matrix";
import { bestimmeZugang, normalisiereEmail, type Rolle, type Zugang } from "./rollen";

/** Was verlangt wurde: eine Aktion der Matrix oder nur der Zugang (Lesen). */
export type Verlangt = Aktion | "zugang";

/** Wird geworfen, wenn der Zugang oder die Rolle nicht reicht. Traegt den Zugang fuer die Anzeige. */
export class KeinRecht extends Error {
  constructor(
    readonly zugang: Zugang,
    readonly verlangt: Verlangt,
  ) {
    super(verlangt === "zugang" ? "Kein Zugang." : `Kein Recht fuer ${verlangt}.`);
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
      .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv, name: benutzer.name })
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

type Erlaubt = Extract<Zugang, { art: "erlaubt" }>;

/** Lesen: verlangt einen Zugang (angemeldet, eingetragen, aktiv) — fail closed, keine Rolle noetig. */
export async function verlangeZugang(): Promise<Erlaubt> {
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") throw new KeinRecht(zugang, "zugang");
  return zugang;
}

/** Schreiben: wirft `KeinRecht`, wenn die Matrix die Aktion fuer diese Rolle nicht erlaubt. */
export async function verlange(aktion: Aktion): Promise<Erlaubt> {
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") throw new KeinRecht(zugang, aktion);
  if (!darf(zugang, aktion)) throw new KeinRecht(zugang, aktion);
  return zugang;
}

type RoutenErgebnis = { ok: true; zugang: Erlaubt } | { ok: false; antwort: Response };

function alsAntwort(e: unknown): RoutenErgebnis {
  if (!(e instanceof KeinRecht)) throw e;
  const status = e.zugang.art === "nicht_angemeldet" ? 401 : 403;
  return { ok: false, antwort: Response.json({ error: fehlertext(e) }, { status }) };
}

/**
 * Fuer schreibende API-Routen: liefert entweder den Zugang oder die fertige
 * 401/403-Antwort. Dieselbe Entscheidung wie `verlange`, nur ohne Ausnahme —
 * damit Routen nicht jede fuer sich einen try/catch bauen und dabei abweichen.
 */
export async function wacheFuerRoute(aktion: Aktion): Promise<RoutenErgebnis> {
  try {
    return { ok: true, zugang: await verlange(aktion) };
  } catch (e) {
    return alsAntwort(e);
  }
}

/** Fuer lesende API-Routen: Zugang oder fertige Antwort. */
export async function zugangFuerRoute(): Promise<RoutenErgebnis> {
  try {
    return { ok: true, zugang: await verlangeZugang() };
  } catch (e) {
    return alsAntwort(e);
  }
}

/**
 * Fuer Server-Actions, die ein Ergebnisobjekt zurueckgeben statt zu werfen:
 * liefert entweder die gepruefte E-Mail oder das fertige Fehlerergebnis.
 * Lebt hier und nicht als Helfer je Action-Datei — sonst haette jede Datei
 * ihre eigene Uebersetzung und damit ihre eigene Abweichung.
 */
export async function rechtFuerAction(
  aktion: Aktion,
): Promise<{ email: string } | { ok: false; fehler: string }> {
  try {
    const { email } = await verlange(aktion);
    return { email };
  } catch (e) {
    return { ok: false, fehler: fehlertext(e) ?? "Kein Recht für diese Aktion." };
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
      return e.verlangt !== "zugang" && nurAdmin(e.verlangt)
        ? "Diese Aktion ist Admins vorbehalten."
        : "Für diese Aktion fehlt das Schreibrecht.";
  }
}

export type { Rolle };
