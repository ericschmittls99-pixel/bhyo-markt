import { withDb } from "@/lib/db";
import { fmtRelativ } from "@/lib/format";
import { ladeEintraege } from "@/lib/inbox/server";
import { zugangFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/** E77 R5: Anzahl der Zeilen im Pop-up an der Glocke. */
const KURZ_ANZAHL = 5;

/**
 * E77 R5: Die letzten offenen Eintraege fuer das Pop-up an der Glocke — erst
 * beim Oeffnen geladen, damit kein Seitenaufruf die Inbox-Abfrage bezahlt
 * (der Zaehler im Layout bleibt die einzige Abfrage je Seite). Dieselbe
 * Abfrage und Zeile wie inbox. (ladeEintraege), nur auf fuenf abgeschnitten.
 * Lesen laeuft ueber die Wache (fail closed); eine Lese-Server-Action waere
 * fuer rechte-check ein Schreibpfad ohne Aktion, deshalb eine GET-Route.
 */
export async function GET() {
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const nutzerId = wache.zugang.id;
  const eintraege = await withDb((db) => ladeEintraege(db, nutzerId, "offen", { limit: KURZ_ANZAHL }));
  const jetzt = new Date();
  return Response.json({ zeilen: eintraege.map((e) => ({ ...e, zeit: fmtRelativ(e.aktualisiertAm, jetzt) })) });
}
