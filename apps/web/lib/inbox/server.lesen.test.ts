/**
 * E77 R5 (Bedingung Eric 13.10.2026): ladeEintraege filtert auf
 * empfaenger_id = Nutzer-ID — fremde Eintraege kommen nie zurueck, weder in
 * inbox. noch im Pop-up (GET /api/inbox/kurz, das dieselbe Funktion ruft).
 * Ohne Datenbank: eine Leser-Attrappe faengt das WHERE ab, der Pg-Dialekt
 * rendert es zu SQL und Parametern.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ladeEintraege, type Leser } from "./server";

function attrappe() {
  const auf: { where?: unknown; limit?: number } = {};
  const kette: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "orderBy"]) kette[m] = () => kette;
  kette.where = (w: unknown) => {
    auf.where = w;
    return kette;
  };
  kette.limit = (n: number) => {
    auf.limit = n;
    return kette;
  };
  (kette as { then: unknown }).then = (res: (v: unknown[]) => void) => res([]);
  const db = { select: () => kette } as unknown as Leser;
  return { db, auf };
}

const sqlVon = (w: unknown) => new PgDialect().sqlToQuery(w as never);

describe("E77 R5: ladeEintraege liest nur die eigenen Eintraege", () => {
  it("WHERE traegt empfaenger_id = <Nutzer-ID> und zustand = offen; ohne limit keine Begrenzung", async () => {
    const { db, auf } = attrappe();
    await ladeEintraege(db, "u-eric", "offen");
    const q = sqlVon(auf.where);
    expect(q.sql).toContain('"inbox_eintrag"."empfaenger_id" = $1');
    expect(q.sql).toContain('"inbox_eintrag"."zustand" = $2');
    expect(q.params).toEqual(["u-eric", "offen"]);
    expect(auf.limit).toBeUndefined();
  });

  it("Pop-up: dieselbe Abfrage mit limit 5, die Nutzer-ID bleibt der einzige Empfaenger-Filter", async () => {
    const { db, auf } = attrappe();
    await ladeEintraege(db, "u-anna", "offen", { limit: 5 });
    const q = sqlVon(auf.where);
    expect(q.params).toEqual(["u-anna", "offen"]);
    expect(auf.limit).toBe(5);
  });

  it("Erledigt-Sicht: zustand <> offen, weiterhin nur der eigene Empfaenger", async () => {
    const { db, auf } = attrappe();
    await ladeEintraege(db, "u-eric", "erledigt");
    const q = sqlVon(auf.where);
    expect(q.sql).toContain('"inbox_eintrag"."empfaenger_id" = $1');
    expect(q.sql).toContain('"inbox_eintrag"."zustand" <> $2');
    expect(q.params).toEqual(["u-eric", "offen"]);
  });
});
