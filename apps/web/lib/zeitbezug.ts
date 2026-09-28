import { poolJahresAchse } from "./auswertung-modell";
import type { Strom } from "./stroeme-modell";

/**
 * Zeitbezug von auswertung. (AP1j PR 4), als reine Funktion herausgezogen
 * (E41, 28.09.2026), damit Seite UND Export dieselbe Ableitung nutzen —
 * der Export aus auswertung. muss den Verfuegbarkeitsstatus gegen dasselbe
 * Fenster rechnen wie die Ansicht. Die Logik ist unveraendert:
 * Einzeljahr (Default aktuelles Jahr, sonst letztes Achsenjahr) oder
 * Zeitraum (gewaehlte Jahre auf der Achse, sonst ganze Achse); oe pro Jahr
 * oder Summe (nur im Zeitraum).
 */
export interface Zeitbezug {
  zeitmodus: "einzeljahr" | "zeitraum";
  agg: "oe" | "summe";
  jahre: number[];
  poolAchse: number[];
}

const ersterWert = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function leseZeitbezug(
  sp: { zeitmodus?: string | string[]; jahre?: string | string[]; agg?: string | string[] },
  pool: Strom[],
  aktuellesJahr: number,
): Zeitbezug {
  const zeitmodus = ersterWert(sp.zeitmodus) === "zeitraum" ? ("zeitraum" as const) : ("einzeljahr" as const);
  const agg = zeitmodus === "zeitraum" && ersterWert(sp.agg) === "summe" ? ("summe" as const) : ("oe" as const);
  const jahreRoh = ersterWert(sp.jahre)
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const poolAchse = poolJahresAchse(pool, aktuellesJahr);
  const jahre =
    zeitmodus === "einzeljahr"
      ? [
          jahreRoh.find((j) => poolAchse.includes(j)) ??
            (poolAchse.includes(aktuellesJahr) ? aktuellesJahr : poolAchse[poolAchse.length - 1]!),
        ]
      : jahreRoh.filter((j) => poolAchse.includes(j)).length
        ? jahreRoh.filter((j) => poolAchse.includes(j)).sort()
        : poolAchse;
  return { zeitmodus, agg, jahre, poolAchse };
}

/** Fenster (ISO-Daten) fuer die Status-Ableitung: erstes Jahr 01-01 bis letztes Jahr 12-31. */
export function fensterAusJahren(jahre: readonly number[]): { von: string; bis: string } {
  return { von: `${Math.min(...jahre)}-01-01`, bis: `${Math.max(...jahre)}-12-31` };
}

/** Wortlaut des Bezugs fuer Metazeile und Beschriftung: „Jahr 2026" bzw. „Zeitraum 2022 bis 2026". */
export function zeitbezugText(z: Pick<Zeitbezug, "zeitmodus" | "jahre">): string {
  const von = Math.min(...z.jahre);
  const bis = Math.max(...z.jahre);
  if (z.zeitmodus === "einzeljahr" || von === bis) return `Jahr ${bis}`;
  return `Zeitraum ${von} bis ${bis}`;
}
