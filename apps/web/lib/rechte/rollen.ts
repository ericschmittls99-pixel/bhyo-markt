/**
 * F8/E30: Rollen-Logik als reine Funktionen — ohne Datenbank, ohne Header,
 * ohne Umgebung. Die Wache selbst (mit DB-Zugriff) sitzt in `wache.ts`; hier
 * stehen nur die Entscheidungen, damit sie ohne Infrastruktur testbar sind.
 *
 * Vier Rollen (E42): `betrachter` liest, `bearbeiter` erfasst und bearbeitet,
 * `pruefer` sperrt und weist zu (E44), `admin` verwaltet zusaetzlich die
 * Benutzer. Was eine Rolle
 * konkret darf, steht als Daten in `matrix.ts` (E42) — hier nur, welche
 * Rollen es gibt und wie ein Zugang zustande kommt.
 */

// E42: vier Rollen, Hierarchie admin ⊇ pruefer ⊇ bearbeiter ⊇ betrachter —
// ausgeschrieben in matrix.ts, nicht als Rang gerechnet.
export const ROLLEN = ["betrachter", "bearbeiter", "pruefer", "admin"] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Anzeige-Labels: lowercase mit Punkt, wie im Designsystem. */
export const ROLLE_LABEL: Record<Rolle, string> = {
  betrachter: "betrachter.",
  bearbeiter: "bearbeiter.",
  pruefer: "prüfer.",
  admin: "admin.",
};

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
  | { art: "erlaubt"; id: string; email: string; rolle: Rolle; name: string | null }
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
  eintrag: { id: string; rolle: Rolle; aktiv: boolean; name: string | null } | null,
): Zugang {
  if (!email) return { art: "nicht_angemeldet" };
  const norm = normalisiereEmail(email);
  if (!eintrag) return { art: "unbekannt", email: norm };
  if (!eintrag.aktiv) return { art: "deaktiviert", email: norm };
  // AP2.1 PR b0: Die stabile Nutzer-ID reist im Zugang mit — fuer Sperren
  // und Zuweisungen (PR b). Entschieden wird weiter ueber die Rolle.
  return { art: "erlaubt", id: eintrag.id, email: norm, rolle: eintrag.rolle, name: eintrag.name };
}
