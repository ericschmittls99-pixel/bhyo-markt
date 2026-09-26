// Faelligkeit je Belegtyp nach E33 (docs/ap0-schema-entscheidungen.md,
// Abschnitt 14): Jeder Beleg hat GENAU EINE Quelle fuer seine Faelligkeit.
//   - Obere vier Typen (Betriebsdaten, Vertrag, Absichtserklaerung, Angebot):
//     das gespeicherte `gueltig_bis` — Pflichtfeld, keine Typ-Frist.
//   - Untere drei Typen: Typ-Frist ab Erhebungsdatum, weil das Dokument kein
//     Enddatum traegt.
// Die alten Zahlen (Vertrag 36, Betriebsdaten 12, Absichtserklaerung 12,
// Angebot 3, Dokument/Link 12, Gespraech 6) gelten NICHT mehr — wer sie
// irgendwo findet, findet Altbestand.

import { brauchtGueltigBis, istBelegTyp } from "./qualitaet";

export const BELEG_MONATE: Record<string, number> = {
  gespraech: 3,
  dokument: 6,
  webrecherche: 3,
  // AP1j PR 5 (Beschluss 22.09.2026): Reservierungen laufen ueber DENSELBEN
  // Mechanismus — 12 Monate Gueltigkeit ab reserviert_seit, kein Sonderweg.
  reservierung: 12,
};

function plusMonate(iso: string, monate: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + monate);
  return d.toISOString().slice(0, 10);
}

/**
 * Faelligkeit des Belegs (ISO) oder null, wenn ein oberer Typ (noch) kein
 * `gueltig_bis` traegt — das ist der Zustand "keine Frist", der bis zum
 * CHECK aus Schritt 3 vorkommen kann. Ein `gueltig_bis` an einem unteren
 * Typ wird bewusst ignoriert: eine Quelle, nicht zwei.
 */
export function naechsteVerifizierung(beleg: {
  typ: string;
  gueltigBis: string | null;
  erhebungsdatum: string | null;
}): string | null {
  if (istBelegTyp(beleg.typ) && brauchtGueltigBis(beleg.typ)) return beleg.gueltigBis;
  if (!beleg.erhebungsdatum) return null;
  const monate = BELEG_MONATE[beleg.typ];
  if (!monate) return null;
  return plusMonate(beleg.erhebungsdatum, monate);
}

/**
 * Verifikations-Kopplung (AP1j PR 5, Handoff): Faelligkeit = das frueheste
 * von Belegfrist und den Ablaufdaten — verfuegbar-bis, jedes befristete
 * vergeben-bis (Zweck: beim Freiwerden nachfassen) und dem
 * Reservierungs-Ende (reserviert_seit + Typ-Gueltigkeit). Offene
 * Vergabe-Enden zaehlen nicht: sie laufen bis zum Verfuegbarkeitsende, das
 * bereits Kandidat ist. Funktioniert auch ohne Beleg.
 */
export function verifikationsFaelligkeit(
  beleg: { typ: string; gueltigBis: string | null; erhebungsdatum: string | null } | null,
  strom: { zeitraumBis: string | null; reserviertSeit: string | null },
  vergaben: { vergebenBis: string | null }[],
): string | null {
  const kandidaten: string[] = [];
  const frist = beleg ? naechsteVerifizierung(beleg) : null;
  if (frist) kandidaten.push(frist);
  if (strom.zeitraumBis) kandidaten.push(strom.zeitraumBis);
  for (const v of vergaben) if (v.vergebenBis) kandidaten.push(v.vergebenBis);
  if (strom.reserviertSeit)
    kandidaten.push(plusMonate(strom.reserviertSeit, BELEG_MONATE.reservierung!));
  return kandidaten.length ? kandidaten.sort()[0]! : null;
}

// --- Verifikations-Filter (E33, 26.09.2026) ---------------------------------

/**
 * Zustand eines Stroms gemessen an seiner Gesamtfaelligkeit gegen den
 * Stichtag: "aktiv" (Faelligkeit heute oder spaeter), "ausgelaufen"
 * (Faelligkeit liegt zurueck), "keine_frist" (kein Kandidat — z. B. ohne
 * Beleg, ohne Zeitraum, oder ein oberer Typ ohne Datum vor Schritt 3).
 * Der dritte Zustand ist benannt und filterbar (E24-Haltung), sonst fielen
 * fristlose Stroeme aus jedem Filter still heraus.
 */
export type VerifikationsStatus = "aktiv" | "ausgelaufen" | "keine_frist";

/** Reihenfolge = Anzeige-Reihenfolge der Filteroptionen. */
export const VERIFIKATION_LABEL: Record<VerifikationsStatus, string> = {
  aktiv: "aktiv",
  ausgelaufen: "ausgelaufen",
  keine_frist: "keine Frist",
};

export interface VerifikationsErgebnis {
  faelligkeit: string | null;
  status: VerifikationsStatus;
}

export function verifikationsStatus(
  faelligkeit: string | null,
  stichtag: string,
): VerifikationsStatus {
  if (!faelligkeit) return "keine_frist";
  // ISO-Datumsstrings vergleichen lexikographisch korrekt.
  return faelligkeit >= stichtag ? "aktiv" : "ausgelaufen";
}

/**
 * Reichert Stroeme um Faelligkeit und Verifikationsstatus an — serverseitig,
 * EIN Stichtag je Request (wie reichereVerfuegbarkeitAn). Dieselbe Funktion
 * verifikationsFaelligkeit, die auch das Detail und die Auswertung nutzen:
 * eine Groesse, ein Ursprung.
 */
export function reichereVerifikationAn<
  T extends {
    id: string;
    zeitraumBis: string | null;
    reserviertSeit: string | null;
    beleg: { typ: string; gueltigBis: string | null; erhebungsdatum: string | null } | null;
    verifikation?: VerifikationsErgebnis;
  },
>(
  stroeme: T[],
  vergabenJeStrom: Map<string, { vergebenBis: string | null }[]>,
  stichtag: string,
): (T & { verifikation: VerifikationsErgebnis })[] {
  return stroeme.map((s) => {
    const faelligkeit = verifikationsFaelligkeit(s.beleg, s, vergabenJeStrom.get(s.id) ?? []);
    return { ...s, verifikation: { faelligkeit, status: verifikationsStatus(faelligkeit, stichtag) } };
  });
}
