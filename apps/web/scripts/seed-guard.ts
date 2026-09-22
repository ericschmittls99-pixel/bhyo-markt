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

/**
 * Stammdaten-Guard: Jeder in der Spezifikation verwendete Materialart- und
 * Produktcode muss in der jeweiligen Referenztabelle existieren, sonst
 * Abbruch mit dem fehlenden Code. Bewusst KEIN Ersatzprodukt und kein
 * "naechstbestes" — ein Ersatzwert saehe plausibel aus und ist damit die
 * gefaehrlichste Form des Fehlschlags (Anlass: sechs Pflanzenkohle-
 * Positionen wurden am 22.09.2026 still zu Methanol).
 */
export function pruefeStammdaten(pruefung: {
  verwendeteMaterialarten: readonly string[];
  verwendeteProdukte: readonly string[];
  bekannteMaterialarten: readonly string[];
  bekannteProdukte: readonly string[];
}): { fehler: string } | null {
  const fehlend = (verwendet: readonly string[], bekannt: readonly string[]) =>
    [...new Set(verwendet)].filter((code) => !bekannt.includes(code)).sort();

  const zeilen: string[] = [];
  for (const [tabelle, codes] of [
    ["materialart", fehlend(pruefung.verwendeteMaterialarten, pruefung.bekannteMaterialarten)],
    ["output_produkt", fehlend(pruefung.verwendeteProdukte, pruefung.bekannteProdukte)],
  ] as const) {
    for (const code of codes) zeilen.push(`- ${tabelle}: "${code}"`);
  }
  if (!zeilen.length) return null;
  return {
    fehler:
      "Stammdaten fehlen in der Referenztabelle:\n" +
      zeilen.join("\n") +
      "\nEntweder das Stammdatum per Migration ergaenzen (Muster 0008/0011) " +
      "oder die Spezifikation korrigieren. Es gibt bewusst kein Ersatzprodukt.",
  };
}
