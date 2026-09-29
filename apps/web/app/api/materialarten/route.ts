import { sucheMaterialarten } from "@/lib/register";
import { zugangFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

// AP2.2 PR a (Entscheidung Eric, 29.09.2026): POST (Inline-Neuanlage einer
// Materialart) entfernt — kein Aufrufer, und die Taxonomie soll nicht frei
// editierbar sein. Ein Admin-Pfad mit eigenem Schluesselkonzept kommt bei
// Bedarf mit AP2.3. Damit entfiel auch die Aktion materialart.anlegen.

/** Live-Suche fuer die Materialart-Combobox. */
export async function GET(req: Request) {
  // F8/E30: Lesen reicht hier — ein Betrachter muss Auswahllisten sehen.
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ materialarten: await sucheMaterialarten(q) });
}
