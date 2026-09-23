import { describe, expect, it, vi } from "vitest";

import {
  aggregiere,
  bboxKm,
  faecherLayout,
  fanStart,
  farbGruppen,
  geojsonOderNull,
  gruppenGroesse,
  markerGroesse,
  maxMengeJe,
  partGroesse,
  punkteInBbox,
  popoverZeilen,
  ringStil,
  stromZuPunkt,
  sucheKarte,
  type KartePunkt,
} from "./karte-modell";
import type { Strom } from "./stroeme-modell";

const basis: Strom = {
  id: "b1",
  art: "biomasse",
  akteurName: "Hof Müller",
  sektor: "landwirtschaft",
  bezeichnung: "Rindergülle",
  kontaktperson: null,
  ort: "Rülzheim",
  verwaltung: null,
  regionIds: ["r1"],
  regionNamen: ["Südpfalz"],
  lng: 8.4,
  lat: 49.2,
  cluster: "guelle_mist",
  materialartCode: "rinderguelle",
  materialartLabel: "Rindergülle",
  mengeFm: 1200,
  tsAnteil: 8.5,
  aschegehalt: 15,
  mengeAtro: 102,
  preisMin: null,
  preisMittel: null,
  preisMax: null,
  preisHerkunft: null,
  gruppe: null,
  gruppeLabel: null,
  produktCode: null,
  produktLabel: null,
  kategorie: null,
  mengeWert: null,
  mengeEinheit: null,
  preis: null,
  preisEinheit: null,
  zeitraumVon: "2026-01-01",
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: "B",
  status: "geprueft",
  reserviertBhyo: false,
  reserviertSeit: null,
  erstelltAm: "2026-09-01",
  beleg: null,
  vollstaendigkeit: 70,
};

const outputStrom: Strom = {
  ...basis,
  id: "o1",
  art: "output",
  akteurName: "Stadtwerke",
  cluster: null,
  materialartLabel: null,
  mengeAtro: null,
  gruppe: "wasserstoff",
  gruppeLabel: "Wasserstoff",
  produktLabel: "Wasserstoff (Druck)",
  mengeWert: 50,
  mengeEinheit: "t/a",
  lng: 8.6,
  lat: 49.3,
};

describe("stromZuPunkt", () => {
  it("Biomasse: atro-Menge, Cluster-Key, t atro/a, Titel = Akteur", () => {
    const p = stromZuPunkt(basis)!;
    expect(p.menge).toBe(102);
    expect(p.farbeKey).toBe("guelle_mist");
    expect(p.einheit).toBe("t atro/a");
    expect(p.titel).toBe("Hof Müller");
    expect(p.untertitel).toBe("Rindergülle");
  });
  it("Output: mengeWert + Einheit, Gruppen-Key, Produkt-Label", () => {
    const p = stromZuPunkt(outputStrom)!;
    expect(p.menge).toBe(50);
    expect(p.einheit).toBe("t/a");
    expect(p.farbeKey).toBe("wasserstoff");
    expect(p.untertitel).toBe("Wasserstoff (Druck)");
  });
  it("ohne Pin → null (kein Fehler, kein Log)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(stromZuPunkt({ ...basis, lng: null, lat: null })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("nimmt den Status-Text mit (Label je Art, PR 3)", () => {
    const p = stromZuPunkt({
      ...outputStrom,
      verfuegbarkeit: { status: "vergeben_extern", reserviertZusatz: false },
    })!;
    expect(p.statusText).toBe("gedeckt (extern).");
  });
  it("ohne abgeleiteten Status: leerer Text", () => {
    expect(stromZuPunkt(basis)!.statusText).toBe("");
  });
});

