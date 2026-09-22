import { describe, expect, it } from "vitest";

import { pruefeSeedZiel, pruefeStammdaten } from "./seed-guard";

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

describe("pruefeStammdaten (kein Ersatzwert, Abbruch mit Code)", () => {
  const bekannt = {
    bekannteMaterialarten: ["waldrestholz", "stroh"],
    bekannteProdukte: ["co2", "synthesegas", "asche"],
  };

  it("bricht bei einem erfundenen Produktcode ab und nennt genau diesen Code", () => {
    const ergebnis = pruefeStammdaten({
      ...bekannt,
      verwendeteMaterialarten: ["waldrestholz"],
      verwendeteProdukte: ["co2", "biokohle_premium"],
    });
    expect(ergebnis).not.toBeNull();
    expect(ergebnis!.fehler).toContain('"biokohle_premium"');
    expect(ergebnis!.fehler).toContain("output_produkt");
    // Die Meldung weist den Weg: Migration ODER Spezifikation — nie Ersatz.
    expect(ergebnis!.fehler).toMatch(/Migration/);
    expect(ergebnis!.fehler).toMatch(/Spezifikation/);
  });

  it("bricht bei einer fehlenden Materialart ab und nennt genau diesen Code", () => {
    const ergebnis = pruefeStammdaten({
      ...bekannt,
      verwendeteMaterialarten: ["stroh", "torf"],
      verwendeteProdukte: ["asche"],
    });
    expect(ergebnis).not.toBeNull();
    expect(ergebnis!.fehler).toContain('"torf"');
    expect(ergebnis!.fehler).toContain("materialart");
  });

  it("nennt mehrere fehlende Codes vollstaendig und ohne Dubletten", () => {
    const ergebnis = pruefeStammdaten({
      ...bekannt,
      verwendeteMaterialarten: ["torf", "torf"],
      verwendeteProdukte: ["pflanzenkohle", "methanol"],
    });
    expect(ergebnis!.fehler).toContain('"torf"');
    expect(ergebnis!.fehler).toContain('"pflanzenkohle"');
    expect(ergebnis!.fehler).toContain('"methanol"');
    expect(ergebnis!.fehler.match(/"torf"/g)).toHaveLength(1);
  });

  it("laesst vollstaendig vorhandene Stammdaten durch", () => {
    const ergebnis = pruefeStammdaten({
      ...bekannt,
      verwendeteMaterialarten: ["waldrestholz", "stroh"],
      verwendeteProdukte: ["co2", "asche"],
    });
    expect(ergebnis).toBeNull();
  });
});
