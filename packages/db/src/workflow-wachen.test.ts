/**
 * Review Eric (24.09.2026): Das Deploy-Ziel darf nicht allein am Event
 * haengen — ein workflow_dispatch auf einem Feature-Branch haette
 * ungeprueften Code nach Production geschoben. Die `ziel-wache` in
 * deploy.yml schliesst das; dieser Test haelt die Verdrahtung fest.
 *
 * Der bestellte Dispatch-Versuch von einem Wegwerf-Branch ist der Beweis,
 * dass die Wache greift — aber er laeuft einmal von Hand. Dauerhaft geprueft
 * wird hier: dass die Wache existiert und dass Gate und Deploy wirklich an
 * ihr haengen. Besonders die `if`-Bedingung des Deploy-Jobs, denn sie beginnt
 * mit `always()` — ohne die ausdrueckliche Abfrage von
 * `needs.ziel-wache.result` liefe der Deploy trotz roter Wache weiter, und
 * `needs` allein waere wirkungslos.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

describe("deploy.yml: Production nur von main", () => {
  it("hat den Job ziel-wache", () => {
    expect(workflow).toMatch(/^ {2}ziel-wache:$/m);
  });

  it("prueft den Ref gegen refs/heads/main und bricht sonst ab", () => {
    expect(workflow).toContain('"$REF" != "refs/heads/main"');
    expect(workflow).toMatch(/PRODUCTION NUR VON MAIN/);
    // Preview bleibt fuer beliebige Branches erlaubt.
    expect(workflow).toContain('"$EVENT" = "pull_request"');
  });

  it("macht die Wache zur Vorbedingung von schema-gate und deploy", () => {
    expect(workflow).toContain("needs: [typen-und-tests, ziel-wache]");
    expect(workflow).toContain("needs: [typen-und-tests, ziel-wache, schema-gate]");
  });

  it("fragt das Ergebnis der Wache trotz always() ausdruecklich ab", () => {
    expect(workflow).toContain("needs.ziel-wache.result == 'success'");
  });
});

describe("migrate-production.yml: Migration nur von main", () => {
  const migrate = readFileSync(
    new URL("../../../.github/workflows/migrate-production.yml", import.meta.url),
    "utf8",
  );

  it("hat den Job ziel-wache und prueft den Ref", () => {
    expect(migrate).toMatch(/^ {2}ziel-wache:$/m);
    expect(migrate).toContain('"$REF" != "refs/heads/main"');
    expect(migrate).toMatch(/MIGRATION NUR VON MAIN/);
  });

  it("laeuft ohne Environment — sonst greift die Branch-Policy vorher und die Meldung bleibt aus", () => {
    const wache = migrate.slice(migrate.indexOf("  ziel-wache:"), migrate.indexOf("  migrate:"));
    expect(wache).not.toContain("environment:");
  });

  it("macht die Wache zur Vorbedingung des migrate-Jobs", () => {
    expect(migrate).toContain("needs: [ziel-wache]");
  });
});

describe("schema-gate: Zielnachweis", () => {
  it("druckt Host und Datenbank vor dem Urteil", () => {
    const gate = readFileSync(new URL("./schema-gate.ts", import.meta.url), "utf8");
    expect(gate).toContain("GATE host=");
    expect(gate).toContain("db=");
    // Nie die ganze URL: sie traegt das Passwort.
    expect(gate).not.toMatch(/console\.log\([^)]*\$\{url\}/);
  });
});
