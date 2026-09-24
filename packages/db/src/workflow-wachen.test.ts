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

describe("lese-diagnose.yml: der Leseweg", () => {
  // Ohne Kommentare: Der erklaerende Vorspann dieses Workflows NENNT die
  // ziel-wache und `main`, um zu begruenden, warum es sie hier nicht gibt.
  // Ein Guard, der daran scheitert, wird durch Umformulieren umgangen statt
  // befolgt — geprueft wird, was YAML tatsaechlich ausfuehrt.
  const leseweg = readFileSync(
    new URL("../../../.github/workflows/lese-diagnose.yml", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((z) => !/^\s*#/.test(z))
    .join("\n");

  it("laeuft im Environment production-lesend, nicht in production", () => {
    expect(leseweg).toContain("environment: production-lesend");
    // Ein Tippfehler hier waere fatal: `production` traegt die schreibende
    // Zugangsberechtigung UND die main-Policy — der Leseweg liefe dann mit
    // Schreibrechten und nur noch von main.
    expect(leseweg).not.toMatch(/environment: production\s*$/m);
  });

  it("hat bewusst KEINE Branch-Wache — er soll von jedem Branch laufen", () => {
    expect(leseweg).not.toContain("ziel-wache");
    expect(leseweg).not.toContain("refs/heads/main");
  });

  it("nutzt ausschliesslich das lesende Secret", () => {
    expect(leseweg).toContain("DATABASE_URL_PRODUCTION_LESEND");
    expect(leseweg).not.toMatch(/DATABASE_URL_PRODUCTION\s*\}\}/);
  });

  it("das Skript prueft den Schreibversuch, statt ihn zu behaupten", () => {
    const skript = readFileSync(new URL("./lese-diagnose.ts", import.meta.url), "utf8");
    expect(skript).toContain("SCHREIBVERSUCH");
    expect(skript).toContain("insert into");
    expect(skript).toContain("update ");
    // Zielnachweis im gewohnten Format, mit Rolle.
    expect(skript).toContain("LESEND host=");
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
