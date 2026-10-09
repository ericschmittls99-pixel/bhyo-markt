import { describe, expect, it } from "vitest";

import {
  reservierungVeraltet,
  istLeereVergabe,
  leiteVerfuegbarkeitAb,
  naechsteReserviertSeit,
  reichereVerfuegbarkeitAn,
  verfuegbarkeitLabel,
  verfuegbarkeitPill,
  validiereVergaben,
  vergabeLabel,
  vergabenZuFormZeilen,
  vergabenZuWerten,
  type VerfuegbarkeitsErgebnis,
  type VergabeDaten,
  type VergabeFormZeile,
} from "./verfuegbarkeit";

const strom = {
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2030-12-31",
  reserviertBhyo: false,
};
const v = (o: Partial<VergabeDaten>): VergabeDaten => ({
  vergebenVon: null,
  vergebenBis: null,
  vergebenAn: null,
  anBhyo: false,
  ...o,
});

describe("leiteVerfuegbarkeitAb", () => {
  it("abgelaufen schlaegt alles (Regel 1)", () => {
    expect(
      leiteVerfuegbarkeitAb("2031-01-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2026-01-01" }),
      ]),
    ).toEqual({ status: "abgelaufen", reserviertZusatz: true, reservierungVeraltet: false });
  });

  it("noch nicht verfuegbar vor Verfuegbarkeitsbeginn (Regel 2)", () => {
    expect(leiteVerfuegbarkeitAb("2025-12-31", strom, []).status).toBe(
      "noch_nicht_verfuegbar",
    );
  });

  it("verfuegbar ohne Vergaben und ohne Reservierung (Regel 5)", () => {
    expect(leiteVerfuegbarkeitAb("2027-06-15", strom, [])).toEqual({
      status: "verfuegbar",
      reserviertZusatz: false,
    reservierungVeraltet: false,
    });
  });

  it("vergeben (extern) wenn heute im Vergabezeitraum liegt (Regel 3)", () => {
    const erg = leiteVerfuegbarkeitAb("2027-06-15", strom, [
      v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
    ]);
    expect(erg.status).toBe("vergeben_extern");
    // Gegenprobe: ohne bhyo-Bezug kein Stempel — der Stempel bleibt eine
    // Aussage ueber bhyo, kein allgemeines Vergabe-Zeichen.
    expect(erg.reserviertZusatz).toBe(false);
  });

  it("vergeben (bhyo) wenn an_bhyo gesetzt ist — MIT Stempel, auch ohne Reservierung", () => {
    // Review Eric 24.09.2026: Der Stempel markiert, dass bhyo an diesem Strom
    // haengt. Eine Vergabe "an bhyo" ist genau das — vorher blieb sie
    // ungestempelt, weil nur reserviert_bhyo zaehlte.
    const erg = leiteVerfuegbarkeitAb("2027-06-15", strom, [
      v({ vergebenVon: "2027-01-01", anBhyo: true }),
    ]);
    expect(erg).toEqual({ status: "vergeben_bhyo", reserviertZusatz: true, reservierungVeraltet: false });
    expect(erg.status).toBe("vergeben_bhyo");
  });

  it("offenes von zaehlt ab Verfuegbarkeitsbeginn", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    expect(leiteVerfuegbarkeitAb("2026-01-01", strom, vergaben).status).toBe(
      "vergeben_extern",
    );
    expect(leiteVerfuegbarkeitAb("2028-07-01", strom, vergaben).status).toBe(
      "verfuegbar",
    );
  });

  it("offenes bis heisst unbefristet (bis Verfuegbarkeitsende)", () => {
    const vergaben = [v({ vergebenVon: "2027-01-01" })];
    expect(leiteVerfuegbarkeitAb("2030-12-31", strom, vergaben).status).toBe(
      "vergeben_extern",
    );
  });

  it("reserviert (bhyo) ohne aktive Vergabe (Regel 4)", () => {
    expect(
      leiteVerfuegbarkeitAb(
        "2027-06-15",
        { ...strom, reserviertBhyo: true },
        [],
      ).status,
    ).toBe("reserviert_bhyo");
  });

  it("Randfall: Reservierung + aktive externe Vergabe -> Zusatz-Pille", () => {
    expect(
      leiteVerfuegbarkeitAb("2027-06-15", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]),
    ).toEqual({ status: "vergeben_extern", reserviertZusatz: true, reservierungVeraltet: false });
  });

  it("Reservierung erzeugt den Nebentag IMMER, wenn sie nicht selbst Haupttag ist", () => {
    // Beschluss 22.09.2026: Regeln 1-3 bestimmen den Haupttag, die
    // Reservierung erscheint dann zusaetzlich — nicht nur bei externer Vergabe.
    const reserviert = {
      zeitraumVon: "2028-01-01",
      zeitraumBis: "2030-12-31",
      reserviertBhyo: true,
    };
    expect(leiteVerfuegbarkeitAb("2026-09-22", reserviert, [])).toEqual({
      status: "noch_nicht_verfuegbar",
      reserviertZusatz: true,
    reservierungVeraltet: false,
    });
    expect(leiteVerfuegbarkeitAb("2031-01-01", reserviert, [])).toEqual({
      status: "abgelaufen",
      reserviertZusatz: true,
    reservierungVeraltet: false,
    });
    expect(
      leiteVerfuegbarkeitAb("2028-06-15", reserviert, [
        v({ vergebenVon: "2028-01-01", anBhyo: true }),
      ]),
    ).toEqual({ status: "vergeben_bhyo", reserviertZusatz: true, reservierungVeraltet: false });
    // Selbst Haupttag -> kein Nebentag.
    expect(leiteVerfuegbarkeitAb("2028-06-15", reserviert, [])).toEqual({
      status: "reserviert_bhyo",
      reserviertZusatz: false,
    reservierungVeraltet: false,
    });
  });

  it("nach Vergabe-Ende faellt der Strom auf die Reservierung zurueck", () => {
    expect(
      leiteVerfuegbarkeitAb("2028-07-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]).status,
    ).toBe("reserviert_bhyo");
  });
});

