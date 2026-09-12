/**
 * Bedienzustand der Shell (AP1i, Ansage 5): EIN Cookie `bhyo_ui` traegt
 * Sidebar-, Akkordeon-, Theme- (und spaeter Filter-/Legenden-) Zustand.
 * Serverseitig in layout.tsx gelesen und als Default an die Client-Komponenten
 * gegeben — kein Nachladen aus localStorage, kein Aufklapp-Flackern.
 * Der Querystring bleibt den Datenfiltern vorbehalten.
 */

export const UI_COOKIE = "bhyo_ui";

export interface UiState {
  /** Sidebar eingeklappt? */
  sidebarZu?: boolean;
  /** Offene Sidebar-Akkordeons (Nav-Keys, z. B. "stroeme", "planer"). */
  akkordeons?: string[];
  /** Explizit gewaehltes Theme; Default light (wie Mockup). */
  theme?: "light" | "dark";
  /** Filterleiste je View offen (kommt mit den Screen-PRs). */
  filterOffen?: Record<string, boolean>;
  /** Kartenlegende (PR 6): offen + Hoehe in px + ausgeblendete Region-IDs. */
  legende?: { offen: boolean; hoehe?: number; regionenAus?: string[] };
}

export const UI_DEFAULT: UiState = {
  sidebarZu: false,
  akkordeons: ["stroeme", "planer"],
  theme: "light",
};

export function parseUiState(raw: string | null | undefined): UiState {
  if (!raw) return { ...UI_DEFAULT };
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as UiState;
    return { ...UI_DEFAULT, ...parsed };
  } catch {
    return { ...UI_DEFAULT };
  }
}

/** Schreibt den kompletten Zustand als Cookie-Zeile (Client: document.cookie). */
export function uiCookieString(state: UiState): string {
  const value = encodeURIComponent(JSON.stringify(state));
  return `${UI_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * Merged einen Teilzustand in das bestehende Cookie (nur Client). Liest vor dem
 * Schreiben den aktuellen Stand, damit sich Sidebar- und Theme-Schreiber nicht
 * gegenseitig ueberschreiben.
 */
export function updateUiCookie(patch: Partial<UiState>): UiState {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${UI_COOKIE}=`))
    ?.slice(UI_COOKIE.length + 1);
  const next = { ...parseUiState(raw), ...patch };
  document.cookie = uiCookieString(next);
  return next;
}
