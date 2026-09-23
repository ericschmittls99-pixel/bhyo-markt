import type { BelegBewertung } from "./qualitaet";

/**
 * E23: Ankerfaelle der Qualitaets-Matrix — die eine Referenzliste, gegen die
 * BEIDE Implementierungen laufen: deriveQualitaet (TS, qualitaet.test.ts) und
 * die DB-Funktion qualitaetsstufe() aus Migration 0013
 * (scripts/qualitaet-paritaet.ts im Deploy-CI). Wer die Matrix aendert,
 * aendert Funktion, DB-Migration und diese Liste gemeinsam — sonst schlaegt
 * die Paritaet laut fehl.
 */
export interface Ankerfall {
  name: string;
  bewertung: BelegBewertung;
  erwartet: "A" | "B" | "C" | "D";
}

const voll = (overrides: Partial<BelegBewertung> = {}): BelegBewertung => ({
  typ: "vertrag",
  externNachvollziehbar: true,
  erhebungsdatum: "2026-01-15",
  dateiKey: "belege/preview/abc.pdf",
  metadata: { quellenangabe: "Vertrag 2026" },
  ...overrides,
});

export const ANKERFAELLE: Ankerfall[] = [
  { name: "betriebsdaten vollstaendig", bewertung: voll({ typ: "betriebsdaten" }), erwartet: "A" },
  { name: "vertrag vollstaendig", bewertung: voll(), erwartet: "A" },
  { name: "absichtserklaerung vollstaendig", bewertung: voll({ typ: "absichtserklaerung" }), erwartet: "B" },
  { name: "angebot vollstaendig", bewertung: voll({ typ: "angebot", gueltigBis: "2026-06-30" }), erwartet: "C" },
  {
    name: "gespraech vollstaendig",
    bewertung: voll({
      typ: "gespraech",
      dateiKey: null,
      metadata: { quellenangabe: "Telefonat", gespraechsdatum: "2026-01-10", gespraechspartner: "Frau Muster" },
    }),
    erwartet: "C",
  },
  {
    name: "dokument_link amtlich",
    bewertung: voll({
      typ: "dokument_link",
      dateiKey: null,
      linkUrl: "https://amt.example/quelle",
      metadata: { quellenangabe: "Amtliche Statistik", amtlich: true },
    }),
    erwartet: "B",
  },
  {
    name: "dokument_link nicht amtlich",
    bewertung: voll({
      typ: "dokument_link",
      dateiKey: null,
      linkUrl: "https://amt.example/quelle",
      metadata: { quellenangabe: "Amtliche Statistik" },
    }),
    erwartet: "C",
  },
  {
    name: "dokument_link ohne Link/Datei trotz amtlich",
    bewertung: voll({
      typ: "dokument_link",
      dateiKey: null,
      metadata: { quellenangabe: "x", amtlich: true },
    }),
    erwartet: "D",
  },
  { name: "vertrag nicht extern nachvollziehbar", bewertung: voll({ externNachvollziehbar: false }), erwartet: "B" },
  { name: "betriebsdaten ohne Quellenangabe", bewertung: voll({ typ: "betriebsdaten", metadata: {} }), erwartet: "B" },
  { name: "angebot ohne gueltig_bis", bewertung: voll({ typ: "angebot" }), erwartet: "D" },
  { name: "vertrag nur mit Link", bewertung: voll({ dateiKey: null, linkUrl: "https://x" }), erwartet: "B" },
  {
    name: "gespraech ohne Gespraechsfelder",
    bewertung: voll({ typ: "gespraech", dateiKey: null, metadata: { quellenangabe: "Telefonat" } }),
    erwartet: "D",
  },
  { name: "vertrag ohne Erhebungsdatum", bewertung: voll({ erhebungsdatum: null }), erwartet: "B" },
];
