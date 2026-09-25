import { describe, expect, it } from "vitest";

import {
  baumMaterialart,
  baumOrt,
  baumProdukt,
  ortsSchluessel,
  type BaumStrom,
} from "./hierarchie-baeume";

function strom(t: Partial<BaumStrom> = {}): BaumStrom {
  return {
    cluster: null,
    materialartCode: null,
    materialartLabel: null,
    gruppe: null,
    produktCode: null,
    produktLabel: null,
    ort: null,
    verwaltung: null,
    ...t,
  };
}

const kreis = (kreisArs: string, kreisName: string, landArs: string, landName: string) => ({
  kreisArs,
  kreisName,
  landArs,
  landName,
});

describe("Ortsnamen werden fürs Gruppieren vereinheitlicht", () => {
  it("Leerraum, Mehrfach-Leerzeichen und Großschreibung fallen weg", () => {
    expect(ortsSchluessel("  Bad   Dürkheim ")).toBe("bad dürkheim");
    expect(ortsSchluessel("SPEYER")).toBe("speyer");
    expect(ortsSchluessel("Speyer")).toBe(ortsSchluessel("speyer "));
  });

  it("verschiedene Schreibweisen ergeben EINEN Eintrag", () => {
    const baum = baumOrt([
      strom({ ort: "Speyer", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
      strom({ ort: "speyer ", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
      strom({ ort: "SPEYER", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
    ]);
    const orte = baum[0]!.kinder![0]!.kinder!;
    expect(orte).toHaveLength(1);
    expect(orte[0]!.wert).toBe("speyer");
  });

  it("angezeigt wird die häufigste Schreibweise", () => {
    const baum = baumOrt([
      strom({ ort: "Speyer", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
      strom({ ort: "Speyer", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
      strom({ ort: "SPEYER", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
    ]);
    expect(baum[0]!.kinder![0]!.kinder![0]!.label).toBe("Speyer");
  });

  it("bei Gleichstand entscheidet nicht die Zeilenreihenfolge", () => {
    const a = baumOrt([
      strom({ ort: "Speyer", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
      strom({ ort: "SPEYER", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
    ]);
    const b = baumOrt([
      strom({ ort: "SPEYER", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
      strom({ ort: "Speyer", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
    ]);
    // Dieselbe Datenlage, dieselbe Anzeige — sonst haengt der Baum an der
    // Sortierung der Abfrage.
    expect(a[0]!.kinder![0]!.kinder![0]!.label).toBe(b[0]!.kinder![0]!.kinder![0]!.label);
  });
});

describe("Leere Äste erscheinen nicht", () => {
  it("ein Bundesland ohne Ströme taucht gar nicht auf", () => {
    const baum = baumOrt([
      strom({ ort: "Speyer", verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
    ]);
    expect(baum.map((l) => l.wert)).toEqual(["07"]);
  });

  it("ein Kreis ohne Ortsangabe bleibt als Kreis, aber ohne leere Ortszeile", () => {
    const baum = baumOrt([
      strom({ ort: null, verwaltung: kreis("07318", "Speyer", "07", "RLP") }),
    ]);
    expect(baum[0]!.kinder![0]!.kinder).toEqual([]);
  });

  it("Ströme ohne Koordinate oder außerhalb erscheinen nicht im Baum", () => {
    // Sie behalten ihre benannten Zustaende aus E24/F0b und sind ueber die
    // eigenen Filterwerte erreichbar — als leerer Ast waeren sie irrefuehrend.
    const baum = baumOrt([strom({ ort: "Irgendwo", verwaltung: null })]);
    expect(baum).toEqual([]);
  });

  it("ein Cluster ohne Materialart erscheint nicht", () => {
    const baum = baumMaterialart([strom({ cluster: "lignozellulose" })], {});
    expect(baum).toEqual([]);
  });
});

describe("Cluster → Materialart", () => {
  it("gruppiert und sortiert nach Beschriftung", () => {
    const baum = baumMaterialart(
      [
        strom({ cluster: "holz", materialartCode: "saegemehl", materialartLabel: "Sägemehl" }),
        strom({ cluster: "holz", materialartCode: "altholz", materialartLabel: "Altholz" }),
        strom({ cluster: "bio", materialartCode: "guelle", materialartLabel: "Gülle" }),
      ],
      { holz: "Holz", bio: "Biogen" },
    );
    expect(baum.map((k) => k.label)).toEqual(["Biogen", "Holz"]);
    expect(baum[1]!.kinder!.map((k) => k.label)).toEqual(["Altholz", "Sägemehl"]);
  });

  it("dieselbe Materialart doppelt ergibt einen Eintrag", () => {
    const baum = baumMaterialart(
      [
        strom({ cluster: "holz", materialartCode: "saegemehl", materialartLabel: "Sägemehl" }),
        strom({ cluster: "holz", materialartCode: "saegemehl", materialartLabel: "Sägemehl" }),
      ],
      { holz: "Holz" },
    );
    expect(baum[0]!.kinder).toHaveLength(1);
  });
});

describe("Gruppe → Produkt", () => {
  it("gruppiert und sortiert", () => {
    const baum = baumProdukt(
      [
        strom({ gruppe: "wasserstoff", produktCode: "h2_hd", produktLabel: "H2 (Hochdruck)" }),
        strom({ gruppe: "wasserstoff", produktCode: "h2_nd", produktLabel: "H2 (Niederdruck)" }),
        strom({ gruppe: "derivate", produktCode: "methanol", produktLabel: "Methanol" }),
      ],
      { wasserstoff: "Wasserstoff", derivate: "Derivate" },
    );
    expect(baum.map((k) => k.label)).toEqual(["Derivate", "Wasserstoff"]);
    expect(baum[1]!.kinder!.map((k) => k.label)).toEqual([
      "H2 (Hochdruck)",
      "H2 (Niederdruck)",
    ]);
  });
});

describe("Der Ort hängt am Kreis desselben Stroms", () => {
  it("derselbe Ortsname in zwei Kreisen bleibt getrennt", () => {
    // "Neustadt" gibt es mehrfach — ohne die Einschraenkung auf den Kreis
    // wuerden zwei verschiedene Orte zu einem Filterwert verschmelzen.
    const baum = baumOrt([
      strom({ ort: "Neustadt", verwaltung: kreis("07316", "Neustadt/W.", "07", "RLP") }),
      strom({ ort: "Neustadt", verwaltung: kreis("08226", "Rhein-Neckar", "08", "BW") }),
    ]);
    expect(baum).toHaveLength(2);
    expect(baum[0]!.kinder![0]!.kinder![0]!.wert).toBe("neustadt");
    expect(baum[1]!.kinder![0]!.kinder![0]!.wert).toBe("neustadt");
  });
});

describe("Ein Kreis ohne Bundesland", () => {
  it("erscheint nicht im Baum, statt an einem geratenen Ast zu hängen", () => {
    // Kann vorkommen, wenn der ARS-Praefix kein Land trifft (E25). Ihn
    // irgendwo einzuhaengen waere geraten; ueber den Kreis-Filterwert bleibt
    // er erreichbar.
    const baum = baumOrt([
      strom({
        ort: "Irgendwo",
        verwaltung: { kreisArs: "99999", kreisName: "Unbekannt", landArs: null, landName: null },
      }),
    ]);
    expect(baum).toEqual([]);
  });
});
