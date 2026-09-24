/**
 * F8/E30: Rollen-Logik als reine Funktionen — ohne Datenbank, ohne Header,
 * ohne Umgebung. Die Wache selbst (mit DB-Zugriff) sitzt in `wache.ts`; hier
 * stehen nur die Entscheidungen, damit sie ohne Infrastruktur testbar sind.
 *
 * Drei Rollen, aufsteigende Rechte: `betrachter` liest, `bearbeiter` erfasst
 * und bearbeitet, `admin` verwaltet zusaetzlich die Benutzer. "Bewerten" ist
 * bewusst KEINE eigene Rolle — die Frage wird erst mit AP3 geprueft.
 */

export const ROLLEN = ["betrachter", "bearbeiter", "admin"] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Anzeige-Labels: lowercase mit Punkt, wie im Designsystem. */
export const ROLLE_LABEL: Record<Rolle, string> = {
  betrachter: "betrachter.",
  bearbeiter: "bearbeiter.",
  admin: "admin.",
};

/**
 * Was eine Aktion mindestens verlangt. Bewusst nur zwei Stufen statt einer
 * Rechte-Matrix: Schreiben (erfassen, bearbeiten, Status setzen, verwerfen)
 * und Verwalten (Benutzer). Mehr Stufen waeren heute erfunden, nicht
 * entschieden.
 */
export type Anforderung = "lesen" | "schreiben" | "verwalten";

const RANG: Record<Rolle, number> = { betrachter: 1, bearbeiter: 2, admin: 3 };
const MINDESTRANG: Record<Anforderung, number> = { lesen: 1, schreiben: 2, verwalten: 3 };

/** Reine Entscheidung: Reicht diese Rolle fuer diese Anforderung? */
export function darf(rolle: Rolle, was: Anforderung): boolean {
  return RANG[rolle] >= MINDESTRANG[was];
}

/**
 * E-Mails werden ausschliesslich in Kleinschreibung verglichen und
 * gespeichert (CHECK in Migration 0019). Gross-/Kleinschreibung darf nicht
 * darueber entscheiden, ob jemand hereinkommt — eine Groesse, eine
 * Schreibweise. Leerraum faellt weg, weil Access-Claims ihn gelegentlich
 * mitfuehren.
 */
export function normalisiereEmail(roh: string): string {
  return roh.trim().toLowerCase();
}

/** Zustand eines Zugangs — jeder Fall benannt, keiner implizit. */
export type Zugang =
  | { art: "erlaubt"; email: string; rolle: Rolle; name: string | null }
  | { art: "nicht_angemeldet" }
  | { art: "unbekannt"; email: string }
  | { art: "deaktiviert"; email: string };

/**
 * Entscheidet den Zugang aus der verifizierten E-Mail und dem (ggf. fehlenden)
 * Datenbankeintrag. Fail closed: Ohne Eintrag oder mit `aktiv = false` gibt es
 * keinen Zugang — kein stilles Zurueckfallen auf Lesezugriff.
 */
export function bestimmeZugang(
  email: string | null,
  eintrag: { rolle: Rolle; aktiv: boolean; name: string | null } | null,
): Zugang {
  if (!email) return { art: "nicht_angemeldet" };
  const norm = normalisiereEmail(email);
  if (!eintrag) return { art: "unbekannt", email: norm };
  if (!eintrag.aktiv) return { art: "deaktiviert", email: norm };
  return { art: "erlaubt", email: norm, rolle: eintrag.rolle, name: eintrag.name };
}
