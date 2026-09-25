import { describe, expect, it } from "vitest";

import {
  facettenOptionen,
  filterAusSearchParams,
  filterStroeme,
  kreisAnzeige,
  landAnzeige,
  LEERER_FILTER,
  sortiereStroeme,
  verwaltungsZustand,
  type Strom,
} from "./stroeme-modell";

const strom = (patch: Partial<Strom>): Strom => ({
  id: "x",
  art: "biomasse",
  akteurName: "A",
  sektor: null,
  bezeichnung: null,
  kontaktperson: null,
  ort: null,
  verwaltung: null,
  regionIds: [],
  regionNamen: [],
  lng: null,
  lat: null,
  cluster: null,
  materialartCode: null,
  materialartLabel: null,
  mengeFm: null,
  tsAnteil: null,
  aschegehalt: null,
  mengeAtro: null,
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
  zeitraumVon: null,
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: null,
  status: "entwurf",
  reserviertBhyo: false,
  reserviertSeit: null,
  erstelltAm: "2026-09-01",
  beleg: null,
  vollstaendigkeit: 0,
  ...patch,
});

// E24: null-Stufe ist der benannte Zustand "unbelegt".
// F0b: Verwaltungszuordnung — "ausserhalb" und "ohne Koordinate" sind
// benannte, GETRENNTE Zustaende (nie aufs naechste Gebiet einrasten).
describe("verwaltung (F0b)", () => {
  const speyer = { kreisArs: "07318", kreisName: "Speyer", kreisBez: "Kreisfreie Stadt", landArs: "07", landName: "Rheinland-Pfalz" };
  // Die Landkreis-Facette gehoert (wie bisher) zur Output-Sicht.
  const zugeordnet = strom({ id: "v1", art: "output", verwaltung: speyer, lng: 8.43, lat: 49.32 });
  const ausserhalb = strom({ id: "v2", art: "output", verwaltung: null, lng: 2.35, lat: 48.85 });
  const ohneKoord = strom({ id: "v3", art: "output", verwaltung: null, lng: null, lat: null });

  it("verwaltungsZustand unterscheidet die drei Faelle", () => {
    expect(verwaltungsZustand(zugeordnet)).toBe("zugeordnet");
    expect(verwaltungsZustand(ausserhalb)).toBe("ausserhalb");
    expect(verwaltungsZustand(ohneKoord)).toBe("ohne_koordinate");
  });

  it("kreisAnzeige: amtliche Bezeichnung + Name; Sonderfaelle benannt", () => {
    expect(kreisAnzeige(zugeordnet)).toBe("Kreisfreie Stadt Speyer");
    // NBD-Heuristik: Name traegt die Bezeichnung schon in sich.
    expect(
      kreisAnzeige({
        verwaltung: { ...speyer, kreisName: "Rhein-Neckar-Kreis", kreisBez: "Landkreis" },
        lng: 8.7, lat: 49.4,
      }),
    ).toBe("Rhein-Neckar-Kreis");
    expect(
      kreisAnzeige({
        verwaltung: { ...speyer, kreisName: "Germersheim", kreisBez: "Landkreis" },
        lng: 8.36, lat: 49.22,
      }),
    ).toBe("Landkreis Germersheim");
    expect(kreisAnzeige(ausserhalb)).toBe("außerhalb");
    expect(kreisAnzeige(ohneKoord)).toBe("ohne Koordinate");
    expect(landAnzeige(zugeordnet)).toBe("Rheinland-Pfalz");
    expect(landAnzeige(ausserhalb)).toBe("außerhalb");
    expect(landAnzeige(ohneKoord)).toBe("ohne Koordinate");
  });

  it("Filter laeuft ueber den ARS; Sonderfaelle sind eigene Werte", () => {
    const pool = [zugeordnet, ausserhalb, ohneKoord];
    const f = (werte: string[]) =>
      filterStroeme(pool, { ...LEERER_FILTER, landkreis: werte }, "stroeme").map((s) => s.id);
    expect(f(["07318"])).toEqual(["v1"]);
    expect(f(["ausserhalb"])).toEqual(["v2"]);
    expect(f(["ohne_koordinate"])).toEqual(["v3"]);
  });

  it("sortiert Sonderfaelle hinter die Kreisnamen", () => {
    const auf = sortiereStroeme([ohneKoord, ausserhalb, zugeordnet], "landkreis", "auf");
    expect(auf[0]!.id).toBe("v1");
    expect(new Set(auf.slice(1).map((s) => s.id))).toEqual(new Set(["v2", "v3"]));
  });

  it("Facetten: ARS als Wert, Kreisname als Label, plus beide Sonderoptionen", () => {
    const opt = facettenOptionen("output", [zugeordnet], [], {});
    expect(opt.landkreis).toEqual([
      { wert: "07318", label: "Speyer" },
      { wert: "ausserhalb", label: "außerhalb" },
      { wert: "ohne_koordinate", label: "ohne Koordinate" },
    ]);
  });
});

