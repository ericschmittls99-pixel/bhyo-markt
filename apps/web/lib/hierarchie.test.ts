import { describe, expect, it } from "vitest";

import {
  kurzfassung,
  normalisiere,
  schalte,
  trifft,
  zustand,
  type Auswahl,
  type Ebene,
  type Knoten,
} from "./hierarchie";

// Bundesland → Landkreis → Ort, mit echten ARS-Praefixen.
const EBENEN: Ebene[] = [
  { param: "bundesland", label: "Bundesländer" },
  { param: "landkreis", label: "Landkreise" },
  { param: "ort", label: "Orte" },
];

const BAUM: Knoten[] = [
  {
    wert: "08",
    label: "Baden-Württemberg",
    kinder: [
      { wert: "08221", label: "Heidelberg", kinder: [{ wert: "Heidelberg", label: "Heidelberg" }] },
      {
        wert: "08226",
        label: "Rhein-Neckar-Kreis",
        kinder: [
          { wert: "Sinsheim", label: "Sinsheim" },
          { wert: "Schwetzingen", label: "Schwetzingen" },
        ],
      },
    ],
  },
  {
    wert: "07",
    label: "Rheinland-Pfalz",
    kinder: [
      { wert: "07332", label: "Bad Dürkheim", kinder: [{ wert: "Grünstadt", label: "Grünstadt" }] },
      // Zweiter Kreis mit Absicht: Mit nur einem waere Rheinland-Pfalz durch
      // dessen Auswahl sofort vollstaendig und wuerde zusammengefasst — die
      // Faelle "Elternteil bleibt teilweise" liessen sich dann gar nicht
      // pruefen.
      { wert: "07318", label: "Speyer", kinder: [{ wert: "Speyer", label: "Speyer" }] },
    ],
  },
];

const leer = { bundesland: [], landkreis: [], ort: [] };

describe("Elternteil gewählt", () => {
  it("wählt alle Kinder und Enkel implizit", () => {
    const a = { ...leer, bundesland: ["08"] };
    expect(zustand(BAUM[0]!, 0, EBENEN, a)).toBe("gewaehlt");
    // Kinder erben den Zustand ueber elternGewaehlt.
    expect(zustand(BAUM[0]!.kinder![0]!, 1, EBENEN, a, true)).toBe("gewaehlt");
  });

  it("speichert nur die höchste Ebene — nicht alle Kreisschlüssel", () => {
    const a = schalte(BAUM, EBENEN, leer, 0, "08");
    expect(a.bundesland).toEqual(["08"]);
    expect(a.landkreis).toEqual([]);
    expect(a.ort).toEqual([]);
  });
});

describe("Gemischte Auswahl über zwei Ebenen", () => {
  it("Bundesland und ein fremder Landkreis stehen nebeneinander", () => {
    let a: Auswahl = schalte(BAUM, EBENEN, leer, 0, "08");
    a = schalte(BAUM, EBENEN, a, 1, "07332");
    expect(a.bundesland).toEqual(["08"]);
    expect(a.landkreis).toEqual(["07332"]);
  });

  it("ein Ort unter einem nicht gewählten Kreis bleibt eigenständig", () => {
    const a = schalte(BAUM, EBENEN, leer, 2, "Sinsheim");
    expect(a.ort).toEqual(["Sinsheim"]);
    expect(a.bundesland).toEqual([]);
  });
});

describe("Überflüssiges Kind wird entfernt", () => {
  it("wer den Kreis schon hat, braucht den Ort nicht", () => {
    let a: Auswahl = schalte(BAUM, EBENEN, leer, 2, "Sinsheim");
    a = schalte(BAUM, EBENEN, a, 1, "08226");
    // Der Ort ist jetzt implizit — er verlaengert die Adresszeile nur.
    expect(a.landkreis).toEqual(["08226"]);
    expect(a.ort).toEqual([]);
  });

  it("wer das Bundesland wählt, verliert Kreis UND Ort darunter", () => {
    let a: Auswahl = { ...leer, landkreis: ["08221", "07332"], ort: ["Sinsheim", "Grünstadt"] };
    a = schalte(BAUM, EBENEN, a, 0, "08");
    expect(a.bundesland).toEqual(["08"]);
    // Unter 08 faellt alles weg (08221, Sinsheim); 07332 bleibt, es haengt
    // an Rheinland-Pfalz.
    expect(a.landkreis).toEqual(["07332"]);
    // Gruenstadt haengt unter dem GEWAEHLTEN Kreis 07332 und ist damit
    // ebenfalls implizit — normalisiert wird ueber den ganzen Baum, nicht nur
    // unter dem gerade geklickten Knoten.
    expect(a.ort).toEqual([]);
  });

  it("normalisiere ist für sich genommen idempotent", () => {
    const a = { ...leer, bundesland: ["08"], landkreis: ["08221"], ort: ["Sinsheim"] };
    const einmal = normalisiere(BAUM, EBENEN, a);
    expect(normalisiere(BAUM, EBENEN, einmal)).toEqual(einmal);
    expect(einmal.landkreis).toEqual([]);
  });
});

describe("Teilauswahl am Elternteil", () => {
  it("ein Elternteil mit nur einem gewählten Kind zeigt Teilauswahl, nicht gewählt", () => {
    const a = { ...leer, landkreis: ["08221"] };
    expect(zustand(BAUM[0]!, 0, EBENEN, a)).toBe("teilweise");
  });

  it("ohne Auswahl darunter ist er offen", () => {
    expect(zustand(BAUM[0]!, 0, EBENEN, leer)).toBe("offen");
  });

  it("selbst gewählt schlägt Teilauswahl", () => {
    const a = { ...leer, bundesland: ["08"], landkreis: ["08221"] };
    expect(zustand(BAUM[0]!, 0, EBENEN, a)).toBe("gewaehlt");
  });
});