// E24: unbelegt (null) hat einen eigenen, expliziten Ring — kein Fallback auf D.
// E24/E27: je Zustand ein Testfall — Optik UND Rangfolge.
describe("ringStil je Zustand (E24/E27)", () => {
  it("A–D: theme-abhaengige Tokens statt fester Hex-Werte", () => {
    expect(ringStil("A")).toEqual({ breite: 3, stil: "solid", farbe: "var(--ring-a)" });
    expect(ringStil("B")).toEqual({ breite: 2.5, stil: "solid", farbe: "var(--ring-b)" });
    expect(ringStil("C")).toEqual({ breite: 2, stil: "dashed", farbe: "var(--ring-c)" });
    expect(ringStil("D")).toEqual({ breite: 1.5, stil: "dotted", farbe: "var(--ring-d)" });
  });

  it("Rangfolge traegt dreifach: Breite faellt A→D, Strichart wechselt", () => {
    const breiten = (["A", "B", "C", "D"] as const).map((z) => ringStil(z).breite);
    expect(breiten).toEqual([...breiten].sort((a, b) => b - a));
    expect(new Set(breiten).size).toBe(4);
    const arten = (["A", "B", "C", "D"] as const).map((z) => ringStil(z).stil);
    expect(arten).toEqual(["solid", "solid", "dashed", "dotted"]);
  });

  it("unbelegt: zurueckhaltend gestrichelt, unterscheidbar von D (dotted)", () => {
    const u = ringStil("unbelegt");
    expect(u).toEqual({ breite: 1.5, stil: "dashed", farbe: "var(--ring-unbelegt)" });
    expect(u.stil).not.toBe(ringStil("D").stil);
  });

  it("ausserhalb: faellt auf — breiteste, doppelte Kontur in voller Ringfarbe", () => {
    const a = ringStil("ausserhalb");
    expect(a).toEqual({ breite: 4, stil: "double", farbe: "var(--ring-ausserhalb)" });
    expect(a.breite).toBeGreaterThan(ringStil("A").breite);
    expect(a.stil).not.toBe(ringStil("unbelegt").stil);
  });

  it("jeder Zustand hat eine eigene Optik (kein Zustand faellt mit einem anderen zusammen)", () => {
    const alle = ["A", "B", "C", "D", "unbelegt", "ausserhalb"] as const;
    const signaturen = alle.map((z) => JSON.stringify(ringStil(z)));
    expect(new Set(signaturen).size).toBe(alle.length);
  });
});

// E24 auf der Karte: der Zustand entsteht aus Stufe + raeumlicher Lage.
describe("ringZustand am Kartenpunkt", () => {
  const speyer = { kreisArs: "07318", kreisName: "Speyer", kreisBez: "Kreisfreie Stadt", landArs: "07", landName: "Rheinland-Pfalz" };
  it("Stufe mit Gebiet -> die Stufe", () => {
    expect(stromZuPunkt({ ...basis, qualitaet: "B", verwaltung: speyer })!.ringZustand).toBe("B");
  });
  it("kein Beleg, aber im Gebiet -> unbelegt", () => {
    expect(stromZuPunkt({ ...basis, qualitaet: null, verwaltung: speyer })!.ringZustand).toBe("unbelegt");
  });
  it("Koordinate in keinem Gebiet -> ausserhalb, auch mit Stufe A", () => {
    expect(stromZuPunkt({ ...basis, qualitaet: "A", verwaltung: null })!.ringZustand).toBe("ausserhalb");
  });
  it("ohne Koordinate -> gar kein Pin (nur Legende)", () => {
    expect(stromZuPunkt({ ...basis, lng: null, lat: null })).toBeNull();
  });
});

describe("markerGroesse (Mockup: 30 + 32·√v, v geclampt 0–1)", () => {
  it("skaliert 30–62", () => {
    expect(markerGroesse(0, 100)).toBe(30);
    expect(markerGroesse(100, 100)).toBe(62);
    expect(markerGroesse(25, 100)).toBe(46);
  });
  it("maxMenge 0: Mockup teilt durch 1 und clampt", () => {
    expect(markerGroesse(5, 0)).toBe(62);
    expect(markerGroesse(0.25, 0)).toBe(46);
  });
});

describe("gruppenGroesse / partGroesse (Mockup)", () => {
  it("Gruppe: √(Σ D²), gedeckelt auf 72; Wrapper +12 macht der Renderer", () => {
    expect(gruppenGroesse([30, 40])).toBe(50);
    expect(gruppenGroesse([62, 62, 62])).toBe(72);
  });
  it("Part: 45 % des Gruppen-D, geclampt 18–26 (Review: kleiner)", () => {
    expect(partGroesse(72)).toBe(26);
    expect(partGroesse(50)).toBe(23);
    expect(partGroesse(30)).toBe(18);
  });
});

