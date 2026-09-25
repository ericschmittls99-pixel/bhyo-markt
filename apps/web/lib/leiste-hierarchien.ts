/**
 * Verbindet die drei Bäume (lib/hierarchie-baeume.ts) mit den Chips der
 * Filterleiste. EINE Stelle für alle drei Ansichten — sonst wäre die
 * Verdrahtung genau die Art Doppelung, die E32 abgeschafft hat.
 */
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import { filterDef, type FilterDef } from "@/lib/filter-modell";
import { kurzfassung, type Ebene, type Knoten } from "@/lib/hierarchie";
import {
  baumMaterialart,
  baumOrt,
  baumProdukt,
  type BaumStrom,
} from "@/lib/hierarchie-baeume";

export interface ChipHierarchie {
  baum: Knoten[];
  ebenen: Ebene[];
  auswahl: Record<string, string[]>;
  kurz: string;
  anzahl: number;
}

/** Die Bäume aus dem ungefilterten Pool — der Baum zeigt den Bestand, nicht die Auswahl. */
export function baeumeAus(pool: BaumStrom[]): Record<string, Knoten[]> {
  return {
    materialart: baumMaterialart(pool, CLUSTER_LABEL),
    produkt: baumProdukt(pool, OUTPUT_LABEL),
    ort: baumOrt(pool),
  };
}

/**
 * Baut die Chip-Angaben für einen Hierarchie-Filter. `werte` ist der
 * geparste Filter; die Ebenen kommen aus dem Modell.
 */
export function chipHierarchie(
  def: FilterDef,
  baeume: Record<string, Knoten[]>,
  werte: Record<string, unknown>,
): ChipHierarchie | undefined {
  if (def.typ !== "hierarchie" || !def.ebenen) return undefined;
  const ebenen = [...def.ebenen];
  const auswahl: Record<string, string[]> = {};
  let anzahl = 0;
  for (const e of ebenen) {
    const w = (werte[e.param] as string[]) ?? [];
    auswahl[e.param] = w;
    anzahl += w.length;
  }
  const baum = baeume[def.key] ?? [];
  return { baum, ebenen, auswahl, kurz: kurzfassung(baum, ebenen, auswahl), anzahl };
}

/** Bequemer Zugriff für die Seiten: Chip-Angaben je Filter-Schlüssel. */
export function hierarchienFuer(
  keys: string[],
  baeume: Record<string, Knoten[]>,
  werte: Record<string, unknown>,
): Record<string, ChipHierarchie | undefined> {
  const out: Record<string, ChipHierarchie | undefined> = {};
  for (const key of keys) {
    const def = filterDef(key);
    if (def) out[key] = chipHierarchie(def, baeume, werte);
  }
  return out;
}