describe("qualitaet unbelegt (E24)", () => {
  const mitBeleg = strom({ id: "q1", qualitaet: "D" });
  const ohneBeleg = strom({ id: "q2", qualitaet: null });

  it("Filterwert unbelegt matcht genau die Stroeme ohne Stufe", () => {
    const erg = filterStroeme(
      [mitBeleg, ohneBeleg],
      { ...LEERER_FILTER, qualitaet: ["unbelegt"] },
      "stroeme",
    );
    expect(erg.map((s) => s.id)).toEqual(["q2"]);
    const nurD = filterStroeme(
      [mitBeleg, ohneBeleg],
      { ...LEERER_FILTER, qualitaet: ["D"] },
      "stroeme",
    );
    expect(nurD.map((s) => s.id)).toEqual(["q1"]);
  });

  it("sortiert unbelegt hinter die niedrigste Stufe", () => {
    const auf = sortiereStroeme([ohneBeleg, mitBeleg], "qualitaet", "auf");
    expect(auf.map((s) => s.id)).toEqual(["q1", "q2"]);
  });

  it("Facetten-Optionen enthalten unbelegt als eigene Option", () => {
    const opt = facettenOptionen("biomasse", [], [], {});
    expect(opt.qualitaet!.map((o) => o.wert)).toEqual(["A", "B", "C", "D", "unbelegt"]);
  });
});

describe("filterAusSearchParams", () => {
  it("liest Einzelwerte und kommagetrennte Listen", () => {
    const f = filterAusSearchParams({
      q: "holz",
      cluster: "a,b",
      status: ["geprueft"],
      mengeMin: "10",
    });
    expect(f.q).toBe("holz");
    expect(f.cluster).toEqual(["a", "b"]);
    expect(f.status).toEqual(["geprueft"]);
    expect(f.mengeMin).toBe("10");
    expect(f.region).toEqual([]);
    expect(f.gruppe).toEqual([]);
  });
});

describe("gruppe-Facette", () => {
  const pool = [
    strom({ id: "o1", art: "output", gruppe: "wasserstoff" }),
    strom({ id: "o2", art: "output", gruppe: "derivate" }),
    strom({ id: "b1", art: "biomasse" }),
  ];
  it("filtert Output-Ströme über die Gruppe; Biomasse bleibt (wie cluster umgekehrt)", () => {
    const f = { ...LEERER_FILTER, gruppe: ["wasserstoff"] };
    expect(filterStroeme(pool, f, "stroeme").map((s) => s.id)).toEqual(["o1", "b1"]);
  });
  it("leere Facette lässt alles durch", () => {
    expect(filterStroeme(pool, LEERER_FILTER, "stroeme")).toHaveLength(3);
  });
});

