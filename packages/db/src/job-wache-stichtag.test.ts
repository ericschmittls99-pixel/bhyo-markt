/**
 * Betrieb: faelliger Stichtag der Job-Wache — Zeitzone Europe/Berlin,
 * Sommer- und Winterzeit, Umstellung 25.10.2026 (03:00 CEST → 02:00 CET,
 * also 01:00 UTC) und 29.03.2026, Grenzfall 05:29/05:30, Tageswechsel.
 */
import { describe, expect, it } from "vitest";

import { berlinZeit, faelligerStichtag } from "./job-wache-stichtag";

const f = (iso: string) => faelligerStichtag(new Date(iso));

describe("faelligerStichtag", () => {
  it("Sommerzeit (UTC+2): 05:29 Berlin = 03:29 UTC → gestern; 05:30 Berlin = 03:30 UTC → heute", () => {
    expect(f("2026-10-02T03:29:59Z")).toEqual({ stichtag: "2026-10-01", grund: "gestern" });
    expect(f("2026-10-02T03:30:00Z")).toEqual({ stichtag: "2026-10-02", grund: "heute" });
  });
  it("Winterzeit (UTC+1): 05:29 Berlin = 04:29 UTC → gestern; 05:30 Berlin = 04:30 UTC → heute", () => {
    expect(f("2026-11-02T04:29:59Z")).toEqual({ stichtag: "2026-11-01", grund: "gestern" });
    expect(f("2026-11-02T04:30:00Z")).toEqual({ stichtag: "2026-11-02", grund: "heute" });
    // 03:30 UTC ist im Winter erst 04:30 Berlin — noch gestern.
    expect(f("2026-11-02T03:30:00Z")).toEqual({ stichtag: "2026-11-01", grund: "gestern" });
  });
  it("Umstellungstag 25.10.2026: nach 01:00 UTC gilt UTC+1 — 04:17 UTC ist 05:17 Berlin (gestern), 04:30 UTC ist 05:30 (heute)", () => {
    expect(berlinZeit(new Date("2026-10-25T00:59:00Z"))).toEqual({ datum: "2026-10-25", minuteDesTages: 2 * 60 + 59 });
    expect(berlinZeit(new Date("2026-10-25T01:00:00Z"))).toEqual({ datum: "2026-10-25", minuteDesTages: 2 * 60 });
    expect(f("2026-10-25T04:17:00Z")).toEqual({ stichtag: "2026-10-24", grund: "gestern" });
    expect(f("2026-10-25T04:30:00Z")).toEqual({ stichtag: "2026-10-25", grund: "heute" });
    expect(f("2026-10-25T06:43:00Z")).toEqual({ stichtag: "2026-10-25", grund: "heute" });
  });
  it("Umstellungstag 29.03.2026 (02:00 CET → 03:00 CEST um 01:00 UTC): 03:30 UTC ist 05:30 Berlin → heute", () => {
    expect(f("2026-03-29T03:29:00Z")).toEqual({ stichtag: "2026-03-28", grund: "gestern" });
    expect(f("2026-03-29T03:30:00Z")).toEqual({ stichtag: "2026-03-29", grund: "heute" });
  });
  it("Tageswechsel: 00:30 Berlin am 3.10. (22:30 UTC am 2.10.) → gestern ist der 2.10.; Monats- und Jahreswechsel", () => {
    expect(f("2026-10-02T22:30:00Z")).toEqual({ stichtag: "2026-10-02", grund: "gestern" });
    expect(f("2026-11-01T02:00:00Z")).toEqual({ stichtag: "2026-10-31", grund: "gestern" });
    expect(f("2027-01-01T01:00:00Z")).toEqual({ stichtag: "2026-12-31", grund: "gestern" });
  });
  it("die vier Cron-Zeiten des Workflows (04:17, 06:43, 10:29, 15:11 UTC) ergeben im Sommer und Winter je 'heute' ausser 04:17 im Winter (05:17 Berlin → gestern)", () => {
    for (const utc of ["04:17", "06:43", "10:29", "15:11"]) expect(f(`2026-07-15T${utc}:00Z`).grund).toBe("heute");
    expect(f("2026-12-15T04:17:00Z")).toEqual({ stichtag: "2026-12-14", grund: "gestern" });
    for (const utc of ["06:43", "10:29", "15:11"]) expect(f(`2026-12-15T${utc}:00Z`).grund).toBe("heute");
  });
});
