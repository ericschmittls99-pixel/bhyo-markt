import { biomassestrom } from "@bhyo/db/schema";
import { sql } from "drizzle-orm";

import { withDb } from "@/lib/db";
import { protokolliere } from "@/lib/protokoll";
import { zugangFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * WEGWERF (Nachtbericht AP2.7, 06.10.2026): misst die Schreibkosten je Zeile
 * ueber den echten Protokollweg im Worker — Insert biomassestrom + protokolliere
 * je Zeile mit Savepoint, alles in EINER Transaktion, die am Ende zurueckgerollt
 * wird. Die DB bleibt unveraendert (Zaehlung vorher/nachher im Ergebnis).
 */
const ROLLBACK = "MESSUNG_ROLLBACK";

export async function GET(req: Request) {
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const n = Math.min(2000, Math.max(1, Number(new URL(req.url).searchParams.get("n") ?? "200")));
  const t0 = Date.now();
  let ergebnis: Record<string, unknown> = {};
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const zaehle = async () => {
          const r = (await tx.execute(sql`select (select count(*) from biomassestrom)::int as s, (select count(*) from aenderung)::int as a`)) as unknown as { s: number; a: number }[];
          return r[0]!;
        };
        const vorher = await zaehle();
        const ping: number[] = [];
        for (let i = 0; i < 10; i++) { const t = Date.now(); await tx.execute(sql`select 1`); ping.push(Date.now() - t); }
        const [akteur] = (await tx.execute(sql`select id from akteur order by created_at limit 1`)) as unknown as { id: string }[];
        const [mat] = (await tx.execute(sql`select code from materialart limit 1`)) as unknown as { code: string }[];
        const zeilen: number[] = [];
        const tStart = Date.now();
        for (let i = 0; i < n; i++) {
          const t = Date.now();
          await tx.execute(sql`savepoint z`);
          try {
            const [row] = await tx
              .insert(biomassestrom)
              .values({
                akteurId: akteur!.id,
                bezeichnung: `Messung ${i}`,
                ort: "Speyer",
                plz: "67346",
                materialartCode: mat!.code,
                mengeRohFm: "100",
                tsAnteilPct: "30",
                aschegehaltPct: "5",
                zeitraumVon: "2026-01-01",
                zeitraumBis: "2026-12-31",
                saisonalitaet: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
                status: "entwurf",
              })
              .returning({ id: biomassestrom.id });
            await protokolliere(tx, { art: "angelegt", entitaet: "biomassestrom", id: row!.id, benutzerId: wache.zugang.id, benutzerEmail: wache.zugang.email, text: "Messung" });
            await tx.execute(sql`release savepoint z`);
          } catch (e) {
            await tx.execute(sql`rollback to savepoint z`);
            throw e;
          }
          zeilen.push(Date.now() - t);
        }
        const gesamt = Date.now() - tStart;
        const nachher = await zaehle();
        const sorted = [...zeilen].sort((a, b) => a - b);
        ergebnis = {
          n,
          gesamtMs: gesamt,
          proZeileMs: +(gesamt / n).toFixed(1),
          medianMs: sorted[Math.floor(n / 2)],
          p95Ms: sorted[Math.floor(n * 0.95)],
          pingMs: ping,
          vorher,
          inTransaktion: nachher,
        };
        throw new Error(ROLLBACK);
      }),
    );
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) return Response.json({ fehler: String(e) }, { status: 500 });
  }
  const nachRollback = await withDb(async (db) => {
    const r = (await db.execute(sql`select (select count(*) from biomassestrom)::int as s, (select count(*) from aenderung)::int as a`)) as unknown as { s: number; a: number }[];
    return r[0]!;
  });
  return Response.json({ ...ergebnis, nachRollback, wallMs: Date.now() - t0 });
}