describe("verfuegbarkeit-Facette (AP1j PR 3)", () => {
  it("filtert nach dem abgeleiteten Status; Stroeme ohne Ableitung fallen raus", () => {
    const frei = strom({
      id: "f",
      verfuegbarkeit: { status: "verfuegbar", reserviertZusatz: false },
    });
    const weg = strom({
      id: "w",
      verfuegbarkeit: { status: "vergeben_extern", reserviertZusatz: false },
    });
    const ohne = strom({ id: "o" });
    const erg = filterStroeme(
      [frei, weg, ohne],
      { ...LEERER_FILTER, verfuegbarkeit: ["verfuegbar"] },
      "stroeme",
    );
    expect(erg.map((s) => s.id)).toEqual(["f"]);
  });

  it("facettenOptionen liefert die feste 6er-Liste mit Art-Labels", () => {
    const opt = facettenOptionen("output", [], [], {});
    expect(opt.verfuegbarkeit!.map((o) => o.wert)).toEqual([
      "verfuegbar",
      "vergeben_extern",
      "vergeben_bhyo",
      "reserviert_bhyo",
      "noch_nicht_verfuegbar",
      "abgelaufen",
    ]);
    expect(opt.verfuegbarkeit![0]!.label).toBe("Offen");
    expect(facettenOptionen("biomasse", [], [], {}).verfuegbarkeit![0]!.label).toBe(
      "Verfügbar",
    );
  });
});

// E28: die Belegnummer ist Anzeige UND Suchbegriff.
describe("Belegnummer-Suche (E28)", () => {
  const mitNr = strom({
    id: "n1",
    beleg: {
      id: "eaea5128-c093-4dd2-9d1e-167354f96cec",
      nr: "B-000123",
      typ: "vertrag",
      quellenangabe: null,
      href: null,
      externNachvollziehbar: false,
      gueltigBis: null,
      erhebungsdatum: null,
      amtlich: null,
      gespraechsdatum: null,
      gespraechspartner: null,
      kernnotiz: null,
    },
  });
  const treffer = (q: string) =>
    filterStroeme([mitNr], { ...LEERER_FILTER, q }, "stroeme").map((s) => s.id);

  it("findet mit Praefix, ohne Praefix und ohne fuehrende Nullen", () => {
    expect(treffer("B-000123")).toEqual(["n1"]);
    expect(treffer("000123")).toEqual(["n1"]);
    expect(treffer("123")).toEqual(["n1"]);
  });

  it("ignoriert Gross- und Kleinschreibung", () => {
    expect(treffer("b-000123")).toEqual(["n1"]);
    expect(treffer("B-000123".toUpperCase())).toEqual(["n1"]);
  });

  it("findet weiterhin ueber die UUID (Altprotokolle)", () => {
    expect(treffer("eaea5128")).toEqual(["n1"]);
  });

  it("findet nicht bei fremder Nummer", () => {
    expect(treffer("B-000999")).toEqual([]);
  });
});

describe("Beleg-ID-Suche", () => {
  it("die Freitextsuche findet einen Strom ueber die Beleg-ID (Praefix reicht)", () => {
    const mit = strom({
      id: "m",
      beleg: {
        id: "3f2a91c4-0000-4000-8000-000000000001",
        nr: null,
      typ: "vertrag",
        quellenangabe: null,
        href: null,
        externNachvollziehbar: false,
        gueltigBis: null,
        erhebungsdatum: null,
        amtlich: null,
        gespraechsdatum: null,
        gespraechspartner: null,
        kernnotiz: null,
      },
    });
    const ohne = strom({ id: "o" });
    const erg = filterStroeme([mit, ohne], { ...LEERER_FILTER, q: "3f2a91c4" }, "stroeme");
    expect(erg.map((s) => s.id)).toEqual(["m"]);
  });
});


// --- F5 PR B: stofflich/energetisch, Vollstaendigkeit, Ansichts-Scope -------

import { filterStroemeMitBericht } from "./stroeme-modell";

/** Energetischer Output (Methanol, 100 t/a, 200 €/t): hat beide Ableitungen. */
const methanol = (patch: Partial<Strom> = {}): Strom =>
  strom({
    id: "meth",
    art: "output",
    produktCode: "methanol",
    mengeWert: 100,
    mengeEinheit: "t/a",
    preis: 200,
    preisEinheit: "€/t",
    status: "geprueft",
    ...patch,
  });

/** Stofflicher Output (CO2, 500 t/a, 80 €/t): kein Energieaequivalent. */
const co2 = (patch: Partial<Strom> = {}): Strom =>
  strom({
    id: "co2",
    art: "output",
    produktCode: "co2",
    mengeWert: 500,
    mengeEinheit: "t/a",
    preis: 80,
    preisEinheit: "€/t",
    status: "geprueft",
    ...patch,
  });

