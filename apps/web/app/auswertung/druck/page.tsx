import { DruckAbzug } from "@/components/druck/DruckAbzug";
import { ladeExport } from "@/lib/export-server";
import type { SearchParamsRoh } from "@/lib/stroeme-modell";

export const dynamic = "force-dynamic";

/**
 * F6 PR B — Druck-Route statt Server-PDF (Entscheidung Eric, 26.09.2026).
 * Übernimmt Filter, Sicht, Ansicht und Modus aus der Adresse — derselbe
 * Ladepfad wie der CSV-Export (lib/export-server.ts), dieselben Spalten und
 * dieselbe Einstufung (lib/export-modell.ts). Gedruckt wird aus dem Browser
 * als PDF; ein serverseitig erzeugtes PDF kommt erst mit AP3. Zugang: die
 * Zugangssperre im Layout (fail closed) gilt auch hier.
 */
export default async function DruckPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRoh>;
}) {
  const sp = await searchParams;
  const roh: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const w = Array.isArray(v) ? v[0] : v;
    if (w != null) roh[k] = w;
  }
  const daten = await ladeExport(roh);
  return <DruckAbzug rows={daten.rows} kontext={daten.kontext} />;
}