describe("E75: zeitraumBis = null heisst unbefristet", () => {
  const offen = { zeitraumVon: "2026-01-01", zeitraumBis: null, reserviertBhyo: false };
  it("Rot-Nachweis: laufende Vergabe ohne Ende auf unbefristetem Strom -> vergeben, nicht verfuegbar", () => {
    // Vor E75 wurde der Fallback `vergebenBis ?? zeitraumBis` null und die
    // Ueberlappungspruefung (`null >= fenster.von` -> false) blendete die
    // Vergabe aus: Status „verfuegbar" trotz Vergabe.
    expect(leiteVerfuegbarkeitAb("2027-06-15", offen, [v({ vergebenVon: "2026-03-01" })]).status).toBe("vergeben_extern");
  });
  it("unbefristet ist nie abgelaufen, auch weit in der Zukunft", () => {
    expect(leiteVerfuegbarkeitAb("2099-12-31", offen, []).status).toBe("verfuegbar");
  });
  it("vor dem Beginn bleibt noch_nicht_verfuegbar", () => {
    expect(leiteVerfuegbarkeitAb("2025-12-31", offen, []).status).toBe("noch_nicht_verfuegbar");
  });
  it("befristete Vergabe auf unbefristetem Strom endet -> danach verfuegbar", () => {
    const vg = [v({ vergebenVon: "2026-03-01", vergebenBis: "2027-02-28" })];
    expect(leiteVerfuegbarkeitAb("2027-02-28", offen, vg).status).toBe("vergeben_extern");
    expect(leiteVerfuegbarkeitAb("2027-03-01", offen, vg).status).toBe("verfuegbar");
  });
});

describe("reichereVerfuegbarkeitAn", () => {
  type S = {
    id: string;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    reserviertBhyo: boolean;
    verfuegbarkeit?: VerfuegbarkeitsErgebnis;
  };
  const b: Omit<S, "id"> = {
    zeitraumVon: "2026-01-01",
    zeitraumBis: "2030-12-31",
    reserviertBhyo: false,
  };
  it("setzt das Feld je Strom aus der Vergaben-Map", () => {
    const map = new Map([
      ["a", [v({ vergebenVon: "2026-01-01", vergebenBis: "2027-12-31" })]],
    ]);
    const [a, c] = reichereVerfuegbarkeitAn<S>(
      [
        { ...b, id: "a" },
        { ...b, id: "c", reserviertBhyo: true },
      ],
      map,
      "2026-09-22",
    );
    expect(a!.verfuegbarkeit?.status).toBe("vergeben_extern");
    expect(c!.verfuegbarkeit?.status).toBe("reserviert_bhyo");
  });
  it("E75: Strom mit Beginn und offenem Ende wird angereichert (unbefristet)", () => {
    const r = reichereVerfuegbarkeitAn(
      [{ id: "u", zeitraumVon: "2026-01-01", zeitraumBis: null, reserviertBhyo: false } as { id: string; zeitraumVon: string | null; zeitraumBis: string | null; reserviertBhyo: boolean; verfuegbarkeit?: VerfuegbarkeitsErgebnis }],
      new Map([["u", [v({ vergebenVon: "2026-02-01" })]]]),
      "2030-01-01",
    );
    expect(r[0]!.verfuegbarkeit?.status).toBe("vergeben_extern");
  });
  it("laesst Stroeme ohne Zeitraum unangereichert (kein Raten)", () => {
    const s: S = { ...b, id: "o", zeitraumVon: null };
    expect(
      reichereVerfuegbarkeitAn([s], new Map(), "2026-09-22")[0]!.verfuegbarkeit,
    ).toBeUndefined();
  });
});

