/**
 * Ziel-Pruefung des Preview-Seeds (§0 des Auftrags, 22.09.2026) als pure,
 * getestete Funktion. Es gibt bewusst KEIN Flag und keine zweite Variable,
 * die diese Pruefung umgeht.
 *
 * Zwei Sperren, weil die echte Production-URL das Wort "prod" gar nicht
 * enthaelt (Host ep-purple-glade-…, DB neondb): die /prod/i-Regex faengt
 * naheliegende Benennungen, der Host-Vergleich den dokumentierten
 * Production-Endpoint selbst (Endpoint-Tabelle im AP1j-Handoff, Abschnitt
 * E21).
 */

/** Neon-Host der Produktions-DB — identisch zur Host-Pruefung in migrate-production.yml. */
const PRODUCTION_HOST = "ep-purple-glade-b2tra1g7";

export function pruefeSeedZiel(
  env: Record<string, string | undefined>,
): { url: string } | { fehler: string } {
  const url = env.SEED_DATABASE_URL_PREVIEW;
  if (!url) {
    return {
      fehler:
        "SEED_DATABASE_URL_PREVIEW fehlt. Dieses Skript kennt bewusst nur diese eine Variable.",
    };
  }
  if (/prod/i.test(url)) {
    return { fehler: "die URL sieht nach Production aus. Kein Override vorgesehen." };
  }
  if (url.includes(PRODUCTION_HOST)) {
    return {
      fehler: `die URL zeigt auf den Production-Endpoint ${PRODUCTION_HOST}. Kein Override vorgesehen.`,
    };
  }
  return { url };
}
