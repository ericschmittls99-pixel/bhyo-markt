import { describe, expect, it } from "vitest";

import { erwaehnungsAbfrage, fuegeTokenEin, markerZuTokens, tokenFuer, tokensZuMarkern, vorschlaege } from "./kommentar-eingabe";
import { erwaehnungsMarker } from "./kommentar-marker";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const C = "00000000-0000-4000-8000-0000000000c3";
const anna = { id: A, name: "Anna Admin", email: "anna@bhyo.de" };
const otto = { id: B, name: "Otto Other", email: "otto@bhyo.de" };
const otto2 = { id: C, name: "Otto Other", email: "otto2@bhyo.de" };

describe("E71 @-Eingabe: Tokens und Marker", () => {
  it("Token → Marker nur an Wortgrenzen; von Hand getippte @Namen bleiben Text", () => {
    const tokens = new Map([["@Otto Other", B]]);
    expect(tokensZuMarkern("Bitte @Otto Other prüfen, @Otto Otherwise nicht, @Anna Admin auch nicht.", tokens)).toBe(
      `Bitte ${erwaehnungsMarker(B)} prüfen, @Otto Otherwise nicht, @Anna Admin auch nicht.`,
    );
    expect(tokensZuMarkern("@Otto Other.", tokens)).toBe(`${erwaehnungsMarker(B)}.`);
    expect(tokensZuMarkern("(@Otto Other)", tokens)).toBe(`(${erwaehnungsMarker(B)})`);
  });
  it("gleicher Anzeigename: das zweite Token traegt die E-Mail — laengere Tokens werden zuerst ersetzt", () => {
    const tokens = new Map<string, string>();
    const t1 = tokenFuer(otto, tokens);
    tokens.set(t1, otto.id);
    const t2 = tokenFuer(otto2, tokens);
    tokens.set(t2, otto2.id);
    expect(t1).toBe("@Otto Other");
    expect(t2).toBe("@Otto Other (otto2@bhyo.de)");
    expect(tokensZuMarkern(`${t2} und ${t1}`, tokens)).toBe(`${erwaehnungsMarker(C)} und ${erwaehnungsMarker(B)}`);
  });
  it("Marker → Tokens beim Bearbeiten; deaktivierte/unbekannte bleiben Marker (und damit erhalten)", () => {
    const nutzer = new Map([
      [A, { name: "Anna Admin", email: "anna@bhyo.de", aktiv: true }],
      [B, { name: "Otto Other", email: "otto@bhyo.de", aktiv: false }],
    ]);
    const r = markerZuTokens(`Hi ${erwaehnungsMarker(A)} und ${erwaehnungsMarker(B)} und ${erwaehnungsMarker(C)}`, nutzer);
    expect(r.text).toBe(`Hi @Anna Admin und ${erwaehnungsMarker(B)} und ${erwaehnungsMarker(C)}`);
    expect([...r.tokens.entries()]).toEqual([["@Anna Admin", A]]);
    // Rueckweg: dieselben Marker wie vorher.
    expect(tokensZuMarkern(r.text, r.tokens)).toBe(`Hi ${erwaehnungsMarker(A)} und ${erwaehnungsMarker(B)} und ${erwaehnungsMarker(C)}`);
  });
});

describe("E71 @-Eingabe: Abfrage, Vorschlaege, Einfuegen", () => {
  it("erkennt die offene Abfrage am Wortanfang, nicht mitten im Wort oder in E-Mails", () => {
    expect(erwaehnungsAbfrage("Bitte @An", 9)).toEqual({ start: 6, abfrage: "An" });
    expect(erwaehnungsAbfrage("@", 1)).toEqual({ start: 0, abfrage: "" });
    expect(erwaehnungsAbfrage("mail anna@bhyo", 14)).toBeNull();
    expect(erwaehnungsAbfrage("Bitte @Anna fertig", 18)).toBeNull();
    expect(erwaehnungsAbfrage("Bitte @Anna fertig", 11)).toEqual({ start: 6, abfrage: "Anna" });
  });
  it("Vorschlaege nach Name oder E-Mail, ohne Gross/Klein, hoechstens max", () => {
    const alle = [anna, otto, otto2];
    expect(vorschlaege(alle, "ot")).toEqual([otto, otto2]);
    expect(vorschlaege(alle, "ANNA")).toEqual([anna]);
    expect(vorschlaege(alle, "otto2@")).toEqual([otto2]);
    expect(vorschlaege(alle, "")).toEqual(alle);
    expect(vorschlaege(alle, "", 2)).toEqual([anna, otto]);
    expect(vorschlaege(alle, "niemand")).toEqual([]);
  });
  it("fuegt das Token mit Leerzeichen ein und setzt den Cursor dahinter", () => {
    expect(fuegeTokenEin("Bitte @An prüfen", 6, 9, "@Anna Admin")).toEqual({ text: "Bitte @Anna Admin  prüfen", cursor: 18 });
  });
});
