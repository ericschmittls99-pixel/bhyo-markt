import { erzeugeCsv, exportDateiname } from "@/lib/export-modell";
import { ladeExport } from "@/lib/export-server";
import { wacheFuerRoute } from "@/lib/wache";

export const dynamic = "force-dynamic";

/**
 * CSV-Export (E9, E36): exportiert genau die Auswahl der aufrufenden Ansicht.
 * Laden, Anreichern, Filtern und Metazeilen liegen in lib/export-server.ts —
 * derselbe Pfad wie die Druck-Route; Spalten, Einstufung und Format in
 * lib/export-modell.ts. `modus=extern|intern` (voreingestellt extern)
 * entscheidet, ob nicht freigegebene Belegangaben und Abnehmernamen
 * zurückgehalten werden.
 */
export async function GET(req: Request) {
  // F8/E30: auch Lesen laeuft ueber die Wache — eine unbekannte oder
  // deaktivierte Adresse darf keine Daten sehen (fail closed).
  const wache = await wacheFuerRoute("lesen");
  if (!wache.ok) return wache.antwort;
  const roh: Record<string, string> = {};
  for (const [k, v] of new URL(req.url).searchParams.entries()) roh[k] = v;

  const { rows, kontext, sicht, stichtag } = await ladeExport(roh);
  const csv = erzeugeCsv(rows, kontext);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportDateiname(sicht, kontext.modus, stichtag)}"`,
      "Cache-Control": "no-store",
    },
  });
}