describe("verfuegbarkeitPill — Label-Saetze je Stromart (Beschluss 22.09.2026)", () => {
  it("Feedstock-Labels", () => {
    expect(verfuegbarkeitPill("biomasse", "vergeben_extern").text).toBe(
      "vergeben (extern).",
    );
    expect(verfuegbarkeitPill("biomasse", "verfuegbar").text).toBe("verfügbar.");
  });
  it("Output-Labels: gedeckt/offen", () => {
    expect(verfuegbarkeitPill("output", "vergeben_extern").text).toBe(
      "gedeckt (extern).",
    );
    expect(verfuegbarkeitPill("output", "vergeben_bhyo").text).toBe(
      "gedeckt (bhyo).",
    );
    expect(verfuegbarkeitPill("output", "verfuegbar").text).toBe("offen.");
    expect(verfuegbarkeitPill("output", "reserviert_bhyo").text).toBe(
      "reserviert (bhyo).",
    );
  });
  it("Toene sind je Status identisch, unabhaengig von der Art", () => {
    expect(verfuegbarkeitPill("output", "verfuegbar").tone).toBe(
      verfuegbarkeitPill("biomasse", "verfuegbar").tone,
    );
  });
  it("Filter-Labels in normaler Orthographie", () => {
    expect(verfuegbarkeitLabel("biomasse", "vergeben_extern")).toBe(
      "Vergeben (extern)",
    );
    expect(verfuegbarkeitLabel("output", "verfuegbar")).toBe("Offen");
    expect(verfuegbarkeitLabel("biomasse", "noch_nicht_verfuegbar")).toBe(
      "Noch nicht verfügbar",
    );
  });
});

describe("vergabeLabel", () => {
  it("beide Enden gesetzt", () => {
    expect(vergabeLabel("2027-01-01", "2028-06-30")).toBe("01/2027 bis 06/2028");
  });
  it("offenes von", () => {
    expect(vergabeLabel(null, "2028-06-30")).toBe("bis 06/2028");
  });
  it("offenes bis", () => {
    expect(vergabeLabel("2027-01-01", null)).toBe("ab 01/2027 (unbefristet)");
  });
});

const z = (o: Partial<VergabeFormZeile>): VergabeFormZeile => ({
  vonMonat: "",
  bisMonat: "",
  an: "",
  anBhyo: false,
  ...o,
});

describe("validiereVergaben", () => {
  it("leer und Leerzeilen sind gueltig", () => {
    expect(validiereVergaben("2026-01", "2030-12", [])).toEqual({});
    expect(validiereVergaben("2026-01", "2030-12", [z({})])).toEqual({});
  });

  it("bis vor von", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2028-01", bisMonat: "2027-01" }),
    ]);
    expect(f.vergabe_0_bis).toBe("Bis liegt vor Ab");
  });

  it("ausserhalb des Verfuegbarkeitszeitraums", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2025-06" }),
      z({ vonMonat: "2031-01", bisMonat: "2031-06" }),
    ]);
    expect(f.vergabe_0_von).toBe("Liegt vor dem Verfügbarkeitsbeginn");
    expect(f.vergabe_1_von).toBe("Liegt nach dem Verfügbarkeitsende");
    expect(f.vergabe_1_bis).toBe("Liegt nach dem Verfügbarkeitsende");
  });

  it("Ueberlappung zweier Zeitraeume", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2026-01", bisMonat: "2027-06" }),
      z({ vonMonat: "2027-06", bisMonat: "2028-01" }),
    ]);
    expect(f.vergabe_1_von).toBe(
      "Überschneidet sich mit einem anderen Vergabezeitraum",
    );
  });

  it("zwei offene Enden in dieselbe Richtung ueberlappen nach Normalisierung", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ bisMonat: "2027-06" }),
      z({ bisMonat: "2028-06" }),
    ]);
    expect(f.vergabe_1_von).toBe(
      "Überschneidet sich mit einem anderen Vergabezeitraum",
    );
  });

  it("ueberlappungsfreie Zeitraeume inkl. offener Enden sind gueltig", () => {
    expect(
      validiereVergaben("2026-01", "2030-12", [
        z({ bisMonat: "2027-06" }),
        z({ vonMonat: "2027-07" }),
      ]),
    ).toEqual({});
  });
});

