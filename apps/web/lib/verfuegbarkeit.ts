import { fmtMonat } from "./format";
import {
  datumZuMonat,
  monatZuBis,
  monatZuVon,
  type FeldFehler,
} from "./formular-modell";
// Nur Typ-Import — kein Laufzeit-Zyklus mit stroeme-modell.
import type { StromArt } from "./stroeme-modell";

/**
 * Verfuegbarkeits-/Vergabe-Modell (AP1j PR 2) — reine Logik ohne Datenbank.
 * Der Status wird NIE gespeichert, immer abgeleitet (Prinzip wie Qualitaet
 * A-D); `heute` ist Parameter, damit die Ableitung deterministisch testbar
 * bleibt. Hierarchie und Konvention offener Enden:
 * docs/ap1j-handoff-verfuegbarkeit-vergabe.md.
 */

export type VerfuegbarkeitsStatus =
  | "abgelaufen"
  | "noch_nicht_verfuegbar"
  | "vergeben_extern"
  | "vergeben_bhyo"
  | "reserviert_bhyo"
  | "verfuegbar";

/** Vergabezeile auf Datenbank-Ebene (ISO-Daten, offene Enden = null). */
export interface VergabeDaten {
  vergebenVon: string | null;
  vergebenBis: string | null;
  vergebenAn: string | null;
  anBhyo: boolean;
}

export interface VerfuegbarkeitsErgebnis {
  status: VerfuegbarkeitsStatus;
  /** Randfall Handoff: Reservierung zusaetzlich zur externen Vergabe zeigen. */
  reserviertZusatz: boolean;
}

// Pillen-Texte (Kleinschreibung mit Schlusspunkt, V2) je Stromart — Beschluss
// 22.09.2026: Ein "vergebener" Output-Bedarf wird in Wirklichkeit bereits von
// jemand anderem GEDECKT; die Feedstock-Formulierung laese sich falsch herum.
// Toene je Status identisch, keine Ampel.
const PILL_TEXT: Record<StromArt, Record<VerfuegbarkeitsStatus, string>> = {
  biomasse: {
    verfuegbar: "verfügbar.",
    vergeben_bhyo: "vergeben (bhyo).",
    vergeben_extern: "vergeben (extern).",
    reserviert_bhyo: "reserviert (bhyo).",
    noch_nicht_verfuegbar: "noch nicht verfügbar.",
    abgelaufen: "abgelaufen.",
  },
  output: {
    verfuegbar: "offen.",
    vergeben_bhyo: "gedeckt (bhyo).",
    vergeben_extern: "gedeckt (extern).",
    reserviert_bhyo: "reserviert (bhyo).",
    noch_nicht_verfuegbar: "noch nicht verfügbar.",
    abgelaufen: "abgelaufen.",
  },
};

const PILL_TONE: Record<VerfuegbarkeitsStatus, string> = {
  verfuegbar: "active",
  vergeben_bhyo: "running",
  vergeben_extern: "inactive",
  reserviert_bhyo: "quiet",
  noch_nicht_verfuegbar: "quiet",
  abgelaufen: "inactive",
};

/** Pillen-Text und -Ton je Stromart (Handoff-Tabelle „Label-Sätze je Stromart"). */
export function verfuegbarkeitPill(
  art: StromArt,
  status: VerfuegbarkeitsStatus,
): { text: string; tone: string } {
  return { text: PILL_TEXT[art][status], tone: PILL_TONE[status] };
}

