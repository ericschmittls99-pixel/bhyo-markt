/**
 * AP2.2 PR b: Render-Test der Liste — ohne Browser, ohne Datenbank. Auf der
 * Preview entstehen Eintraege nur durch Aenderungen ANDERER Nutzer; das ist
 * dort ohne zweiten Zugang nicht darstellbar (kein SQL, keine Rollenaenderung
 * — Regeln Eric). Der Test rendert deshalb feste Zeilen und prueft, was die
 * Oberflaeche zeigt: Ungelesen-Punkt, Avatar, Text mit Buendelung, Zeit,
 * Aktionen; in „Erledigt" die Zustands-Pille und keine Aktionen ausser Oeffnen.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/stroeme-actions", () => ({ stromReverifizieren: async () => ({ ok: true }) }));
vi.mock("@/lib/inbox/actions", () => ({
  inboxGelesen: async () => ({ ok: true }),
  inboxUngelesen: async () => ({ ok: true }),
  inboxErledigen: async () => ({ ok: true }),
  inboxVerwerfen: async () => ({ ok: true }),
  inboxWeitergeben: async () => ({ ok: true }),
  inboxAlleErledigen: async () => ({ ok: true, anzahl: 0 }),
}));

const { InboxListe, AlleErledigt } = await import("./InboxListe");
type Zeile = import("./InboxListe").Zeile;

const BERND = { id: "00000000-0000-4000-8000-0000000000b1", name: "Bernd Bearbeiter", email: "bernd@bhyo.de" };
const zeile = (extra: Partial<Zeile>): Zeile => ({
  id: "e1",
  typ: "aenderung_eintrag",
  zustand: "offen",
  anzahl: 1,
  gelesen: false,
  aktualisiertAm: "2026-09-29T12:00:00.000Z",
  zustandSeit: "2026-09-29T12:00:00.000Z",
  ausloeser: BERND,
  strom: { art: "biomasse", id: "s1" },
  belegNr: "B-000012",
  bezeichnung: "Papierschlamm",
  notiz: null,
  bezugsdatum: null,
  aufgabe: null,
  text: "Bernd Bearbeiter hat B-000012 Papierschlamm geändert",
  zeit: "vor 5 Min.",
  ...extra,
});

describe("InboxListe", () => {
  it("offen: ungelesene Zeile mit Punkt, Avatar, Text, Zeit und allen Aktionen; gelesene ohne Punkt", () => {
    const html = renderToStaticMarkup(
      <InboxListe
        zeilen={[
          zeile({}),
          zeile({ id: "e2", gelesen: true, anzahl: 3, text: "Petra Prüfer hat B-000013 Stroh geändert (3 Änderungen)" }),
        ]}
        zustand="offen"
      />,
    );
    expect(html).toContain('class="ib-zeile ib-ungelesen"');
    expect(html).toContain('aria-label="ungelesen"');
    expect(html).toContain("BB"); // Initialen des Auslösers
    expect(html).toContain("Bernd Bearbeiter hat B-000012 Papierschlamm geändert");
    expect(html).toContain("(3 Änderungen)");
    expect(html).toContain("vor 5 Min.");
    for (const a of ["Öffnen", "Erledigt", "Verwerfen", "Weitere Aktionen"]) expect(html).toContain(`aria-label="${a}"`);
    // Die gelesene Zeile traegt keinen Punkt und ist nicht fett.
    expect(html.match(/class="ib-zeile ib-ungelesen"/g)).toHaveLength(1);
    expect(html).not.toContain("ib-zustand");
  });

  it("erledigt: Zustands-Pille (erledigt bzw. verworfen), nur Öffnen als Aktion", () => {
    const html = renderToStaticMarkup(
      <InboxListe zeilen={[zeile({ zustand: "erledigt", gelesen: true }), zeile({ id: "e3", zustand: "verworfen", gelesen: true })]} zustand="erledigt" />,
    );
    expect(html).toContain("ib-zustand--erledigt");
    expect(html).toContain("ib-zustand--verworfen");
    expect(html).toContain('aria-label="Öffnen"');
    expect(html).not.toContain('aria-label="Erledigt"');
    expect(html).not.toContain('aria-label="Verwerfen"');
    expect(html).not.toContain("ib-ungelesen");
  });

  it("„Alle erledigt“ ist ohne offene Eintraege deaktiviert", () => {
    expect(renderToStaticMarkup(<AlleErledigt anzahlOffen={0} />)).toContain("disabled");
    expect(renderToStaticMarkup(<AlleErledigt anzahlOffen={2} />)).not.toContain("disabled");
  });
});

describe("PR c: Zugriffsanfrage in der Liste", () => {
  it("zeigt die Notiz, Zuweisen und Ablehnen — keine Erledigt/Verwerfen-Icons", () => {
    const html = renderToStaticMarkup(
      <InboxListe
        zeilen={[
          zeile({
            typ: "zugriffsanfrage",
            notiz: "Bitte kurz freigeben",
            text: "Bernd Bearbeiter bittet um Zugriff auf B-000012 Papierschlamm",
          }),
        ]}
        zustand="offen"
      />,
    );
    expect(html).toContain("bittet um Zugriff auf");
    expect(html).toContain("„Bitte kurz freigeben");
    expect(html).toContain(">Zuweisen<");
    expect(html).toContain(">Ablehnen<");
    expect(html).not.toContain('aria-label="Erledigt"');
    expect(html).not.toContain('aria-label="Verwerfen"');
  });
});
