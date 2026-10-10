/**
 * E73 (Eric 10.10.2026): die Fehlerklasse fuer job_lauf.fehler traegt nie
 * Parameter — ein simulierter Drizzle-Fehler mit einer Adresse in den params
 * landet nur als Klasse und Code.
 */
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { fehlerKlasse, istFehlerKlasse } from "./fehler";

class PostgresError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PostgresError";
    this.code = code;
  }
}

describe("fehlerKlasse", () => {
  it("Drizzle-Fehler mit Adresse in den params: nur Klasse und SQLSTATE, keine Adresse", () => {
    const e = new DrizzleQueryError('insert into "aenderung" (…) values ($1, $2)', ["u1", "eric.schmitt@bhyo.de"], new PostgresError('duplicate key value violates unique constraint "x" (eric.schmitt@bhyo.de)', "23505"));
    expect(e.message).toContain("eric.schmitt@bhyo.de"); // die Simulation traegt die Adresse wirklich
    const klasse = fehlerKlasse(e);
    expect(klasse).toBe("db_fehler/PostgresError/23505");
    expect(klasse).not.toMatch(/@/);
    expect(istFehlerKlasse(klasse)).toBe(true);
  });
  it("postgres.js-Verbindungsfehler, Graph-Ursache, sonstige Fehler, Nicht-Fehler", () => {
    const verbindung = Object.assign(new Error("write CONNECT_TIMEOUT host=db.example"), { code: "CONNECT_TIMEOUT" });
    expect(fehlerKlasse(verbindung)).toBe("db_fehler/Error/CONNECT_TIMEOUT");
    const graph = Object.assign(new Error("Graph: gedrosselt (HTTP 429)"), { name: "GraphFehler", ursache: "gedrosselt" });
    expect(fehlerKlasse(graph)).toBe("graph/gedrosselt");
    expect(fehlerKlasse(new TypeError("x is not a function at eric@bhyo.de"))).toBe("fehler/TypeError");
    expect(fehlerKlasse("kaputt")).toBe("fehler/unbekannt");
    expect(fehlerKlasse(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toBe("fehler/Error/ECONNRESET");
  });
  it("istFehlerKlasse: alte Freitexte werden nicht als Klasse gedruckt", () => {
    expect(istFehlerKlasse("Failed query: insert … params: eric@bhyo.de")).toBe(false);
    expect(istFehlerKlasse(null)).toBe(false);
    expect(istFehlerKlasse("db_fehler/PostgresError")).toBe(true);
  });
});
