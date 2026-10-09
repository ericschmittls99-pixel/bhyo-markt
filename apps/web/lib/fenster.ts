import { saisonAnteilBruch } from "./saison";
import type { Strom } from "./stroeme-modell";
import type { VergabeDaten } from "./verfuegbarkeit";

/**
 * Monatsscharfe Fensterrechnung (AP1j PR 4, Handoff E19): Wert eines Jahres
 * = Rate × Σ(Saisonanteile der zaehlenden Monate). Jeder Monat ist exakt
 * einer Kategorie zugeordnet (offene Vergabe-Enden werden durch
 * Verfuegbarkeitsbeginn/-ende ersetzt); freie Monate mit Reservierung
 * zaehlen als reserviert. Rein — Zeitpunkte kommen als Parameter.
 */

export type FensterKategorie =
  | "verfuegbar"
  | "reserviert_bhyo"
  | "vergeben_extern"
  | "vergeben_bhyo";

export const ALLE_FENSTER_KATEGORIEN: readonly FensterKategorie[] = [
  "verfuegbar",
  "reserviert_bhyo",
  "vergeben_extern",
  "vergeben_bhyo",
];

type FensterStrom = Pick<
  Strom,
  "zeitraumVon" | "zeitraumBis" | "reserviertBhyo" | "saisonalitaet"
>;

// Saisonanteil: zentrale Ableitung in lib/saison (Index-Konvention
// 23.09.2026 — Skala bedeutungslos, wert/Summe). War hier schon immer
// summen-normiert, deshalb liefern Bestandsprofile identische Anteile.
const saisonAnteil = saisonAnteilBruch;

const monatsKey = (jahr: number, monat: number) =>
  `${jahr}-${String(monat + 1).padStart(2, "0")}`;

/** Kategorie eines Monats oder null ausserhalb des Verfuegbarkeitszeitraums. */
function monatsKategorie(
  jahr: number,
  monat: number,
  strom: FensterStrom,
  vergaben: VergabeDaten[],
): FensterKategorie | null {
  // E75: zeitraumBis null = unbefristet — jeder Monat ab Beginn zaehlt.
  if (!strom.zeitraumVon) return null;
  const m = monatsKey(jahr, monat);
  if (m < strom.zeitraumVon.slice(0, 7)) return null;
  if (strom.zeitraumBis != null && m > strom.zeitraumBis.slice(0, 7)) return null;
  const aktiv = vergaben.find((v) => {
    const ende = v.vergebenBis ?? strom.zeitraumBis;
    return m >= (v.vergebenVon ?? strom.zeitraumVon!).slice(0, 7) && (ende == null || m <= ende.slice(0, 7));
  });
  if (aktiv) return aktiv.anBhyo ? "vergeben_bhyo" : "vergeben_extern";
  return strom.reserviertBhyo ? "reserviert_bhyo" : "verfuegbar";
}

/** Σ Saisonanteile der Monate eines Jahres in den gewuenschten Kategorien (null = alle). */
export function jahresAnteil(
  jahr: number,
  strom: FensterStrom,
  vergaben: VergabeDaten[],
  kategorien: ReadonlySet<FensterKategorie> | null,
): number {
  let anteil = 0;
  for (let m = 0; m < 12; m++) {
    const k = monatsKategorie(jahr, m, strom, vergaben);
    if (k && (kategorien == null || kategorien.has(k)))
      anteil += saisonAnteil(strom.saisonalitaet, m);
  }
  return anteil;
}

/**
 * Fensterbezogene Status-Kategorien eines Stroms: Mengen-Kategorien mit
 * Anteil > 0, plus abgelaufen/noch_nicht_verfuegbar, wenn die Verfuegbarkeit
 * komplett vor bzw. nach dem Fenster liegt (Menge 0, aber filterbar).
 */
export function fensterKategorien(
  jahre: number[],
  strom: FensterStrom,
  vergaben: VergabeDaten[],
): Set<string> {
  const k = new Set<string>();
  for (const kat of ALLE_FENSTER_KATEGORIEN) {
    const nur = new Set([kat]);
    if (jahre.some((jahr) => jahresAnteil(jahr, strom, vergaben, nur) > 0))
      k.add(kat);
  }
  if (strom.zeitraumVon && jahre.length) {
    const lo = Math.min(...jahre);
    const hi = Math.max(...jahre);
    // E75: ohne Ende nie abgelaufen.
    if (strom.zeitraumBis != null && Number(strom.zeitraumBis.slice(0, 4)) < lo) k.add("abgelaufen");
    if (Number(strom.zeitraumVon.slice(0, 4)) > hi)
      k.add("noch_nicht_verfuegbar");
  }
  return k;
}

/** Fensterfaktor: Σ Jahresanteile; oe teilt durch die Fensterjahre. */
export function fensterFaktor(
  jahre: number[],
  strom: FensterStrom,
  vergaben: VergabeDaten[],
  kategorien: ReadonlySet<FensterKategorie> | null,
  agg: "oe" | "summe",
): number {
  const summe = jahre.reduce(
    (n, jahr) => n + jahresAnteil(jahr, strom, vergaben, kategorien),
    0,
  );
  return agg === "oe" && jahre.length ? summe / jahre.length : summe;
}

/**
 * Fenster auf den Pool anwenden: SKALIERTE Strom-Kopien (Mengenfelder ×
 * Faktor) — alle bestehenden auswertung-Module rechnen damit unveraendert
 * fensterbezogen; Preis × skalierte Menge ergibt automatisch das
 * fensterbezogene Potenzial. Die Status-Auswahl bestimmt hier nur, welche
 * Monatskategorien in die Menge zaehlen; WELCHE Stroeme bleiben, entscheidet
 * seit E41 (28.09.2026) der Verfuegbarkeitsfilter des gemeinsamen
 * Filtermodells (Status gegen das Fenster, Ueberschneidungsregel E32) —
 * vorher stand hier eine zweite, mengenbasierte Filterlogik nur fuer
 * auswertung.
 */
export function wendeFensterAn(
  stroeme: Strom[],
  vergabenMap: Map<string, VergabeDaten[]>,
  jahre: number[],
  statusAuswahl: string[],
  agg: "oe" | "summe",
): Strom[] {
  const mengenKategorien: ReadonlySet<FensterKategorie> = new Set(
    statusAuswahl.length
      ? ALLE_FENSTER_KATEGORIEN.filter((k) => statusAuswahl.includes(k))
      : ALLE_FENSTER_KATEGORIEN,
  );
  const erg: Strom[] = [];
  for (const s of stroeme) {
    const vergaben = vergabenMap.get(s.id) ?? [];
    const f = fensterFaktor(jahre, s, vergaben, mengenKategorien, agg);
    erg.push({
      ...s,
      mengeAtro: s.mengeAtro == null ? null : s.mengeAtro * f,
      mengeFm: s.mengeFm == null ? null : s.mengeFm * f,
      mengeWert: s.mengeWert == null ? null : s.mengeWert * f,
    });
  }
  return erg;
}
