import { describe, expect, it } from "vitest";

import { pruefeSeedZiel } from "./seed-guard";

describe("pruefeSeedZiel (Seed-Guard §0)", () => {
  it("bricht ab, wenn SEED_DATABASE_URL_PREVIEW fehlt — auch wenn DATABASE_URL gesetzt ist", () => {
    const ergebnis = pruefeSeedZiel({ DATABASE_URL: "postgres://x@irgendwo/db" });
    expect(ergebnis).toHaveProperty("fehler");
  });

  it("bricht bei 'prod' in der URL ab (case-insensitiv)", () => {
    const ergebnis = pruefeSeedZiel({
      SEED_DATABASE_URL_PREVIEW: "postgres://x@db.example/markt_PROD",
    });
    expect(ergebnis).toHaveProperty("fehler");
  });

  it("bricht beim echten Production-Endpoint ab, obwohl dessen URL kein 'prod' enthaelt", () => {
    const ergebnis = pruefeSeedZiel({
      SEED_DATABASE_URL_PREVIEW:
        "postgres://user:pw@ep-purple-glade-b2tra1g7.c-6.eu-central-1.aws.neon.tech/neondb",
    });
    expect(ergebnis).toHaveProperty("fehler");
  });

  it("laesst die Preview-URL durch und reicht sie unveraendert zurueck", () => {
    const url =
      "postgres://user:pw@ep-rough-term-b29rvd6c.c-6.eu-central-1.aws.neon.tech/neondb";
    expect(pruefeSeedZiel({ SEED_DATABASE_URL_PREVIEW: url })).toEqual({ url });
  });
});