describe("vergabenZuWerten", () => {
  it("laesst Leerzeilen weg und normalisiert Monat -> Datum", () => {
    expect(
      vergabenZuWerten([
        z({}),
        z({ vonMonat: "2027-01", bisMonat: "2028-06", an: "  Stadtwerke  " }),
        z({ bisMonat: "2028-06", anBhyo: true }),
      ]),
    ).toEqual([
      {
        vergebenVon: "2027-01-01",
        vergebenBis: "2028-06-30",
        vergebenAn: "Stadtwerke",
        anBhyo: false,
      },
      {
        vergebenVon: null,
        vergebenBis: "2028-06-30",
        vergebenAn: null,
        anBhyo: true,
      },
    ]);
  });
});

describe("vergabenZuFormZeilen", () => {
  it("Datum -> Monat, null -> leer", () => {
    expect(
      vergabenZuFormZeilen([
        {
          vergebenVon: "2027-01-01",
          vergebenBis: null,
          vergebenAn: "X",
          anBhyo: true,
        },
      ]),
    ).toEqual([{ vonMonat: "2027-01", bisMonat: "", an: "X", anBhyo: true }]);
  });
});

describe("naechsteReserviertSeit", () => {
  it("Setzen stempelt heute", () => {
    expect(naechsteReserviertSeit(true, null, "2026-09-22")).toBe("2026-09-22");
  });
  it("Editieren stempelt nicht neu — die Zusage wird nicht verjuengt", () => {
    expect(naechsteReserviertSeit(true, "2026-03-01", "2026-09-22")).toBe(
      "2026-03-01",
    );
  });
  it("Abwaehlen nullt", () => {
    expect(naechsteReserviertSeit(false, "2026-03-01", "2026-09-22")).toBeNull();
  });
});

describe("istLeereVergabe", () => {
  it("beide Monate leer = Leerzeile, auch mit Text", () => {
    expect(istLeereVergabe(z({ an: "jemand" }))).toBe(true);
    expect(istLeereVergabe(z({ vonMonat: "2027-01" }))).toBe(false);
  });
});

// E41 (28.09.2026): Status gegen ein FENSTER (gewaehltes Jahr / Zeitraum aus
// E39) statt gegen heute — dieselbe Hierarchie, dieselbe Ueberschneidungs-
// regel wie in stroeme./karte. (E32): „vergeben" heisst, ein Vergabezeitraum
// ueberschneidet das Fenster. Ein Stichtag ist das Fenster [Tag, Tag].
describe("E41: Verfuegbarkeitsstatus im Fenster", () => {
  const jahr2027 = { von: "2027-01-01", bis: "2027-12-31" };
  const zeitraum = { von: "2026-01-01", bis: "2028-12-31" };

  it("Vergabe vollstaendig im Fenster: vergeben", () => {
    expect(
      leiteVerfuegbarkeitAb(jahr2027, strom, [v({ vergebenVon: "2027-03-01", vergebenBis: "2027-06-30" })]).status,
    ).toBe("vergeben_extern");
  });
  it("Vergabe schneidet das Fenster nur an: trotzdem vergeben (Ueberschneidung)", () => {
    expect(
      leiteVerfuegbarkeitAb(jahr2027, strom, [v({ vergebenVon: "2026-06-01", vergebenBis: "2027-02-28" })]).status,
    ).toBe("vergeben_extern");
  });
  it("Vergabe ausserhalb des Fensters: verfuegbar", () => {
    expect(
      leiteVerfuegbarkeitAb(jahr2027, strom, [v({ vergebenVon: "2028-01-01", vergebenBis: "2028-06-30" })]).status,
    ).toBe("verfuegbar");
  });
  it("Einzeljahr gegen Zeitraum: dieselbe Vergabe (2028) zaehlt nur im Zeitraum", () => {
    const vg = [v({ vergebenVon: "2028-01-01", vergebenBis: "2028-06-30", anBhyo: true })];
    expect(leiteVerfuegbarkeitAb(jahr2027, strom, vg).status).toBe("verfuegbar");
    expect(leiteVerfuegbarkeitAb(zeitraum, strom, vg).status).toBe("vergeben_bhyo");
  });
  it("Fenster nach dem Ende: abgelaufen; Fenster vor dem Beginn: noch nicht verfuegbar", () => {
    expect(leiteVerfuegbarkeitAb({ von: "2031-01-01", bis: "2031-12-31" }, strom, []).status).toBe("abgelaufen");
    expect(leiteVerfuegbarkeitAb({ von: "2024-01-01", bis: "2025-12-31" }, strom, []).status).toBe("noch_nicht_verfuegbar");
  });
  it("Stichtag = Fenster [Tag, Tag]: Heute-Semantik unveraendert", () => {
    const vg = [v({ vergebenVon: "2027-03-01", vergebenBis: "2027-06-30" })];
    expect(leiteVerfuegbarkeitAb("2027-04-15", strom, vg)).toEqual(
      leiteVerfuegbarkeitAb({ von: "2027-04-15", bis: "2027-04-15" }, strom, vg),
    );
    expect(leiteVerfuegbarkeitAb("2027-08-01", strom, vg).status).toBe("verfuegbar");
  });
  it("reichereVerfuegbarkeitAn nimmt das Fenster entgegen", () => {
    const [s] = reichereVerfuegbarkeitAn(
      [
        {
          id: "a",
          zeitraumVon: strom.zeitraumVon,
          zeitraumBis: strom.zeitraumBis,
          reserviertBhyo: false,
          verfuegbarkeit: undefined as VerfuegbarkeitsErgebnis | undefined,
        },
      ],
      new Map([["a", [v({ vergebenVon: "2027-03-01", vergebenBis: "2027-06-30" })]]]),
      jahr2027,
    );
    expect(s!.verfuegbarkeit?.status).toBe("vergeben_extern");
  });
});

