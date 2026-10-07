/**
 * AP2.6 PR b (E71): Der Kommentar-Abschnitt als statisches Markup
 * (react-dom/server), Actions gemockt, Matrix echt. Geprueft wird, was die
 * Oberflaeche je Rolle zeigt — Zaehler, Eingabefeld nur mit Schreibrecht,
 * Bearbeiten nur am eigenen Kommentar, Loeschen fremder nur fuer admin,
 * „Kommentar geloescht" ohne Text, Marker als Name bzw. „ehemaliger Nutzer".
 * Das Ausblenden ist Komfort — die Rechte setzt der Server durch.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/kommentar-actions", () => ({
  kommentarErstellen: async () => ({ ok: true }),
  kommentarBearbeiten: async () => ({ ok: true }),
  kommentarLoeschen: async () => ({ ok: true }),
}));

const { Kommentare } = await import("./Kommentare");
const { erwaehnungsMarker } = await import("@/lib/kommentar-marker");
type Kommentar = import("@/lib/kommentar-modell").Kommentar;

const ICH = "00000000-0000-4000-8000-000000000001";
const ANDERE = "00000000-0000-4000-8000-000000000002";
const WEG = "00000000-0000-4000-8000-000000000003";
const STROM = "00000000-0000-4000-8000-0000000000aa";
const ich = { id: ICH, name: "Ida Ich", email: "ida@bhyo.de", aktiv: true };
const andere = { id: ANDERE, name: "Otto Other", email: "otto@bhyo.de", aktiv: true };
const weg = { id: WEG, name: "Walter Weg", email: "walter@bhyo.de", aktiv: false };

const eigener: Kommentar = {
  id: "k-eigen",
  bezug: { art: "biomasse", id: STROM },
  autor: ich,
  text: `Mein Text GEHEIMNIS-EIGEN an ${erwaehnungsMarker(ANDERE)} und ${erwaehnungsMarker(WEG)}`,
  erstelltAm: "2026-10-07T20:00:00.000Z",
  bearbeitetAm: "2026-10-07T20:30:00.000Z",
  geloeschtAm: null,
  erwaehnte: [andere, weg],
};
const fremder: Kommentar = { ...eigener, id: "k-fremd", autor: andere, text: "Fremder Text GEHEIMNIS-FREMD", bearbeitetAm: null, erwaehnte: [] };
const geloeschter: Kommentar = { ...fremder, id: "k-weg", autor: weg, text: null, geloeschtAm: "2026-10-07T21:00:00.000Z" };

function render(rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin" | null, kommentare: Kommentar[] = [eigener, fremder, geloeschter]) {
  return renderToStaticMarkup(
    <Kommentare
      bezug={{ art: "biomasse", id: STROM }}
      kommentare={kommentare}
      zugang={rolle ? { id: ICH, rolle } : null}
      darfErstellen={rolle !== null && rolle !== "betrachter"}
    />,
  );
}

describe("E71 Kommentar-Abschnitt", () => {
  it("Ueberschrift mit Zaehler; leere Liste mit Hinweis", () => {
    expect(render("bearbeiter")).toContain('kommentare. <span class="kom-zaehler">(3)</span>');
    const leer = render("bearbeiter", []);
    expect(leer).toContain("(0)");
    expect(leer).toContain("Noch keine Kommentare.");
  });
  it("Betrachter: liest alle Texte, kein Eingabefeld, keine Aktionen", () => {
    const html = render("betrachter");
    expect(html).toContain("GEHEIMNIS-EIGEN");
    expect(html).toContain("GEHEIMNIS-FREMD");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain(">Bearbeiten<");
    expect(html).not.toContain(">Löschen<");
  });
  it("Bearbeiter: Eingabefeld mit Hinweis; Bearbeiten und Loeschen nur am eigenen Kommentar", () => {
    const html = render("bearbeiter");
    expect(html).toContain("<textarea");
    expect(html).toContain("Keine Kontaktdaten Dritter – dafür Kontaktpersonen nutzen.");
    expect(html.match(/>Bearbeiten</g)?.length ?? 0).toBe(1);
    expect(html.match(/>Löschen</g)?.length ?? 0).toBe(1);
    // die Aktionen stehen im eigenen Eintrag, nicht im fremden
    const eigen = html.slice(html.indexOf('id="kommentar-k-eigen"'), html.indexOf('id="kommentar-k-fremd"'));
    expect(eigen).toContain(">Bearbeiten<");
    const fremd = html.slice(html.indexOf('id="kommentar-k-fremd"'), html.indexOf('id="kommentar-k-weg"'));
    expect(fremd).not.toContain(">Bearbeiten<");
    expect(fremd).not.toContain(">Löschen<");
  });
  it("Admin: loescht fremde, bearbeitet sie aber nicht", () => {
    const html = render("admin");
    const fremd = html.slice(html.indexOf('id="kommentar-k-fremd"'), html.indexOf('id="kommentar-k-weg"'));
    expect(fremd).toContain(">Löschen<");
    expect(fremd).not.toContain(">Bearbeiten<");
    expect(html.match(/>Löschen</g)?.length ?? 0).toBe(2); // eigener + fremder, nicht der geloeschte
  });
  it("geloeschter Kommentar: „Kommentar gelöscht“, kein Text, keine Aktionen, Autor als ehemaliger Nutzer", () => {
    const html = render("admin");
    const weg = html.slice(html.indexOf('id="kommentar-k-weg"'));
    expect(weg).toContain("Kommentar gelöscht");
    expect(weg).toContain("ehemaliger Nutzer");
    expect(weg).not.toContain("GEHEIMNIS");
    expect(weg).not.toContain(">Löschen<");
  });
  it("Marker werden als Name gezeigt, deaktivierte als „ehemaliger Nutzer“, nie die UUID; „bearbeitet“-Pille", () => {
    const html = render("betrachter");
    expect(html).toContain('<span class="kom-erwaehnung">@Otto Other</span>');
    expect(html).toContain('<span class="kom-erwaehnung kom-erwaehnung--ehemalig">@ehemaliger Nutzer</span>');
    expect(html).not.toContain("@[nutzer:");
    expect(html).toContain(">bearbeitet<");
    expect(html).toContain("07.10.2026, 22:00 Uhr");
  });
});
