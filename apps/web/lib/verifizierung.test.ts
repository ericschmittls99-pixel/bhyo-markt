import { describe, expect, it } from "vitest";

import { BELEG_MONATE, naechsteVerifizierung, verifikationsFaelligkeit } from "./verifizierung";

// E33: Vertrag gehoert zu den oberen vier — seine Faelligkeit ist das
// gespeicherte gueltig_bis, keine Typ-Frist.
const beleg = {
  typ: "vertrag",
  gueltigBis: "2029-01-15",
  erhebungsdatum: "2026-01-15",
};

const strom = {
  zeitraumBis: null as string | null,
  reserviertSeit: null as string | null,
};

describe("naechsteVerifizierung (E33: eine Quelle je Beleg)", () => {
  it("obere vier Typen: gueltig_bis ist die Faelligkeit", () => {
    expect(naechsteVerifizierung(beleg)).toBe("2029-01-15");
    expect(
      naechsteVerifizierung({ typ: "angebot", gueltigBis: "2026-11-30", erhebungsdatum: "2026-01-15" }),
    ).toBe("2026-11-30");
  });

  it("obere vier ohne gueltig_bis: keine Frist (null) — keine Typ-Frist als Ersatz", () => {
    expect(naechsteVerifizierung({ ...beleg, gueltigBis: null })).toBeNull();
    expect(
      naechsteVerifizierung({ typ: "betriebsdaten", gueltigBis: null, erhebungsdatum: "2026-01-15" }),
    ).toBeNull();
  });

  it("untere drei: Typ-Frist ab Erhebungsdatum — Gespraech 3, Dokument 6, Webrecherche 3 Monate", () => {
    const am = "2026-01-15";
    expect(naechsteVerifizierung({ typ: "gespraech", gueltigBis: null, erhebungsdatum: am })).toBe("2026-04-15");
    expect(naechsteVerifizierung({ typ: "dokument", gueltigBis: null, erhebungsdatum: am })).toBe("2026-07-15");
    expect(naechsteVerifizierung({ typ: "webrecherche", gueltigBis: null, erhebungsdatum: am })).toBe("2026-04-15");
  });

  it("untere drei ignorieren ein gueltig_bis — eine Quelle, nicht zwei", () => {
    expect(
      naechsteVerifizierung({ typ: "gespraech", gueltigBis: "2030-01-01", erhebungsdatum: "2026-01-15" }),
    ).toBe("2026-04-15");
  });

  it("BELEG_MONATE kennt nur noch die unteren drei Typen und die Reservierung", () => {
    expect(Object.keys(BELEG_MONATE).sort()).toEqual(["dokument", "gespraech", "reservierung", "webrecherche"]);
    // Die alten Zahlen sind ungueltig (Angebot 3/6, Dokument/Link 12/24, Gespraech 6/12).
    expect(BELEG_MONATE.dokument_link).toBeUndefined();
    expect(BELEG_MONATE.angebot).toBeUndefined();
    expect(BELEG_MONATE.vertrag).toBeUndefined();
  });
});

describe("verifikationsFaelligkeit (AP1j PR 5: Kopplung an Ablaufdaten)", () => {
  it("ohne Ablaufdaten gilt die Belegfrist", () => {
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