describe("Ansichts-Scope: nicht geltende Filter wirken nicht (E32)", () => {
  // Der Befund dahinter: filterStroeme prueft bislang nur die Stromart.
  // Ein gesetzter vonAb wirkte damit auch in auswertung. — waehrend die
  // Leiste ihn als "gilt hier nicht" auswies. Die Beschriftung muss die
  // echte Wirkung beschreiben, also wirkt er dort jetzt wirklich nicht.
  const spaet = strom({ id: "spaet", zeitraumVon: "2027-01-01" });
  const frueh = strom({ id: "frueh", zeitraumVon: "2020-01-01" });
  const f = { ...LEERER_FILTER, vonAb: "2026-01" };

  it("vonAb wirkt in stroeme.", () => {
    expect(filterStroeme([spaet, frueh], f, "stroeme").map((s) => s.id)).toEqual(["spaet"]);
  });

  it("vonAb gilt in auswertung. nicht und laesst dort beide durch", () => {
    expect(filterStroeme([spaet, frueh], f, "auswertung").map((s) => s.id)).toEqual([
      "spaet",
      "frueh",
    ]);
  });
});

describe("Menge stofflich: Masse zaehlt, andere Einheiten benannt heraus", () => {
  it("Feedstock filtert wie bisher ueber mengeFm", () => {
    const gross = strom({ id: "g", mengeFm: 5000 });
    const klein = strom({ id: "k", mengeFm: 100 });
    const erg = filterStroeme([gross, klein], { ...LEERER_FILTER, mengeMin: "1000" }, "stroeme");
    expect(erg.map((s) => s.id)).toEqual(["g"]);
  });

  it("Output in t/a wird verglichen, MWh/a ist keine stoffliche Menge", () => {
    const tonnen = co2({ id: "t" });
    const mwh = methanol({ id: "mwh", mengeWert: 9999, mengeEinheit: "MWh/a" });
    const { stroeme, nichtBeruecksichtigt } = filterStroemeMitBericht(
      [tonnen, mwh],
      { ...LEERER_FILTER, mengeMin: "100" },
      "stroeme",
    );
    // 9999 MWh/a liegt NICHT ueber der Grenze von 100 t — die Zahl gehoert
    // auf eine andere Skala und wird nicht mitverglichen.
    expect(stroeme.map((s) => s.id)).toEqual(["t"]);
    expect(nichtBeruecksichtigt).toEqual([{ grund: "ohne stoffliche Menge", anzahl: 1 }]);
  });

  it("fehlende Menge faellt still heraus (fehlende Angabe, kein benannter Zustand)", () => {
    const ohne = co2({ id: "o", mengeWert: null, mengeEinheit: null });
    const { stroeme, nichtBeruecksichtigt } = filterStroemeMitBericht(
      [ohne],
      { ...LEERER_FILTER, mengeMin: "1" },
      "stroeme",
    );
    expect(stroeme).toEqual([]);
    expect(nichtBeruecksichtigt).toEqual([]);
  });
});

