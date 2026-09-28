import { describe, expect, it } from "vitest";

import { bestimmeZugang, normalisiereEmail } from "./rollen";

const ID = "00000000-0000-4000-8000-0000000000aa";

describe("AP2.1 PR b0: Nutzer-ID im Zugang", () => {
  it("die ID reist unveraendert im Zugang mit und haengt nicht an der Schreibweise der E-Mail", () => {
    const eintrag = { id: ID, rolle: "bearbeiter" as const, aktiv: true, name: "Test" };
    const a = bestimmeZugang("Eric.Schmitt@bhyo.de ", eintrag);
    const b = bestimmeZugang("eric.schmitt@bhyo.de", eintrag);
    expect(a).toMatchObject({ art: "erlaubt", id: ID, email: "eric.schmitt@bhyo.de" });
    expect(b).toMatchObject({ art: "erlaubt", id: ID });
    expect(normalisiereEmail("Eric.Schmitt@bhyo.de ")).toBe("eric.schmitt@bhyo.de");
  });
  it("ohne Eintrag oder deaktiviert gibt es keinen Zugang und damit keine ID", () => {
    expect(bestimmeZugang("x@bhyo.de", null)).toEqual({ art: "unbekannt", email: "x@bhyo.de" });
    expect(bestimmeZugang("x@bhyo.de", { id: ID, rolle: "admin", aktiv: false, name: null })).toEqual({
      art: "deaktiviert",
      email: "x@bhyo.de",
    });
  });
});
