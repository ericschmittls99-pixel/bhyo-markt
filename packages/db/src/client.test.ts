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
