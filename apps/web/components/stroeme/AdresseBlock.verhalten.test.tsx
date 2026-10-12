/**
 * E77 R3 (Eric 12.10.2026): die Pin-Pille im Adressblock, mit jsdom und
 * Testing Library (Muster aus §45 / Kommentare.verhalten.test.tsx).
 *
 *   1. Die Pille zeigt „Pin: <Beschriftung>" mit Tooltip-Erklaerung.
 *   2. Jede Aenderung an Strasse, Hausnummer, PLZ oder Ort setzt sie auf
 *      „Pin: ungeprüft" — und den Hidden-Input genauigkeit auf unbekannt.
 *   3. „Adresse prüfen" setzt sie aus dem Ergebnis des Servers (Attrappe)
 *      wieder auf die geprüfte Stufe.
 * MapLibre kommt als Attrappe ueber die Prop ladeMapLibre (kein Canvas in jsdom).
 * Rot-Nachweis: ohne den Rueckfall in feld() faellt 2.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MapLibre kommt per Prop (ladeMapLibre) — eine Attrappe ohne Canvas; vi.mock greift bei dem
// dynamischen Import des externalisierten Pakets nicht (Befund 12.10.2026).
class MarkerAttrappe {
  setLngLat() { return this; }
  addTo() { return this; }
  on() { return this; }
  getLngLat() { return { lng: 0, lat: 0 }; }
}
class MapAttrappe {
  on() { return this; }
  remove() {}
  flyTo() {}
  getZoom() { return 9; }
}
const ladeMapLibre = async () => ({ Map: MapAttrappe, Marker: MarkerAttrappe }) as unknown as typeof import("maplibre-gl");
vi.mock("@/components/karte/KarteMap", () => ({ OSM_STYLE: { version: 8, sources: {}, layers: [] } }));

const { AdresseBlock } = await import("./AdresseBlock");

const antwortPruefung = { ergebnis: { status: "treffer", genauigkeit: "strasse", adresse: { strasse: "Hauptstraße", hausnummer: null, plz: "74889", ort: "Sinsheim", lng: 8.88, lat: 49.25 }, text: "Treffer: Straße." }, kreise: 1 };

describe("AdresseBlock: Pin-Pille (E77 R3)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      // Einfache Antwort-Attrappen statt Response: jsdom und Node teilen sich die Streams nicht.
      vi.fn(async (url: string) => {
        const json = String(url).startsWith("/api/adresse") ? antwortPruefung : { adressen: [] };
        return { ok: true, status: 200, json: async () => json };
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const pille = () => screen.getByTestId("adr-pille");
  const hidden = () => document.querySelector<HTMLInputElement>('input[name="genauigkeit"]')!;

  it("1 zeigt die Beschriftung mit Praefix und Erklaerung im Tooltip", () => {
    render(<AdresseBlock initial={{ strasse: "Hauptstraße", hausnummer: "1", plz: "74889", ort: "Sinsheim", lat: "49.25", lng: "8.88" }} initialGenauigkeit="hausnummer" akteurId={null} ladeMapLibre={ladeMapLibre} />);
    expect(pille().textContent).toBe("Pin: hausnummergenau");
    expect(pille().getAttribute("title")).toMatch(/Hausnummer/);
    expect(hidden().value).toBe("hausnummer");
  });

  it("2 jede Aenderung an Strasse, Hausnummer, PLZ oder Ort setzt „ungeprüft“", () => {
    for (const [name, wert] of [["strasse", "Nebenweg"], ["hausnummer", "2"], ["plz", "74888"], ["ort", "Heidelberg"]] as const) {
      render(<AdresseBlock initial={{ strasse: "Hauptstraße", hausnummer: "1", plz: "74889", ort: "Sinsheim", lat: "49.25", lng: "8.88" }} initialGenauigkeit="hausnummer" akteurId={null} ladeMapLibre={ladeMapLibre} />);
      expect(pille().textContent).toBe("Pin: hausnummergenau");
      fireEvent.change(document.querySelector(`input[name="${name}"]`)!, { target: { value: wert } });
      expect(pille().textContent, name).toBe("Pin: ungeprüft");
      expect(hidden().value, name).toBe("unbekannt");
      cleanup();
    }
  });

  it("2b dieselbe Eingabe ohne Aenderung laesst die Stufe stehen", () => {
    render(<AdresseBlock initial={{ strasse: "Hauptstraße", hausnummer: "1", plz: "74889", ort: "Sinsheim", lat: "49.25", lng: "8.88" }} initialGenauigkeit="hausnummer" akteurId={null} ladeMapLibre={ladeMapLibre} />);
    fireEvent.change(document.querySelector('input[name="ort"]')!, { target: { value: "Sinsheim" } });
    expect(pille().textContent).toBe("Pin: hausnummergenau");
  });

  it("3 „Adresse prüfen“ setzt die Stufe aus dem Ergebnis", async () => {
    render(<AdresseBlock initial={{ strasse: "Hauptstraße", hausnummer: "1", plz: "74889", ort: "Sinsheim", lat: "49.25", lng: "8.88" }} initialGenauigkeit="hausnummer" akteurId={null} ladeMapLibre={ladeMapLibre} />);
    fireEvent.change(document.querySelector('input[name="hausnummer"]')!, { target: { value: "" } });
    expect(pille().textContent).toBe("Pin: ungeprüft");
    fireEvent.click(screen.getByRole("button", { name: /Adresse prüfen/ }));
    await waitFor(() => expect(pille().textContent).toBe("Pin: Straße"));
    expect(hidden().value).toBe("strasse");
  });
});