describe("maxMengeJe", () => {
  it("Maximum je art|einheit getrennt", () => {
    const p = [
      stromZuPunkt(basis)!,
      stromZuPunkt({ ...basis, id: "b2", mengeAtro: 500 })!,
      stromZuPunkt(outputStrom)!,
      stromZuPunkt({ ...outputStrom, id: "o2", mengeEinheit: "MWh/a", mengeWert: 9000 })!,
    ];
    const m = maxMengeJe(p);
    expect(m.get("biomasse|t atro/a")).toBe(500);
    expect(m.get("output|t/a")).toBe(50);
    expect(m.get("output|MWh/a")).toBe(9000);
  });
});

describe("aggregiere (Zusammenhangskomponenten — stabil beim Zoomen)", () => {
  it("transitiv: Randpunkte springen nie zwischen Gruppen", () => {
    // Greedy (Mockup) haette 70 je nach Seed mal zu 0, mal zu 140 gesteckt;
    // als Komponente sind alle drei EINE Gruppe.
    const g = aggregiere(
      [
        { x: 0, y: 0 },
        { x: 70, y: 0 },
        { x: 140, y: 0 },
        { x: 400, y: 0 },
      ],
      80,
    );
    expect(g).toHaveLength(2);
    expect(g[0]!.indizes).toEqual([0, 1, 2]);
    expect(g[1]!.indizes).toEqual([3]);
  });
  it("monoton: bei groesserem Radius verschmelzen nur GANZE Gruppen", () => {
    const punkte = Array.from({ length: 12 }, (_, i) => ({
      x: (i * 137) % 500,
      y: (i * 61) % 300,
    }));
    const fein = aggregiere(punkte, 60);
    const grob = aggregiere(punkte, 140);
    for (const f of fein) {
      const traeger = grob.filter((gr) =>
        f.indizes.some((i) => gr.indizes.includes(i)),
      );
      // Jede feine Gruppe liegt VOLLSTAENDIG in genau einer groben Gruppe.
      expect(traeger).toHaveLength(1);
      for (const i of f.indizes) expect(traeger[0]!.indizes).toContain(i);
    }
  });
  it("Gruppenzentrum = Mittelwert; Radius 0 = keine Aggregation (Zoom ≥ 16)", () => {
    const g = aggregiere([{ x: 0, y: 0 }, { x: 40, y: 20 }], 80);
    expect(g[0]!.x).toBe(20);
    expect(g[0]!.y).toBe(10);
    expect(aggregiere([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0)).toHaveLength(2);
  });
});

describe("fanStart (Mockup: freier 120°-Sektor)", () => {
  it("ohne Nachbarn Default −100°", () => {
    expect(fanStart({ x: 0, y: 0 }, [])).toBe(-100);
  });
  it("Nachbar rechts → Faecher oeffnet von ihm weg (Mitte zeigt nach links)", () => {
    const start = fanStart({ x: 0, y: 0 }, [{ x: 100, y: 0 }]);
    const mitte = start + 60;
    // Winkelabstand der Bogen-Mitte zu 180° (gegenueber dem Nachbarn) klein
    const abstand = Math.abs(((mitte - 180 + 540) % 360) - 180);
    expect(abstand).toBeLessThan(75);
  });
});

describe("farbGruppen (Mockup: Parts je Orb-Key, nach Flaeche sortiert)", () => {
  it("gruppiert nach orb und sortiert absteigend nach Flaeche", () => {
    const a = stromZuPunkt(basis)!;                       // guelle_mist
    const b = stromZuPunkt({ ...basis, id: "b2" })!;      // guelle_mist
    const o = stromZuPunkt(outputStrom)!;                 // wasserstoff
    const parts = farbGruppen([a, b, o], { b1: 30, b2: 30, o1: 62 });
    expect(parts[0]!.mitglieder.map((m) => m.id)).toEqual(["o1"]);
    expect(parts[1]!.mitglieder).toHaveLength(2);
    expect(parts[0]!.orb).toBe(o.orb);
  });
});

describe("bboxKm / punkteInBbox", () => {
  it("rechnet km aus Grad (Breite lat-korrigiert)", () => {
    const { breite, hoehe } = bboxKm([8, 49, 9, 50]);
    expect(hoehe).toBeCloseTo(111.2, 0);
    expect(breite).toBeGreaterThan(70);
    expect(breite).toBeLessThan(75);
  });
  it("zählt Punkte im Ausschnitt", () => {
    const p = [
      { lng: 8.5, lat: 49.5 },
      { lng: 10, lat: 49.5 },
    ] as KartePunkt[];
    expect(punkteInBbox(p, [8, 49, 9, 50])).toBe(1);
  });
});

describe("sucheKarte", () => {
  const punkte = [stromZuPunkt(basis)!, stromZuPunkt(outputStrom)!];
  const regionen = [{ id: "r1", name: "Südpfalz" }];
  it("findet Ströme über Titel/Untertitel/Ort", () => {
    const t = sucheKarte(punkte, regionen, "gülle");
    expect(t.some((x) => x.typ === "strom" && x.id === "b1")).toBe(true);
  });
  it("findet Regionen über den Namen", () => {
    const t = sucheKarte(punkte, regionen, "südpf");
    expect(t.some((x) => x.typ === "region" && x.id === "r1")).toBe(true);
  });
  it("findet Orte dedupliziert", () => {
    const t = sucheKarte(
      [...punkte, stromZuPunkt({ ...basis, id: "b3" })!],
      regionen,
      "rülz",
    );
    expect(t.filter((x) => x.typ === "ort")).toHaveLength(1);
  });
  it("leeres q → leer", () => {
    expect(sucheKarte(punkte, regionen, "  ")).toEqual([]);
  });
});

describe("geojsonOderNull", () => {
  it("String wird geparst, Objekt durchgereicht", () => {
    expect(geojsonOderNull('{"type":"Polygon"}', "r1")).toEqual({ type: "Polygon" });
    expect(geojsonOderNull({ type: "Polygon" }, "r1")).toEqual({ type: "Polygon" });
  });
  it("Murks wird protokolliert, nicht still geschluckt", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(geojsonOderNull("quatsch", "r1")).toBeNull();
    expect(geojsonOderNull(42, "r1")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("orb-Asset am Kartenpunkt", () => {
  it("Biomasse → Cluster-Orb, Output → Gruppen-Orb", () => {
    expect(stromZuPunkt(basis)!.orb).toBe("/orbs/cluster/guelle_mist.webp");
    expect(stromZuPunkt(outputStrom)!.orb).toBe("/orbs/output/wasserstoff.webp");
  });
  it("Add-Ons → Produkt-Orb (asche/co2/waerme)", () => {
    const p = stromZuPunkt({
      ...outputStrom,
      gruppe: "add_ons",
      produktCode: "asche",
    })!;
    expect(p.orb).toBe("/orbs/output/asche.webp");
  });
});

describe("faecherLayout (Bogen mit Luecke zu Nachbarn; max ~15; '…' bei mehr)", () => {
  it("wenige Parts: Basisradius, offener Bogen (Luecke bleibt)", () => {
    const l = faecherLayout(5, 26, 54);
    expect(l.radius).toBe(54);
    expect(l.voll).toBe(false);
    expect(l.sichtbar).toBe(5);
    expect(l.mehr).toBe(false);
    expect((l.sichtbar - 1) * l.schrittGrad).toBeLessThanOrEqual(300);
  });
  it("15 Belege passen maximal (Vollkreis am Deckel)", () => {
    const l = faecherLayout(15, 26, 54);
    expect(l.sichtbar).toBe(15);
    expect(l.mehr).toBe(false);
    expect(l.radius).toBeLessThanOrEqual(54 + 26);
  });
  it("mehr als 15 → 14 Beleg-Orbs + '…'", () => {
    const l = faecherLayout(22, 26, 54);
    expect(l.sichtbar).toBe(14);
    expect(l.mehr).toBe(true);
  });
});

// F2: Inhalt des Glas-Popovers (Marker-Hover).
describe("popoverZeilen", () => {
  it("Titel zuerst, darunter Materialart, Ort und Status", () => {
    expect(
      popoverZeilen({ titel: "Hof Müller", untertitel: "Rindergülle", ort: "Speyer", statusText: "verfügbar." }),
    ).toEqual({ titel: "Hof Müller", zeilen: ["Rindergülle", "Speyer", "verfügbar."] });
  });
  it("laesst leere Angaben weg, statt Trennzeichen zu haeufen", () => {
    expect(
      popoverZeilen({ titel: "Nur Titel", untertitel: "", ort: null, statusText: "" }),
    ).toEqual({ titel: "Nur Titel", zeilen: [] });
  });
});
