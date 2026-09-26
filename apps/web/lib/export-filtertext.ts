import type { FilterDef, FilterOption } from "./filter-modell";

/**
 * E36: Aktive Filter im Klartext für die Metazeilen des Exports — aus dem
 * Filtermodell (E32), nicht aus einer zweiten Liste. Je Filter „Label:
 * Werte"; Facettenwerte werden über die Optionslabels der Ansicht
 * beschriftet, Bereiche als „von – bis", Hierarchien Ebene für Ebene.
 * Ungesetzte Filter erscheinen nicht.
 */
export function filterKlartext(
  defs: readonly FilterDef[],
  werte: Record<string, unknown>,
  optionen: Record<string, FilterOption[]>,
): string[] {
  const out: string[] = [];
  for (const def of defs) {
    const teile: string[] = [];
    if (def.typ === "facette" || def.typ === "hierarchie") {
      for (const p of def.params) {
        const liste = (werte[p] as string[] | undefined) ?? [];
        if (!liste.length) continue;
        const opts = optionen[p] ?? optionen[def.key] ?? [];
        const labels = liste.map((w) => opts.find((o) => o.wert === w)?.label ?? w);
        const ebene = def.ebenen?.find((e) => e.param === p)?.label;
        teile.push(ebene ? `${ebene} ${labels.join(", ")}` : labels.join(", "));
      }
    } else if (def.typ === "bereich" || def.typ === "zeitfenster") {
      const [von, bis, zustand] = def.params.map((p) => ((werte[p] as string | undefined) ?? "").trim());
      if (von || bis) teile.push(`${von || "…"} – ${bis || "…"}`);
      if (zustand) teile.push(zustand);
    } else {
      const v = ((werte[def.params[0]!] as string | undefined) ?? "").trim();
      if (v) teile.push(v);
    }
    if (teile.length) out.push(`${def.label}: ${teile.join(" ")}`);
  }
  return out;
}