describe("Abwählen", () => {
  it("nimmt nur den Knoten selbst zurück", () => {
    let a: Auswahl = schalte(BAUM, EBENEN, leer, 0, "08");
    a = schalte(BAUM, EBENEN, a, 0, "08");
    expect(a.bundesland).toEqual([]);
  });
});

describe("Kurzfassung statt langer Liste", () => {
  it("ein Eintrag steht allein", () => {
    expect(kurzfassung(BAUM, EBENEN, { ...leer, bundesland: ["08"] })).toBe(
      "Baden-Württemberg",
    );
  });

  it("weitere werden gezählt und nach ihrer Ebene benannt", () => {
    const a = { ...leer, bundesland: ["08"], landkreis: ["07332"] };
    expect(kurzfassung(BAUM, EBENEN, a)).toBe("Baden-Württemberg, +1 Landkreis");
  });

  it("mehrere derselben Ebene bekommen die Mehrzahl", () => {
    const a = { ...leer, landkreis: ["08221", "08226", "07332"] };
    expect(kurzfassung(BAUM, EBENEN, a)).toBe("Heidelberg, +2 Landkreise");
  });

  it("leere Auswahl ergibt keinen Text", () => {
    expect(kurzfassung(BAUM, EBENEN, leer)).toBe("");
  });
});

describe("Treffer: die Ebenen sind ODER-verknüpft", () => {
  const strom = { bundesland: "08", landkreis: "08226", ort: "Sinsheim" };

  it("leere Auswahl trifft alles", () => {
    expect(trifft(leer, EBENEN, strom)).toBe(true);
  });

  it("das Bundesland genügt", () => {
    expect(trifft({ ...leer, bundesland: ["08"] }, EBENEN, strom)).toBe(true);
  });

  it("ein fremder Kreis trifft nicht", () => {
    expect(trifft({ ...leer, landkreis: ["08221"] }, EBENEN, strom)).toBe(false);
  });

  it("eine von zwei Ebenen genügt — nicht beide müssen passen", () => {
    const a = { ...leer, bundesland: ["07"], ort: ["Sinsheim"] };
    expect(trifft(a, EBENEN, strom)).toBe(true);
  });

  it("ein Strom ohne Wert auf der gewählten Ebene trifft nicht", () => {
    const ohne = { bundesland: null, landkreis: null, ort: null };
    expect(trifft({ ...leer, bundesland: ["08"] }, EBENEN, ohne)).toBe(false);
  });
});

describe("Implizit Gewähltes ist einzeln abwählbar (Vorgabe Eric, 25.09.2026)", () => {
  it("ein Kind unter gewähltem Elternteil abwählen löst den Elternteil auf", () => {
    // Ohne das müsste, wer „BW außer einem Kreis" will, das Bundesland
    // abwählen und alle übrigen Kreise einzeln anklicken — dieselbe Auswahl,
    // nur mühsam.
    let a: Auswahl = schalte(BAUM, EBENEN, leer, 0, "08");
    expect(a.bundesland).toEqual(["08"]);

    a = schalte(BAUM, EBENEN, a, 1, "08221");
    // Gespeichert wird die hoechste VOLLSTAENDIG gewaehlte Ebene: BW ist es
    // nicht mehr, also stehen die uebrigen Kreise da.
    expect(a.bundesland).toEqual([]);
    expect(a.landkreis).toEqual(["08226"]);
  });

  it("alle Kinder wieder wählen fasst den Elternteil erneut zusammen", () => {
    let a: Auswahl = { ...leer, landkreis: ["08226"] };
    a = schalte(BAUM, EBENEN, a, 1, "08221");
    expect(a.landkreis).toEqual([]);
    expect(a.bundesland).toEqual(["08"]);
  });

  it("über zwei Ebenen: einen Ort unter gewähltem Land abwählen löst beide auf", () => {
    let a: Auswahl = schalte(BAUM, EBENEN, leer, 0, "08");
    a = schalte(BAUM, EBENEN, a, 2, "Sinsheim");
    expect(a.bundesland).toEqual([]);
    // Heidelberg bleibt als ganzer Kreis (sein einziger Ort ist noch drin),
    // aus dem Rhein-Neckar-Kreis bleibt nur Schwetzingen.
    expect(a.landkreis).toEqual(["08221"]);
    expect(a.ort).toEqual(["Schwetzingen"]);
  });

  it("eine aufgelöste Auswahl ist eine Momentaufnahme", () => {
    // Kommt spaeter ein Kreis dazu, ist er NICHT enthalten — bei einer
    // Ausschluss-Auswahl ist das richtig so.
    let a: Auswahl = schalte(BAUM, EBENEN, leer, 0, "08");
    a = schalte(BAUM, EBENEN, a, 1, "08221");
    const spaeter: Knoten[] = [
      { ...BAUM[0]!, kinder: [...BAUM[0]!.kinder!, { wert: "08999", label: "Neu" }] },
      BAUM[1]!,
    ];
    expect(trifft(a, EBENEN, { bundesland: "08", landkreis: "08999", ort: null })).toBe(
      false,
    );
    // Und die Normalisierung fasst deshalb auch nicht faelschlich zusammen.
    expect(normalisiere(spaeter, EBENEN, a).bundesland).toEqual([]);
  });
});
