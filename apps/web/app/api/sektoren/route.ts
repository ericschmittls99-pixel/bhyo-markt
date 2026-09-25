import { ladeSektoren } from "@/lib/register";
import { wacheFuerRoute } from "@/lib/wache";

export const dynamic = "force-dynamic";

/** Auswahlliste der Sektoren (Referenztabelle, Migration 0020) fuer die Akteur-Anlage. */
export async function GET() {
  // F8/E30: Lesen reicht hier — ein Betrachter muss Auswahllisten sehen.
  const wache = await wacheFuerRoute("lesen");
  if (!wache.ok) return wache.antwort;
  return Response.json({ sektoren: await ladeSektoren() });
}
