/**
 * AP2.8 (E70): „Biomasse wird frei“ — Kettenende, Stufen, Pille, Tagesgrenze.
 * Die SQL-Spiegelung des Jobs prueft scripts/wird-frei-probe.ts gegen die
 * Wegwerf-Datenbank mit denselben Faellen.
 */
import { describe, expect, it } from "vitest";

import { kalendertag } from "./datum";
import type { VergabeDaten } from "./verfuegbarkeit";
import { freiAbAus, kettenEnden, stufeFuer, tageZwischen, wirdFreiPill, wirdFreiStand, wirdFreiText } from "./wird-frei";

const v = (von: string | null, bis: string | null, anBhyo = false): VergabeDaten => ({ vergebenVon: von, vergebenBis: bis, vergebenAn: anBhyo ? "bhyo" : "Extern", anBhyo });

describe("frei_ab = Ende der Vergabekette (Regel 1–3)", () => {
  it("eine Vergabe mit Ende: frei_ab ist ihr Ende; ohne Ende (NULL) kein Hinweis", () => {
    expect(freiAbAus([v("2026-01-01", "2026-06-30")], "2026-03-01")).toEqual({ freiAb: "2026-06-30", anBhyo: false });
    expect(freiAbAus([v("2026-01-01", null)], "2026-03-01")).toBeNull();
    expect(freiAbAus([], "2026-03-01")).toBeNull();
  });
  it("Anschlussvergabe: Beginn spaetestens am Folgetag (Luecke 0) schliesst an; ein freier Tag dazwischen (Luecke 1) oder zwei nicht", () => {
    const erste = v("2026-01-01", "2026-06-30");
    // Luecke 0: beginnt am Folgetag 01.07. → eine Kette bis 31.12.
    expect(freiAbAus([erste, v("2026-07-01", "2026-12-31")], "2026-03-01")!.freiAb).toBe("2026-12-31");
    // Ueberlappend (beginnt vor dem Ende) ist erst recht Anschluss.
    expect(freiAbAus([erste, v("2026-06-15", "2026-12-31")], "2026-03-01")!.freiAb).toBe("2026-12-31");
    // Luecke 1 (02.07.) und Luecke 2 (03.07.): der Strom wird am 01.07. frei — E70 Regel 1 woertlich („spaetestens am Folgetag").
    expect(freiAbAus([erste, v("2026-07-02", "2026-12-31")], "2026-03-01")!.freiAb).toBe("2026-06-30");
    expect(freiAbAus([erste, v("2026-07-03", "2026-12-31")], "2026-03-01")!.freiAb).toBe("2026-06-30");
    // Anschluss ohne Ende: die Kette endet nie.
    expect(freiAbAus([erste, v("2026-07-01", null)], "2026-03-01")).toBeNull();
    expect(kettenEnden([erste, v("2026-07-01", "2026-12-31")]).map((e) => e.ende)).toEqual(["2026-12-31"]);
  });
  it("heute in der Luecke zwischen zwei Ketten: frei seit dem Ende der ersten; heute in der zweiten: deren Ende; heute vor allem: das naechste Ende", () => {
    const ketten = [v("2026-01-01", "2026-06-30"), v("2027-01-01", "2027-06-30")];
    expect(freiAbAus(ketten, "2026-09-15")!.freiAb).toBe("2026-06-30");
    expect(freiAbAus(ketten, "2027-03-01")!.freiAb).toBe("2027-06-30");
    expect(freiAbAus(ketten, "2025-12-01")!.freiAb).toBe("2026-06-30");
  });
  it("an_bhyo wandert mit dem Kettenende (Textvariante)", () => {
    const f = freiAbAus([v("2026-01-01", "2026-06-30", true)], "2026-05-01")!;
    expect(f.anBhyo).toBe(true);
    expect(wirdFreiText("B-000012 Stroh", f, 60)).toBe("Unsere Vergabe von B-000012 Stroh endet am 30.06.2026 — frei ab 01.07.2026");
    expect(wirdFreiText("B-000012 Stroh", { freiAb: "2026-06-30", anBhyo: false }, 30)).toBe("B-000012 Stroh wird frei ab 01.07.2026 (Vergabe endet 30.06.2026)");
    expect(wirdFreiText("B-000012 Stroh", f, 0)).toBe("B-000012 Stroh ist frei seit 01.07.2026");
  });
});

describe("Stufen (Regel 4–5)", () => {
  it("Stufenwechsel genau an den Grenzen: 181→180, 61→60, 31→30, 1→0; ueber 180 kein Hinweis", () => {
    expect(stufeFuer(181)).toBeNull();
    expect(stufeFuer(180)).toBe(180);
    expect(stufeFuer(61)).toBe(180);
    expect(stufeFuer(60)).toBe(60);
    expect(stufeFuer(31)).toBe(60);
    expect(stufeFuer(30)).toBe(30);
    expect(stufeFuer(1)).toBe(30);
    expect(stufeFuer(0)).toBe(0);
    expect(stufeFuer(-400)).toBe(0);
  });
  it("Einstieg bei 45 Resttagen ist Stufe 60 — die 180 wird nicht nachgeholt", () => {
    expect(stufeFuer(45)).toBe(60);
  });
  it("Pille: „frei ab“ ab 180 Tagen vorher, „frei seit“ ab frei_ab, davor nichts", () => {
    const vg = [v("2026-01-01", "2026-06-30")];
    const stand = (heute: string) => wirdFreiStand(vg, heute);
    expect(stand("2025-12-31")).toMatchObject({ freiAb: "2026-06-30", resttage: 181, stufe: null });
    expect(wirdFreiPill(stand("2025-12-31"))).toBeNull(); // 181 Tage
    expect(wirdFreiPill(stand("2026-01-01"))).toEqual({ text: "frei ab 01.07.2026.", tone: "quiet", stufe: 180 });
    expect(wirdFreiPill(stand("2026-06-30"))).toEqual({ text: "frei seit 01.07.2026.", tone: "active", stufe: 0 });
    expect(wirdFreiPill(stand("2026-09-01"))!.text).toBe("frei seit 01.07.2026.");
    expect(wirdFreiPill(null)).toBeNull();
    expect(wirdFreiStand([], "2026-01-01")).toBeNull();
  });
});

describe("Tagesgrenze Europe/Berlin (Regel 5)", () => {
  it("Resttage werden in Kalendertagen gezaehlt; der Stichtag kommt aus kalendertag() — auch an der Zeitumstellung 25.10.2026", () => {
    expect(tageZwischen("2026-10-24", "2026-10-26")).toBe(2);
    // 25.10.2026 00:30 Berlin (noch Sommerzeit, UTC+2) → Stichtag 25.10.; 26.10. 00:30 Berlin (Winterzeit, UTC+1) → 26.10.
    expect(kalendertag(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(kalendertag(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
    const vg = [v("2026-01-01", "2026-10-25")];
    expect(wirdFreiStand(vg, kalendertag(new Date("2026-10-24T22:30:00Z")))!.stufe).toBe(0);
    expect(wirdFreiStand(vg, kalendertag(new Date("2026-10-24T21:30:00Z")))!.stufe).toBe(30);
  });
});
