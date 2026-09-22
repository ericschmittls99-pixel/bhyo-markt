import { describe, expect, it } from "vitest";

import { naechsteVerifizierung, verifikationsFaelligkeit } from "./verifizierung";

const beleg = {
  typ: "vertrag",
  gueltigBis: null,
  erhebungsdatum: "2026-01-15",
}; // Frist: +36 Monate = 2029-01-15

const strom = {
  zeitraumBis: null as string | null,
  reserviertSeit: null as string | null,
};

describe("naechsteVerifizierung (Bestand)", () => {
  it("rechnet die Typ-Frist aus dem Erhebungsdatum", () => {
    expect(naechsteVerifizierung(beleg)).toBe("2029-01-15");
  });
});

describe("verifikationsFaelligkeit (AP1j PR 5: Kopplung an Ablaufdaten)", () => {
  it("ohne Ablaufdaten gilt die bisherige Frist", () => {
    expect(verifikationsFaelligkeit(beleg, strom, [])).toBe("2029-01-15");
  });

  it("verfuegbar-bis vor der Frist zieht die Faelligkeit vor", () => {
    expect(
      verifikationsFaelligkeit(beleg, { ...strom, zeitraumBis: "2027-06-30" }, []),
    ).toBe("2027-06-30");
  });

  it("das frueheste vergeben-bis gewinnt (Zweck: beim Freiwerden nachfassen)", () => {
    expect(
      verifikationsFaelligkeit(beleg, { ...strom, zeitraumBis: "2030-12-31" }, [
        { vergebenBis: "2028-02-28" },
        { vergebenBis: "2026-10-31" },
      ]),
    ).toBe("2026-10-31");
  });

  it("offene Vergabe-Enden (null) zaehlen nicht — das deckt verfuegbar-bis ab", () => {
    expect(
      verifikationsFaelligkeit(beleg, { ...strom, zeitraumBis: "2027-06-30" }, [
        { vergebenBis: null },
      ]),
    ).toBe("2027-06-30");
  });

  it("Reservierung: 12 Monate Gueltigkeit ab reserviert_seit (Typ-Tabelle, kein Sonderweg)", () => {
    expect(
      verifikationsFaelligkeit(
        beleg,
        { zeitraumBis: "2030-12-31", reserviertSeit: "2026-09-22" },
        [],
      ),
    ).toBe("2027-09-22");
  });

  it("funktioniert ohne Beleg — Ablaufdaten allein machen faellig", () => {
    expect(
      verifikationsFaelligkeit(null, { ...strom, zeitraumBis: "2027-06-30" }, []),
    ).toBe("2027-06-30");
  });

  it("ohne jeden Kandidaten null", () => {
    expect(verifikationsFaelligkeit(null, strom, [])).toBeNull();
  });
});
