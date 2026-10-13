/**
 * E77 R6: Render-Test der Akteur-Sidebar — ohne Browser, ohne Datenbank.
 * Geprueft: die Huelle der Strom-Sidebar (ov--panel, Dialog „Akteurdetails",
 * Schliessen), Kopf mit Sektor- und Zustands-Pillen, die sechs Abschnitte in
 * der Reihenfolge Stammdaten, Sitz, Kontaktpersonen, Stroeme, Kommentare,
 * Verlauf, die Stroeme-Tabelle mit Link ins Detail, und die
 * Nicht-gefunden-Variante.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/akteure",
  useSearchParams: () => new URLSearchParams("detail=a1"),
}));
vi.mock("@/components/akteure/AkteurKarte", () => ({ AkteurKarte: () => <div className="ak-karte" data-karte /> }));
vi.mock("@/lib/akteur-actions", () => ({ akteurBearbeiten: async () => ({ ok: true }), akteurLoeschen: async () => ({ ok: true }) }));
vi.mock("@/lib/kontaktperson-actions", () => ({
  kontaktpersonAnlegen: async () => ({ ok: true }),
  kontaktpersonBearbeiten: async () => ({ ok: true }),
  kontaktpersonLoeschen: async () => ({ ok: true }),
  kontaktpersonAuskunftErstellen: async () => ({ ok: true }),
}));
vi.mock("@/lib/kommentar-actions", () => ({
  kommentarErstellen: async () => ({ ok: true }),
  kommentarBearbeiten: async () => ({ ok: true }),
  kommentarLoeschen: async () => ({ ok: true }),
}));

const { AkteurDetail, AkteurNichtGefunden } = await import("./AkteurDetail");
type Props = Parameters<typeof AkteurDetail>[0];

const akteur: Props["akteur"] = {
  id: "a1",
  name: "Papierfabrik Nord",
  sektor: "industrie",
  sektorLabel: "Industrie",
  sitzStrasse: "Werkstraße",
  sitzHausnummer: "1",
  sitzPlz: "68159",
  sitzOrt: "Mannheim",
  sitzLng: 8.46,
  sitzLat: 49.49,
  sitzGenauigkeit: "hausnummer",
  kreisArs: "08222",
  kreisName: "Mannheim",
  regionIds: [],
  stroeme: 1,
  mitBeleg: 1,
  verwaistSeit: null,
  erstelltAm: "2026-10-01",
  kontaktpersonen: 0,
  dublettenverdacht: false,
};

const basis: Props = {
  akteur,
  sektoren: [{ code: "industrie", label: "Industrie", aktiv: true }],
  darfBearbeiten: true,
  darfLoeschen: false,
  standorte: [],
  stroeme: [{ id: "s1", art: "biomasse", belegNr: "B-000012", bezeichnung: "Papierschlamm", ort: "Mannheim", status: "geprueft", lng: null, lat: null } as Props["stroeme"][number]],
  personen: [],
  kontaktRechte: { schreiben: true, loeschen: false, auskunft: false },
  verlauf: [{ zeitpunkt: "01.10.2026, 10:00 Uhr", text: "angelegt", importLaufId: null }],
  kommentare: [],
  kommentarZugang: { id: "u1", rolle: "bearbeiter" },
  darfKommentieren: true,
  erwaehnbare: [],
};

describe("AkteurDetail (E77 R6)", () => {
  it("Huelle der Strom-Sidebar, Kopf mit Pillen, sechs Abschnitte in der Reihenfolge der Entscheidung", () => {
    const html = renderToStaticMarkup(<AkteurDetail {...basis} />);
    expect(html).toContain('class="ov ov--panel"');
    expect(html).toContain('aria-label="Akteurdetails"');
    expect(html).toContain('aria-label="Schließen"');
    expect(html).toContain("<h2>Papierfabrik Nord</h2>");
    expect(html).toContain('<span class="pill pill--accent">Industrie</span>');
    const reihenfolge = ["stammdaten.", "sitz und standorte.", "kontaktpersonen.", "belege und ströme.", "kommentare.", "verlauf."].map((t) => html.indexOf(t));
    expect(reihenfolge.every((i) => i >= 0)).toBe(true);
    expect([...reihenfolge].sort((a, b) => a - b)).toEqual(reihenfolge);
    // Stroeme-Tabelle mit Link ins Strom-Detail, Verlauf mit Zeile, Karte eingehaengt.
    expect(html).toContain('href="/register?sicht=feedstock&amp;detail=s1"');
    expect(html).toContain("B-000012");
    expect(html).toContain("angelegt");
    expect(html).toContain("data-karte");
    expect(html).toContain('id="kontaktpersonen"');
  });

  it("verwaist: Pille und „seit …“; ohne Stroeme der Hinweis; Zaehler bei Kontaktpersonen", () => {
    const html = renderToStaticMarkup(
      <AkteurDetail
        {...basis}
        akteur={{ ...akteur, stroeme: 0, mitBeleg: 0, verwaistSeit: "2026-09-01" }}
        stroeme={[]}
        personen={[{ id: "p1", akteurId: "a1", name: "Maria Muster", funktion: null, mailDienstlich: null, telefon: null, notiz: null, letzteAktivitaet: "2026-10-01" } as Props["personen"][number]]}
      />,
    );
    expect(html).toContain(">verwaist<");
    expect(html).toContain("seit 01.09.2026");
    expect(html).toContain("Kein Strom verweist auf diesen Akteur");
    expect(html).toContain("kontaktpersonen. (1)");
    expect(html).toContain("Maria Muster");
  });

  it("nicht gefunden: eigene Sidebar mit Hinweis und Schliessen", () => {
    const html = renderToStaticMarkup(<AkteurNichtGefunden />);
    expect(html).toContain("Akteur nicht gefunden.");
    expect(html).toContain('aria-label="Schließen"');
  });
});