/** Filter-Options-Label: Pill-Text ohne Schlusspunkt, Grossschreibung am Anfang. */
export function verfuegbarkeitLabel(
  art: StromArt,
  status: VerfuegbarkeitsStatus,
): string {
  const t = PILL_TEXT[art][status].slice(0, -1);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Erste zutreffende Regel gewinnt (Handoff-Hierarchie 1-5). Offene Enden
 * werden fuer die Pruefung durch Verfuegbarkeitsbeginn/-ende ersetzt.
 * ISO-Strings vergleichen lexikographisch korrekt — kein Date-Parsing noetig.
 *
 * `stichtag` statt "heute" (Review 22.09.2026): stroeme./karte. uebergeben
 * das Serverdatum; auswertung. rechnet fensterbezogen ueber die
 * Monatszerlegung (PR 4) und ruft diese Funktion NICHT mit einem Jahr auf.
 */
export function leiteVerfuegbarkeitAb(
  stichtag: string,
  strom: { zeitraumVon: string; zeitraumBis: string; reserviertBhyo: boolean },
  vergaben: VergabeDaten[],
): VerfuegbarkeitsErgebnis {
  // Beschluss 22.09.2026: Die Reservierung erscheint IMMER als Nebentag,
  // sobald sie nicht selbst der Haupttag ist — Regeln 1-3 bestimmen den
  // Haupttag, die Zusatz-Pille macht die Zusage trotzdem sichtbar.
  //
  // Review Eric 24.09.2026: Der Stempel markiert nicht die Reservierung,
  // sondern dass bhyo an diesem Strom haengt — er erscheint deshalb auch bei
  // einer Vergabe "an bhyo". Ausgenommen bleibt nur der Fall, in dem die
  // Reservierung selbst der Haupttag ist: dort stuende er doppelt.
  const mit = (status: VerfuegbarkeitsStatus): VerfuegbarkeitsErgebnis => ({
    status,
    reserviertZusatz:
      (strom.reserviertBhyo || status === "vergeben_bhyo") &&
      status !== "reserviert_bhyo",
  });

  if (stichtag > strom.zeitraumBis) return mit("abgelaufen");
  if (stichtag < strom.zeitraumVon) return mit("noch_nicht_verfuegbar");

  const aktiv = vergaben.find(
    (v) =>
      stichtag >= (v.vergebenVon ?? strom.zeitraumVon) &&
      stichtag <= (v.vergebenBis ?? strom.zeitraumBis),
  );
  if (aktiv) return mit(aktiv.anBhyo ? "vergeben_bhyo" : "vergeben_extern");
  if (strom.reserviertBhyo) return mit("reserviert_bhyo");
  return mit("verfuegbar");
}

/**
 * Reichert Stroeme um den abgeleiteten Status an (serverseitig, EIN stichtag
 * je Request, PR 3). Stroeme ohne vollstaendigen Verfuegbarkeitszeitraum
 * bleiben unangereichert — kein stummes Raten.
 */
export function reichereVerfuegbarkeitAn<
  T extends {
    id: string;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    reserviertBhyo: boolean;
    verfuegbarkeit?: VerfuegbarkeitsErgebnis;
  },
>(
  stroeme: T[],
  vergabenJeStrom: Map<string, VergabeDaten[]>,
  stichtag: string,
): T[] {
  return stroeme.map((s) =>
    s.zeitraumVon && s.zeitraumBis
      ? {
          ...s,
          verfuegbarkeit: leiteVerfuegbarkeitAb(
            stichtag,
            {
              zeitraumVon: s.zeitraumVon,
              zeitraumBis: s.zeitraumBis,
              reserviertBhyo: s.reserviertBhyo,
            },
            vergabenJeStrom.get(s.id) ?? [],
          ),
        }
      : s,
  );
}

/** Anzeige eines Vergabezeitraums; offene Enden nach Handoff-Konvention. */
export function vergabeLabel(von: string | null, bis: string | null): string {
  if (von && bis) return `${fmtMonat(von)} – ${fmtMonat(bis)}`;
  if (bis) return `bis ${fmtMonat(bis)}`;
  return `ab ${fmtMonat(von)} (unbefristet)`;
}

/**
 * Stempel-Regel fuer reserviert_seit (Migration 0010): Setzen stempelt den
 * uebergebenen Stichtag, Editieren bei bestehendem Stempel verjuengt NICHT
 * (sonst wuerde jedes Speichern die Zusage auffrischen), Abwaehlen nullt.
 */
export function naechsteReserviertSeit(
  reserviert: boolean,
  bisher: string | null,
  heute: string,
): string | null {
  if (!reserviert) return null;
  return bisher ?? heute;
}

// --- Formular-Ebene (Monats-Strings, "" = offenes Ende) ----------------------

export interface VergabeFormZeile {
  vonMonat: string;
  bisMonat: string;
  an: string;
  anBhyo: boolean;
}

/** Beide Daten leer = keine Vergabe (Handoff) — wird nie gespeichert. */
export function istLeereVergabe(zeile: VergabeFormZeile): boolean {
  return !zeile.vonMonat && !zeile.bisMonat;
}

/**
 * Die vier Handoff-Regeln; Keys passen zur Inline-Anzeige im Panel
 * (vergabe_<index>_von / _bis, Index = Position im uebergebenen Array,
 * Leerzeilen behalten ihren Index). Fuer die Ueberlappungspruefung werden
 * offene Enden durch Verfuegbarkeitsbeginn/-ende ersetzt; damit ist auch
 * "hoechstens ein offenes Ende je Richtung" abgedeckt — zwei offene Anfaenge
 * ueberlappen nach Normalisierung immer.
 */
export function validiereVergaben(
  vonMonat: string,
  bisMonat: string,
  zeilen: VergabeFormZeile[],
): FeldFehler {
  const f: FeldFehler = {};
  const belegt = zeilen
    .map((zeile, i) => ({ zeile, i }))
    .filter(({ zeile }) => !istLeereVergabe(zeile));

  for (const { zeile, i } of belegt) {
    if (zeile.vonMonat && zeile.bisMonat && zeile.bisMonat < zeile.vonMonat)
      f[`vergabe_${i}_bis`] = "Bis liegt vor Ab";
    if (vonMonat && zeile.vonMonat && zeile.vonMonat < vonMonat)
      f[`vergabe_${i}_von`] = "Liegt vor dem Verfügbarkeitsbeginn";
    if (bisMonat) {
      if (zeile.vonMonat && zeile.vonMonat > bisMonat)
        f[`vergabe_${i}_von`] = "Liegt nach dem Verfügbarkeitsende";
      if (zeile.bisMonat && zeile.bisMonat > bisMonat)
        f[`vergabe_${i}_bis`] = "Liegt nach dem Verfügbarkeitsende";
    }
  }

  const normalisiert = belegt
    .map(({ zeile, i }) => ({
      i,
      von: zeile.vonMonat || vonMonat,
      bis: zeile.bisMonat || bisMonat,
    }))
    .sort((a, b) => (a.von < b.von ? -1 : a.von > b.von ? 1 : a.i - b.i));
  for (let k = 1; k < normalisiert.length; k++) {
    if (normalisiert[k]!.von <= normalisiert[k - 1]!.bis)
      f[`vergabe_${normalisiert[k]!.i}_von`] =
        "Überschneidet sich mit einem anderen Vergabezeitraum";
  }
  return f;
}

/** Formular -> Persistenz: Leerzeilen weg, Monat -> Datum, leere Enden -> null. */
export function vergabenZuWerten(zeilen: VergabeFormZeile[]): VergabeDaten[] {
  return zeilen
    .filter((zeile) => !istLeereVergabe(zeile))
    .map((zeile) => ({
      vergebenVon: zeile.vonMonat ? monatZuVon(zeile.vonMonat) : null,
      vergebenBis: zeile.bisMonat ? monatZuBis(zeile.bisMonat) : null,
      vergebenAn: zeile.an.trim() || null,
      anBhyo: zeile.anBhyo,
    }));
}

/** Persistenz -> Formular (Edit-Prefill). */
export function vergabenZuFormZeilen(
  daten: VergabeDaten[],
): VergabeFormZeile[] {
  return daten.map((d) => ({
    vonMonat: datumZuMonat(d.vergebenVon),
    bisMonat: datumZuMonat(d.vergebenBis),
    an: d.vergebenAn ?? "",
    anBhyo: d.anBhyo,
  }));
}
