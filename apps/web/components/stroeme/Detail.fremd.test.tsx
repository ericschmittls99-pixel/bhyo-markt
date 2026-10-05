/**
 * E44 (AP2.1 Folge-PR): Der Beleg-Kopf im Zustand „fremd" — Rolle bearbeiter,
 * weder Sperrinhaber noch zugewiesen. Gerendert als statisches Markup
 * (react-dom/server), Infrastruktur gemockt: KEIN Knopf fuer Bearbeiten,
 * Status oder Verwerfen, dafuer der Hinweis „Gesperrt von <Name>". Als
 * Gegenprobe der Inhaber: Knoepfe da, kein Hinweis. Der Test kann scheitern —
 * wird die Bedingung `darfBearbeiten` entfernt, ist er rot (einmal gezeigt).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/link", () => ({ default: (p: { children: unknown }) => p.children }));
vi.mock("@/components/stroeme/useUrlZustand", () => ({ useUrlZustand: () => ({ setze: () => {}, searchParams: new URLSearchParams() }) }));
vi.mock("@/lib/stroeme-actions", () => ({ statusSetzen: async () => ({ ok: true }), stromVerwerfen: async () => ({ ok: true }) }));
vi.mock("@/lib/sperre-actions", () => ({
  stromSperren: async () => ({ ok: true }),
  stromEntsperren: async () => ({ ok: true }),
  stromZuweisen: async () => ({ ok: true }),
  zuweisungEntfernen: async () => ({ ok: true }),
}));

const { Detail } = await import("./Detail");
type Strom = import("@/lib/stroeme-modell").Strom;

const PETRA = { id: "00000000-0000-4000-8000-000000000002", name: "Petra Prüfer", email: "petra@bhyo.de" };

const strom = {
  id: "s1",
  art: "biomasse",
  akteurId: "a1",
  akteurName: "Papierfabrik Bad Dürkheim",
  sektor: "industrie",
  sektorLabel: "Industrie",
  bezeichnung: "Papierschlamm",
  ort: "Bad Dürkheim",
  verwaltung: null,
  regionIds: [],
  regionNamen: [],
  lng: null,
  lat: null,
  cluster: "organische_rest_abfallstoffe",
  materialartCode: "papierschlamm",
  materialartLabel: "Papierschlamm",
  mengeFm: 2460,
  tsAnteil: 45,
  aschegehalt: 5,
  mengeAtro: 1049,
  preisMin: -54,
  preisMittel: -43,
  preisMax: -32,
  preisHerkunft: null,
  gruppe: null,
  gruppeLabel: null,
  produktCode: null,
  produktLabel: null,
  kategorie: null,
  mengeWert: null,
  mengeEinheit: null,
  preis: null,
  preisEinheit: null,
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2031-12-31",
  saisonalitaet: Array(12).fill(100),
  qualitaet: "A",
  status: "geprueft",
  reserviertBhyo: false,
  reserviertSeit: null,
  erstelltAm: "28.09.2026",
  beleg: null,
  vollstaendigkeit: 80,
  sperre: { von: PETRA, am: "2026-09-28T17:50:00.000Z" },
  zuweisungen: [],
} as unknown as Strom;

function render(
  sperrRechte: { bearbeiten: boolean; sperren: boolean; entsperren: boolean; zuweisen: boolean; anfragen?: boolean },
  anfrage: { am: string } | null = null,
) {
  return renderToStaticMarkup(
    <Detail
      strom={strom}
      historie={[]}
      begruendung={null}
      modal={false}
      canEdit={true}
      sperrRechte={sperrRechte}
      zuweisbare={[]}
      anfrage={anfrage}
    />,
  );
}

describe("E44 Beleg-Kopf: fremder Bearbeiter an einem gesperrten Strom", () => {
  const fremd = render({ bearbeiten: false, sperren: false, entsperren: false, zuweisen: false });
  it("zeigt den Hinweis „Gesperrt von <Name>“ mit Schloss und Avatar", () => {
    expect(fremd).toContain('<span class="ov-sperre-hinweis">Gesperrt von Petra Prüfer</span>');
    expect(fremd).toContain("ph-lock");
    expect(fremd).toContain(">PP<");
  });
  it("blendet Bearbeiten, Statuswechsel und Verwerfen aus", () => {
    expect(fremd).not.toContain(">Bearbeiten<");
    expect(fremd).not.toContain('aria-label="Strom verwerfen"');
    expect(fremd).not.toContain('title="Status ändern"');
    expect(fremd).not.toContain("ph-caret-down");
  });
  it("zeigt keine Sperr-Aktionen (Sperren, Entsperren, Zuweisen)", () => {
    expect(fremd).not.toContain('aria-label="Sperren"');
    expect(fremd).not.toContain('aria-label="Entsperren"');
    expect(fremd).not.toContain('aria-label="Zuweisen …"');
  });
  it("Gegenprobe Sperrinhaber/Zugewiesener: Knoepfe da, kein Hinweis", () => {
    const inhaber = render({ bearbeiten: true, sperren: false, entsperren: true, zuweisen: true });
    expect(inhaber).toContain(">Bearbeiten<");
    expect(inhaber).toContain('aria-label="Strom verwerfen"');
    expect(inhaber).toContain('aria-label="Entsperren"');
    // Der Tooltip nennt den Inhaber weiterhin; der HINWEIS fuer Nicht-Berechtigte fehlt.
    expect(inhaber).not.toContain("ov-sperre-hinweis");
    expect(inhaber).toContain("gesperrt seit");
  });
});

// --- PR c: Zugriff anfragen ------------------------------------------------
describe("PR c: fremder Bearbeiter am gesperrten Strom", () => {
  const fremd = { bearbeiten: false, sperren: false, entsperren: false, zuweisen: false, anfragen: true };
  it("sieht den Knopf „Zugriff anfragen“, solange keine Anfrage laeuft", () => {
    const html = render(fremd);
    expect(html).toContain("Zugriff anfragen");
    expect(html).not.toContain("Angefragt am");
  });
  it("sieht „Angefragt am …“ statt des Knopfs, wenn seine Anfrage offen ist", () => {
    const html = render(fremd, { am: "2026-09-29T12:00:00.000Z" });
    expect(html).toContain("Angefragt am");
    expect(html).not.toContain("Zugriff anfragen");
  });
  it("Inhaber, Zugewiesene und Betrachter sehen keinen Knopf", () => {
    expect(render({ bearbeiten: true, sperren: false, entsperren: true, zuweisen: true, anfragen: false })).not.toContain("Zugriff anfragen");
    expect(render({ bearbeiten: false, sperren: false, entsperren: false, zuweisen: false, anfragen: false })).not.toContain("Zugriff anfragen");
  });
});
