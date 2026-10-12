import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import { DB_ZEITBUDGET, createSql, dbFehlerMeldung } from "./client";

/**
 * Simulierte abgerissene Verbindung: ein nicht routbares Ziel (TEST-NET,
 * RFC 5737) antwortet nie. Ohne connect_timeout hinge der Aufruf; mit dem
 * Zeitbudget kommt ein kontrollierter Fehler mit verstaendlicher Meldung.
 */
describe("Postgres-Client mit Zeitbudget", () => {
  it("Verbindungsaufbau gegen ein totes Ziel endet kontrolliert innerhalb des Budgets", async () => {
    const sql = createSql("postgres://u:p@192.0.2.1:5432/db", { connect_timeout: 1, max: 1 });
    const t0 = Date.now();
    let fehler: unknown = null;
    try {
      await sql`select 1`;
    } catch (e) {
      fehler = e;
    } finally {
      await sql.end({ timeout: 1 });
    }
    const dauer = Date.now() - t0;
    expect(fehler).toBeTruthy();
    expect(dauer).toBeLessThan(5_000);
    expect(dbFehlerMeldung(fehler)).toBe("Die Datenbank war nicht rechtzeitig erreichbar. Bitte die Seite neu laden.");
  }, 15_000);

  it("ordnet Abfrage-Timeout und Verbindungsabriss verstaendliche Meldungen zu, anderes nicht", () => {
    expect(dbFehlerMeldung(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }))).toMatch(/Zeitbudget/);
    expect(dbFehlerMeldung(new Error("Network connection lost."))).toMatch(/abgerissen/);
    expect(dbFehlerMeldung(Object.assign(new Error("x"), { code: "CONNECTION_CLOSED" }))).toMatch(/abgerissen/);
    expect(dbFehlerMeldung(new Error("duplicate key value"))).toBeNull();
  });

  it("Budget ist gesetzt und nicht der Maximalwert", () => {
    expect(DB_ZEITBUDGET.connectTimeoutS).toBe(10);
    expect(DB_ZEITBUDGET.statementTimeoutMs).toBe(15_000);
  });
});

/**
 * Fehlerklasse „Date-Objekt im sql-Template" (Eric 12.10.2026, dritter Fall nach den
 * Proben in #215/#223 und dem Roundup-Job): postgres-js leitet aus einem Date den Typ
 * timestamptz ab, Drizzle setzt in construct() die Serializer der Zeittypen auf die
 * Identitaet (es wandelt Spaltenwerte selbst) — ein Date ohne Spaltenzuordnung erreicht
 * den Puffer roh (ERR_INVALID_ARG_TYPE). createSql sichert das zentral ab.
 */
describe("Date-Parameter im sql-Template (zentral im Client)", () => {
  const datum = new Date("2026-10-12T05:07:19.000Z");
  it("nach dem Drizzle-Aufbau wandelt der Serializer der Zeittypen ein Date in ISO-Text, Text bleibt Text", async () => {
    const sql = createSql("postgres://u:p@192.0.2.1:5432/db", { max: 1 });
    try {
      drizzle(sql);
      for (const typ of ["1184", "1114", "1082", "1083"]) {
        const serialisiere = sql.options.serializers[typ as unknown as number]!;
        expect(serialisiere(datum), `Typ ${typ}`).toBe("2026-10-12T05:07:19.000Z");
        expect(serialisiere("2026-10-12"), `Typ ${typ}`).toBe("2026-10-12");
      }
      // Drizzles Parser bleiben unangetastet (Spaltenwerte kommen als Text, Drizzle wandelt selbst).
      expect(sql.options.parsers[1184]!("2026-10-12 05:07:19+00")).toBe("2026-10-12 05:07:19+00");
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
  it("auch ohne Drizzle (roher Client) bleibt das Date ein ISO-Text", async () => {
    const sql = createSql("postgres://u:p@192.0.2.1:5432/db", { max: 1 });
    try {
      expect(sql.options.serializers[1184]!(datum)).toBe("2026-10-12T05:07:19.000Z");
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