// E40: Zeitraeume mit „bis" statt Strich.
describe("E40: vergabeLabel mit „bis\"", () => {
  it("beide Grenzen, offenes Ende, Beginn = Ende", () => {
    expect(vergabeLabel("2026-01-01", "2027-06-30")).toBe("01/2026 bis 06/2027");
    expect(vergabeLabel("2027-07-01", null)).toBe("ab 07/2027 (unbefristet)");
    expect(vergabeLabel(null, "2027-06-30")).toBe("bis 06/2027");
    expect(vergabeLabel("2026-03-01", "2026-03-31")).toBe("03/2026");
  });
});

// E64 (AP2.4): Nebentag „Reservierung veraltet" — reserviert_seit + Gueltigkeit vor dem Bezug.
describe("reservierungVeraltet (E64)", () => {
  const res = { reserviertBhyo: true, reserviertSeit: "2025-09-15", reservierungMonate: 12 };
  it("veraltet, sobald der Bezug nach reserviert_seit + Monate liegt; davor nicht", () => {
    expect(reservierungVeraltet("2026-09-15", res)).toBe(false);
    expect(reservierungVeraltet("2026-09-16", res)).toBe(true);
    // Fenster (auswertung.): gegen den Beginn des Bezugs.
    expect(reservierungVeraltet({ von: "2026-01-01", bis: "2026-12-31" }, res)).toBe(false);
    expect(reservierungVeraltet({ von: "2027-01-01", bis: "2027-12-31" }, res)).toBe(true);
  });
  it("ohne Reservierung nie; ohne Parameterwert an einer Reservierung ein Fehler, kein Standard", () => {
    expect(reservierungVeraltet("2030-01-01", { ...res, reserviertBhyo: false })).toBe(false);
    expect(reservierungVeraltet("2030-01-01", { ...res, reserviertSeit: null })).toBe(false);
    expect(() => reservierungVeraltet("2030-01-01", { ...res, reservierungMonate: null })).toThrow(/parameter_wert/);
  });
  it("leiteVerfuegbarkeitAb traegt den Nebentag unabhaengig vom Haupttag — die Reservierung zaehlt weiter", () => {
    const erg = leiteVerfuegbarkeitAb("2027-06-15", { ...strom, ...res }, []);
    expect(erg).toEqual({ status: "reserviert_bhyo", reserviertZusatz: false, reservierungVeraltet: true });
    const vergeben = leiteVerfuegbarkeitAb("2027-06-15", { ...strom, ...res }, [v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" })]);
    expect(vergeben).toMatchObject({ status: "vergeben_extern", reserviertZusatz: true, reservierungVeraltet: true });
  });
});
