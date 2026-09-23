import { describe, expect, it } from "vitest";

import {
  stufeObergrenzeOhneDatei,
  type BelegBewertung,
  berechneGueltigBis,
  deriveQualitaet,
} from "./qualitaet";

// Ein vollstaendiger Beleg je Typ als Ausgangspunkt; einzelne Tests entfernen
// gezielt Felder, um "unvollstaendig" zu erzeugen.
function vollstaendig(overrides: Partial<BelegBewertung> = {}): BelegBewertung {
  return {
    typ: "vertrag",
    externNachvollziehbar: true,
    erhebungsdatum: "2026-01-15",
    dateiKey: "belege/preview/abc.pdf",
    metadata: { quellenangabe: "Vertrag 2026" },
    ...overrides,
  };
}

describe("deriveQualitaet – Matrix vollstaendig", () => {
  it("betriebsdaten vollstaendig -> A", () => {
    expect(deriveQualitaet(vollstaendig({ typ: "betriebsdaten" }))).toBe("A");
  });
  it("vertrag vollstaendig -> A", () => {
    expect(deriveQualitaet(vollstaendig({ typ: "vertrag" }))).toBe("A");
  });
  it("absichtserklaerung vollstaendig -> B", () => {
    expect(deriveQualitaet(vollstaendig({ typ: "absichtserklaerung" }))).toBe(
      "B",
    );
  });
  it("angebot vollstaendig -> C", () => {
    expect(
      deriveQualitaet(
        vollstaendig({ typ: "angebot", gueltigBis: "2026-06-30" }),
      ),
    ).toBe("C");
  });
  it("gespraech vollstaendig -> C", () => {
    expect(
      deriveQualitaet(
        vollstaendig({
          typ: "gespraech",
          dateiKey: null,
          metadata: {
            quellenangabe: "Telefonat",
            gespraechsdatum: "2026-01-10",
            gespraechspartner: "Frau Muster",
          },
        }),
      ),
    ).toBe("C");
  });
});

describe("deriveQualitaet – dokument_link amtlich-Toggle", () => {
  const basis = (): BelegBewertung => ({
    typ: "dokument_link",
    externNachvollziehbar: true,
    erhebungsdatum: "2026-01-15",
    linkUrl: "https://amt.example/quelle",
    metadata: { quellenangabe: "Amtliche Statistik" },
  });

  it("amtlich=true -> B", () => {
    expect(deriveQualitaet({ ...basis(), metadata: { ...basis().metadata, amtlich: true } })).toBe(
      "B",
    );
  });
  it("amtlich=false -> C", () => {
    expect(deriveQualitaet(basis())).toBe("C");
  });
  it("unvollstaendig (kein Link/Datei) -> D, unabhaengig von amtlich", () => {
    expect(
      deriveQualitaet({
        ...basis(),
        linkUrl: null,
        metadata: { quellenangabe: "x", amtlich: true },
      }),
    ).toBe("D");
  });
});

describe("deriveQualitaet – unvollstaendig faellt eine Stufe", () => {
  it("extern_nachvollziehbar=false zieht vertrag von A auf B", () => {
    expect(
      deriveQualitaet(vollstaendig({ externNachvollziehbar: false })),
    ).toBe("B");
  });
  it("fehlende Quellenangabe zieht betriebsdaten von A auf B", () => {
    expect(
      deriveQualitaet(vollstaendig({ typ: "betriebsdaten", metadata: {} })),
    ).toBe("B");
  });
  it("angebot ohne gueltig_bis -> D", () => {
    expect(deriveQualitaet(vollstaendig({ typ: "angebot" }))).toBe("D");
  });
  it("vertrag nur mit Link (ohne Datei) -> B", () => {
    expect(
      deriveQualitaet(vollstaendig({ dateiKey: null, linkUrl: "https://x" })),
    ).toBe("B");
  });
});

describe("berechneGueltigBis", () => {
  it("betriebsdaten -> Erhebungsdatum + 12 Monate", () => {
    expect(berechneGueltigBis("betriebsdaten", "2026-01-15")).toBe(
      "2027-01-15",
    );
  });
  it("angebot -> uebernimmt Nutzereingabe", () => {
    expect(berechneGueltigBis("angebot", "2026-01-15", "2026-06-30")).toBe(
      "2026-06-30",
    );
  });
  it("vertrag -> kein automatisches gueltig_bis", () => {
    expect(berechneGueltigBis("vertrag", "2026-01-15")).toBeNull();
  });
});

// F7: Live-Hinweis im Formular — Obergrenze je Typ ohne Datei/Link.
describe("stufeObergrenzeOhneDatei", () => {
  it("nennt je Typ die Stufe, die ohne Datei/Link maximal erreichbar ist", () => {
    expect(stufeObergrenzeOhneDatei("vertrag")).toBe("B");
    expect(stufeObergrenzeOhneDatei("betriebsdaten")).toBe("B");
    expect(stufeObergrenzeOhneDatei("absichtserklaerung")).toBe("C");
    expect(stufeObergrenzeOhneDatei("angebot")).toBe("D");
    expect(stufeObergrenzeOhneDatei("dokument_link")).toBe("D");
  });

  it("liefert null, wenn eine Datei die Stufe nicht hoebe (Gespraech)", () => {
    expect(stufeObergrenzeOhneDatei("gespraech")).toBeNull();
  });
});
