import { akteur } from "@bhyo/db/schema";

import { sql } from "drizzle-orm";

import { OHNE_ORT, pruefeAkteurEingabe } from "@/lib/akteur-eingabe";
import { kreisArsDesSitzes } from "@/lib/akteure";
import { withDb } from "@/lib/db";
import { ladeSektoren, sucheAkteure } from "@/lib/register";
import { wacheFuerRoute, zugangFuerRoute } from "@/lib/rechte/wache";
import { protokolliere } from "@/lib/protokoll";

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
 * Koordinate (View akteur_verwaltung); ist kein Kreis bestimmbar, rollt die
 * Transaktion zurueck. Die Sitz-Werte sind im Formular mit dem Strom-Standort
 * vorbefuellt (Praezisierung F0a). Im Protokoll stehen nur IDs (E57).
 */
export async function POST(req: Request) {
  // F8/E30: Schreibrecht ueber die zentrale Wache, nicht "irgendwie angemeldet".
  const wache = await wacheFuerRoute("akteur.anlegen");
  if (!wache.ok) return wache.antwort;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Ungültige Eingabe" }, { status: 400 });
  const codes = (await ladeSektoren()).filter((s) => s.aktiv).map((s) => s.code);
  const eingabe = pruefeAkteurEingabe(body, codes);
  if (!eingabe.ok) return Response.json({ error: eingabe.fehler }, { status: 400 });
  const { w, geom } = eingabe;

  try {
    const created = await withDb((db) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(akteur)
          .values({
            name: w.name,
            sektor: w.sektor,
            sitzStrasse: w.sitzStrasse || null,
            sitzHausnummer: w.sitzHausnummer || null,
            sitzPlz: w.sitzPlz,
            sitzOrt: w.sitzOrt,
            sitzGeom: sql`ST_SetSRID(ST_MakePoint(${geom.lng}, ${geom.lat}), 4326)`,
            status: "entwurf",
          })
          .returning({ id: akteur.id, name: akteur.name, sektor: akteur.sektor });
        const ars = await kreisArsDesSitzes(tx, row!.id);
        if (!ars) throw new Error(OHNE_ORT);
        await protokolliere(tx, {
          art: "akteur_angelegt",
          entitaet: "akteur",
          id: row!.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.zugang.email,
        });
        return row!;
      }),
    );
    return Response.json({ akteur: created }, { status: 201 });
  } catch (e) {
    const text = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
    return Response.json({ error: text }, { status: text === OHNE_ORT ? 400 : 500 });
  }
}
