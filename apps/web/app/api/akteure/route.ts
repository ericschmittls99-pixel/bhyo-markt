import { AkteurFehlerAusnahme, akteurAnlegen } from "@/lib/akteur-schreibweg";
import { ladeSektoren, sucheAkteure } from "@/lib/register";
import { wacheFuerRoute, zugangFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/** Live-Suche fuer die Akteur-Combobox. */
export async function GET(req: Request) {
  // F8/E30: Lesen reicht hier — ein Betrachter muss Auswahllisten sehen.
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ akteure: await sucheAkteure(q) });
}

/**
 * Inline-Neuanlage eines Akteurs aus dem Beleg (AP2.5 PR a1, E66): Pflicht sind
 * Name, Sektor (leer = Systemzeile ohne_sektor), Sitz mit PLZ und Ort sowie
 * der Pin (lat/lng) — der Kreis-ARS kommt ueber den E25-Weg aus der
 * Koordinate. Die Sitz-Werte sind im Formular mit dem Strom-Standort
 * vorbefuellt (Praezisierung F0a). Seit AP2.7 PR b macht das der Baustein
 * akteurAnlegenInTx (lib/akteur-schreibweg.ts), den auch der Import nutzt;
 * die Route uebersetzt nur noch Request und Antwort.
 */
export async function POST(req: Request) {
  // F8/E30: Schreibrecht ueber die zentrale Wache, nicht "irgendwie angemeldet".
  const wache = await wacheFuerRoute("akteur.anlegen");
  if (!wache.ok) return wache.antwort;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const aktiveCodes = (await ladeSektoren()).filter((s) => s.aktiv).map((s) => s.code);
  try {
    const created = await akteurAnlegen(
      { id: wache.zugang.id, email: wache.zugang.email, rolle: wache.zugang.rolle },
      { eingabe: body, aktiveCodes },
    );
    return Response.json({ akteur: created }, { status: 201 });
  } catch (e) {
    if (e instanceof AkteurFehlerAusnahme) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: e instanceof Error ? e.message : "Anlegen fehlgeschlagen" }, { status: 500 });
  }
}
