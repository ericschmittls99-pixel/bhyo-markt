import { describe, expect, it } from "vitest";

import { BACKUP_MAX_STUNDEN, pruefeAlter, RESTORE_MAX_TAGE } from "./laeufe-wache";

const jetzt = new Date("2026-10-05T12:00:00Z");
const lauf = (updated_at: string, conclusion = "success") => ({ conclusion, updated_at });

describe("laeufe-wache: Backup <= 26 h, Restore-Test <= 8 Tage (Betrieb 05.10.2026)", () => {
  it("Grenzen sind 26 Stunden und 8 Tage", () => {
    expect(BACKUP_MAX_STUNDEN).toBe(26);
    expect(RESTORE_MAX_TAGE).toBe(8);
  });

  it("gruen, wenn der juengste erfolgreiche Lauf innerhalb der Grenze liegt", () => {
    const u = pruefeAlter([lauf("2026-10-05T08:45:00Z")], jetzt, 26);
    expect(u.ok).toBe(true);
    expect(u.alterStunden).toBeCloseTo(3.25, 2);
  });

  it("rot, wenn der juengste Erfolg aelter als die Grenze ist — mit Alter und Grenze im Grund", () => {
    const u = pruefeAlter([lauf("2026-10-04T08:00:00Z")], jetzt, 26);
    expect(u.ok).toBe(false);
    expect(u.grund).toMatch(/vor 28\.0 h, erlaubt 26 h/);
  });

  it("nur erfolgreiche Laeufe zaehlen: ein junger roter Lauf rettet nicht", () => {
    const u = pruefeAlter([lauf("2026-10-05T11:00:00Z", "failure"), lauf("2026-10-03T02:00:00Z")], jetzt, 26);
    expect(u.ok).toBe(false);
    expect(u.letzter).toBe("2026-10-03T02:00:00Z");
  });

  it("kein erfolgreicher Lauf = rot, nie still gruen", () => {
    expect(pruefeAlter([], jetzt, 26).ok).toBe(false);
    expect(pruefeAlter([lauf("2026-10-05T11:00:00Z", "cancelled")], jetzt, 26).grund).toMatch(/kein erfolgreicher Lauf/);
  });

  it("Restore: 8 Tage = 192 h; ein Lauf von vor 7 Tagen ist gruen, von vor 9 Tagen rot", () => {
    expect(pruefeAlter([lauf("2026-09-28T12:00:00Z")], jetzt, RESTORE_MAX_TAGE * 24).ok).toBe(true);
    expect(pruefeAlter([lauf("2026-09-26T12:00:00Z")], jetzt, RESTORE_MAX_TAGE * 24).ok).toBe(false);
  });

  it("die Grenze 0 macht jeden Lauf rot (Rot-Nachweis per Eingabe)", () => {
    expect(pruefeAlter([lauf("2026-10-05T11:59:00Z")], jetzt, 0).ok).toBe(false);
  });
});
