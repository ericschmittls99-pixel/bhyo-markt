import { describe, expect, it } from "vitest";

import {
  aktiveAdmins,
  pruefeAktivWechsel,
  pruefeNeuanlage,
  pruefeRollenwechsel,
  type BenutzerZeile,
} from "./benutzer-regeln";

const eric: BenutzerZeile = { email: "eric.schmitt@bhyo.de", rolle: "admin", aktiv: true };
const zweiterAdmin: BenutzerZeile = { email: "zweite@bhyo.de", rolle: "admin", aktiv: true };
const inaktiverAdmin: BenutzerZeile = { email: "alt@bhyo.de", rolle: "admin", aktiv: false };
const bearbeiter: BenutzerZeile = { email: "b@bhyo.de", rolle: "bearbeiter", aktiv: true };

describe("Selbstaussperrung — der Fall, der das System unbedienbar macht", () => {
  it("der letzte aktive Admin kann sich nicht herabstufen", () => {
    const ablehnung = pruefeRollenwechsel([eric, bearbeiter], eric.email, "bearbeiter");
    expect(ablehnung?.grund).toBe("letzter_admin");
  });

  it("der letzte aktive Admin kann sich nicht deaktivieren", () => {
    const ablehnung = pruefeAktivWechsel([eric, bearbeiter], eric.email, false);
    expect(ablehnung?.grund).toBe("letzter_admin");
  });

  it("ein inaktiver Admin zählt nicht als Rettung", () => {
    // Der Eintrag existiert, kommt aber nicht herein (fail closed) — er
    // koennte also niemandem eine Rolle geben.
    expect(aktiveAdmins([eric, inaktiverAdmin])).toHaveLength(1);
    expect(pruefeAktivWechsel([eric, inaktiverAdmin], eric.email, false)?.grund).toBe(
      "letzter_admin",
    );
  });

  it("ein Bearbeiter zählt nicht als Rettung", () => {
    expect(pruefeRollenwechsel([eric, bearbeiter], eric.email, "betrachter")?.grund).toBe(
      "letzter_admin",
    );
  });

  it("mit einem zweiten aktiven Admin geht beides", () => {
    expect(pruefeRollenwechsel([eric, zweiterAdmin], eric.email, "bearbeiter")).toBeNull();
    expect(pruefeAktivWechsel([eric, zweiterAdmin], eric.email, false)).toBeNull();
  });

  it("zum Admin hochstufen ist nie gesperrt", () => {
    expect(pruefeRollenwechsel([eric, bearbeiter], bearbeiter.email, "admin")).toBeNull();
  });

  it("einen anderen deaktivieren bleibt erlaubt, solange ein Admin bleibt", () => {
    expect(pruefeAktivWechsel([eric, bearbeiter], bearbeiter.email, false)).toBeNull();
  });

  it("wieder aktivieren ist nie gesperrt", () => {
    expect(pruefeAktivWechsel([eric, inaktiverAdmin], inaktiverAdmin.email, true)).toBeNull();
  });

  it("eine unbekannte Adresse wird benannt, nicht still übergangen", () => {
    expect(pruefeRollenwechsel([eric], "niemand@bhyo.de", "admin")?.grund).toBe("unbekannt");
    expect(pruefeAktivWechsel([eric], "niemand@bhyo.de", false)?.grund).toBe("unbekannt");
  });
});

describe("Neuanlage", () => {
  it("weist eine Adresse ab, die schon da ist", () => {
    expect(pruefeNeuanlage([eric], eric.email)?.grund).toBe("schon_vorhanden");
  });

  it("weist offensichtlichen Unsinn ab", () => {
    for (const falsch of ["", "kein-at", "a@b", "a b@c.de", "@bhyo.de"]) {
      expect(pruefeNeuanlage([eric], falsch)?.grund).toBe("ungueltige_email");
    }
  });

  it("lässt eine neue Adresse durch", () => {
    expect(pruefeNeuanlage([eric], "neu@bhyo.de")).toBeNull();
  });
});