describe("Menge energetisch: ueber Hu abgeleitet, co2/asche benannt heraus", () => {
  it("MWh/a direkt, t/a ueber den Heizwert (Methanol 100 t/a ≈ 553 MWh/a)", () => {
    const direkt = methanol({ id: "d", mengeWert: 700, mengeEinheit: "MWh/a" });
    const ueberHu = methanol({ id: "hu" }); // 100 t/a * 19,9 MJ/kg / 3,6 = 552,8 MWh
    const klein = methanol({ id: "k", mengeWert: 10, mengeEinheit: "MWh/a" });
    const erg = filterStroeme(
      [direkt, ueberHu, klein],
      { ...LEERER_FILTER, energieMengeMin: "500", energieMengeMax: "800" },
      "stroeme",
    );
    expect(erg.map((s) => s.id)).toEqual(["d", "hu"]);
  });

  it("co2 wird nicht beruecksichtigt und sichtbar gezaehlt", () => {
    const { stroeme, nichtBeruecksichtigt } = filterStroemeMitBericht(
      [methanol({ id: "m", mengeWert: 600, mengeEinheit: "MWh/a" }), co2()],
      { ...LEERER_FILTER, energieMengeMin: "1" },
      "stroeme",
    );
    expect(stroeme.map((s) => s.id)).toEqual(["m"]);
    expect(nichtBeruecksichtigt).toEqual([{ grund: "ohne Energieäquivalent", anzahl: 1 }]);
  });

  it("zaehlt nur Stroeme, die alle anderen Filter bestehen", () => {
    const passt = co2({ id: "a" });
    const scheitertWoanders = co2({ id: "b", status: "entwurf" });
    const { nichtBeruecksichtigt } = filterStroemeMitBericht(
      [passt, scheitertWoanders],
      { ...LEERER_FILTER, energieMengeMin: "1", status: ["geprueft"] },
      "stroeme",
    );
    expect(nichtBeruecksichtigt).toEqual([{ grund: "ohne Energieäquivalent", anzahl: 1 }]);
  });

  it("ein Strom zaehlt einmal, auch wenn Mengen- UND Preisgrenze gesetzt sind", () => {
    const { nichtBeruecksichtigt } = filterStroemeMitBericht(
      [co2()],
      { ...LEERER_FILTER, energieMengeMin: "1", energiePreisMin: "1" },
      "stroeme",
    );
    expect(nichtBeruecksichtigt).toEqual([{ grund: "ohne Energieäquivalent", anzahl: 1 }]);
  });
});

describe("Preis stofflich und energetisch: E20-Einheiten, nicht Rohwerte", () => {
  it("Output in €/kg wird als €/t verglichen (0,25 €/kg = 250 €/t)", () => {
    const kg = co2({ id: "kg", preis: 0.25, preisEinheit: "€/kg" });
    const erg = filterStroeme(
      [kg],
      { ...LEERER_FILTER, preisMin: "200", preisMax: "300" },
      "stroeme",
    );
    expect(erg.map((s) => s.id)).toEqual(["kg"]);
  });

  it("€/MWh ist kein stofflicher Preis und wird benannt gezaehlt", () => {
    const mwh = methanol({ id: "mwh", preis: 90, preisEinheit: "€/MWh" });
    const { stroeme, nichtBeruecksichtigt } = filterStroemeMitBericht(
      [mwh],
      { ...LEERER_FILTER, preisMin: "1" },
      "stroeme",
    );
    expect(stroeme).toEqual([]);
    expect(nichtBeruecksichtigt).toEqual([{ grund: "ohne stofflichen Preis", anzahl: 1 }]);
  });

  it("energetischer Preis: €/t ueber Hu (Methanol 200 €/t ≈ 36 €/MWh)", () => {
    const erg = filterStroeme(
      [methanol()],
      { ...LEERER_FILTER, energiePreisMin: "30", energiePreisMax: "40" },
      "stroeme",
    );
    expect(erg.map((s) => s.id)).toEqual(["meth"]);
  });

  it("Feedstock-Preis bleibt der Korridor-Mittelwert", () => {
    const teuer = strom({ id: "t", preisMittel: 120 });
    const billig = strom({ id: "b", preisMittel: 20 });
    const erg = filterStroeme([teuer, billig], { ...LEERER_FILTER, preisMin: "50" }, "stroeme");
    expect(erg.map((s) => s.id)).toEqual(["t"]);
  });
});

describe("Vollständigkeit als Min/Max in Prozent", () => {
  const voll = strom({ id: "v", vollstaendigkeit: 88 });
  const halb = strom({ id: "h", vollstaendigkeit: 50 });

  it("Untergrenze allein deckt 'mindestens 80 %' ab", () => {
    expect(
      filterStroeme([voll, halb], { ...LEERER_FILTER, vollMin: "80" }, "stroeme").map((s) => s.id),
    ).toEqual(["v"]);
  });

  it("Ober- und Untergrenze zusammen", () => {
    expect(
      filterStroeme(
        [voll, halb],
        { ...LEERER_FILTER, vollMin: "40", vollMax: "60" },
        "stroeme",
      ).map((s) => s.id),
    ).toEqual(["h"]);
  });
});
