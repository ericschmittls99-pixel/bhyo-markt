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
  inboxErledigenMehrere: async () => ({ ok: true, anzahl: 0 }),
  inboxVerwerfenMehrere: async () => ({ ok: true, anzahl: 0 }),
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
  akteur: null,
  kontaktperson: null,
  text: "Bernd Bearbeiter hat B-000012 Papierschlamm geändert",
  kurz: { titel: "Änderung", kennung: "B-000012", akteur: "Papierfabrik Nord" },
  zeit: "vor 5 Min.",
  ...extra,
});

describe("InboxListe", () => {
  it("offen: ungelesene Zeile mit Punkt, Avatar, Text, Zeit und allen Aktionen; gelesene ohne Punkt", () => {
    const html = renderToStaticMarkup(
      <InboxListe
        zeilen={[
          zeile({}),
          // Anderer Tag — sonst wuerden beide Zeilen seit E77 R5 zur Gruppe.
          zeile({ id: "e2", gelesen: true, anzahl: 3, text: "Petra Prüfer hat B-000013 Stroh geändert (3 Änderungen)", aktualisiertAm: "2026-09-28T12:00:00.000Z" }),
        ]}
        zustand="offen"
      />,
    );
    expect(html).toContain('class="ib-zeile ib-ungelesen"');
    expect(html).toContain('aria-label="ungelesen"');
    expect(html).toContain("BB"); // Initialen des Auslösers
    // E77 R5: Kurzform sichtbar (Kurztitel · Kennung, Akteur klein/grau, Buendel-Zaehler), voller Text als Tooltip.
    expect(html).toContain('<span class="ib-titel">Änderung</span>');
    expect(html).toContain('<span class="ib-kennung">B-000012</span>');
    expect(html).toContain('<span class="ib-neben">Papierfabrik Nord</span>');
    expect(html).toContain('title="Bernd Bearbeiter hat B-000012 Papierschlamm geändert"');
    expect(html).toContain("3×");
    expect(html).toContain("vor 5 Min.");
    for (const a of ["Öffnen", "Erledigt", "Verwerfen", "Weitere Aktionen"]) expect(html).toContain(`aria-label="${a}"`);
    // Die gelesene Zeile traegt keinen Punkt und ist nicht fett.
    expect(html.match(/class="ib-zeile ib-ungelesen"/g)).toHaveLength(1);
    expect(html).not.toContain("ib-zustand");
  });

  it("erledigt: Zustands-Pille (erledigt bzw. verworfen), nur Öffnen als Aktion", () => {
    const html = renderToStaticMarkup(
      <InboxListe
        zeilen={[zeile({ zustand: "erledigt", gelesen: true }), zeile({ id: "e3", zustand: "verworfen", gelesen: true, aktualisiertAm: "2026-09-28T12:00:00.000Z" })]}
        zustand="erledigt"
      />,
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
    expect(html).toContain("Papierfabrik Nord · „Bitte kurz freigeben");
    expect(html).toContain(">Zuweisen<");
    expect(html).toContain(">Ablehnen<");
    expect(html).not.toContain('aria-label="Erledigt"');
    expect(html).not.toContain('aria-label="Verwerfen"');
  });
});

describe("E77 R5: Gruppen und Kurzform", () => {
  // Zwei Typen am selben Tag: zwei Zeilen desselben Typs (Gruppe) und eine einzelne.
  const drei = [
    zeile({ id: "g1", typ: "verifikation_abgelaufen", kurz: { titel: "Verifikation abgelaufen", kennung: "B-000012", akteur: "Papierfabrik Nord" }, aktualisiertAm: "2026-10-13T08:00:00.000Z" }),
    zeile({ id: "g2", typ: "verifikation_abgelaufen", gelesen: true, kurz: { titel: "Verifikation abgelaufen", kennung: "B-000013", akteur: "Hof Meier" }, aktualisiertAm: "2026-10-13T07:00:00.000Z" }),
    zeile({ id: "e9", typ: "kommentar", kurz: { titel: "Kommentar", kennung: "B-000014", akteur: null }, aktualisiertAm: "2026-10-13T06:00:00.000Z" }),
  ];

  it("gleiche Typen desselben Tages als eingeklappte Gruppe mit Zaehler, Ungelesen-Punkt und Gruppenaktionen; die Einzelne bleibt", () => {
    const html = renderToStaticMarkup(<InboxListe zeilen={drei} zustand="offen" />);
    expect(html.match(/class="ib-gruppe"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Gruppe aufklappen"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="pill pill--muted ib-anzahl">2</span>');
    expect(html).toContain("13.10.2026 · 1 ungelesen");
    expect(html).toContain('aria-label="Alle 2 erledigt"');
    expect(html).toContain('aria-label="Alle 2 verwerfen"');
    // Eingeklappt: die Zeilen der Gruppe sind nicht gerendert, die einzelne Kommentar-Zeile schon.
    expect(html).not.toContain("B-000013");
    expect(html).toContain('<span class="ib-kennung">B-000014</span>');
    expect(html).not.toContain("ib-gruppe-liste");
  });

  it("in „Erledigt“ hat die Gruppe keine Gruppenaktionen", () => {
    const html = renderToStaticMarkup(<InboxListe zeilen={drei.map((z) => ({ ...z, zustand: "erledigt" as const, gelesen: true }))} zustand="erledigt" />);
    expect(html).toContain('class="ib-gruppe"');
    expect(html).not.toContain("Alle 2 erledigt");
    expect(html).not.toContain("ib-ungelesen");
  });

  it("Zugriffsanfragen haben als Gruppe kein Erledigt/Verwerfen", () => {
    const zwei = [
      zeile({ id: "z1", typ: "zugriffsanfrage", notiz: "bitte", aktualisiertAm: "2026-10-13T08:00:00.000Z" }),
      zeile({ id: "z2", typ: "zugriffsanfrage", notiz: "auch", aktualisiertAm: "2026-10-13T07:00:00.000Z" }),
    ];
    const html = renderToStaticMarkup(<InboxListe zeilen={zwei} zustand="offen" />);
    expect(html).toContain('class="ib-gruppe"');
    expect(html).not.toContain("Alle 2 erledigt");
  });
});
