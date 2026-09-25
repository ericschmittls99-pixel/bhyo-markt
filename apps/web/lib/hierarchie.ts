/**
 * Gruppierte Filter (F5 PR B) — EIN Bauteil für alle drei Hierarchien:
 * Cluster → Materialart, Gruppe → Produkt, Bundesland → Landkreis → Ort.
 * Nicht drei ähnliche Umsetzungen, sondern eine (Entscheidung Eric,
 * 25.09.2026).
 *
 * Bedienung wie in Power BI: Auswahl auf jeder Ebene, Aufklappen und
 * Auswählen getrennt, Mehrfachauswahl über Ebenen hinweg, Teilauswahl am
 * Elternteil sichtbar.
 *
 * **Gespeichert wird die höchste gewählte Ebene**, die unteren sind
 * implizit. Wer Baden-Württemberg wählt, bekommt `bundesland=08`, nicht alle
 * Kreisschlüssel. Das hält die Adresszeile kurz und bleibt richtig, wenn
 * später ein Kreis dazukommt — eine Liste aller heutigen Kreise wäre am Tag
 * danach falsch, ohne dass es jemand merkt.
 *
 * Diese Datei ist rein: Eingaben rein, Ergebnis raus. Keine Datenbank, kein
 * React, kein `Date.now()`.
 */

/** Ein Knoten im Baum. `kinder` leer = Blatt. */
export interface Knoten {
  wert: string;
  label: string;
  kinder?: Knoten[];
}

/** Auswahl je Ebene, in derselben Reihenfolge wie die Ebenen des Baums. */
export type Auswahl = Record<string, string[]>;

/** Eine Ebene der Hierarchie: welcher URL-Parameter sie trägt. */
export interface Ebene {
  /** URL-Parameter dieser Ebene, z. B. `bundesland`. */
  param: string;
  label: string;
}

export type Zustand = "gewaehlt" | "teilweise" | "offen";

/** Ist dieser Knoten selbst gewählt (auf seiner eigenen Ebene)? */
function selbstGewaehlt(knoten: Knoten, tiefe: number, ebenen: Ebene[], auswahl: Auswahl) {
  const param = ebenen[tiefe]?.param;
  return !!param && (auswahl[param] ?? []).includes(knoten.wert);
}

/**
 * Zustand eines Knotens für die Anzeige:
 * - `gewaehlt` — er selbst ist gewählt, oder ein Elternteil ist es (dann
 *   gilt er implizit mit)
 * - `teilweise` — nur ein Teil seiner Nachfahren ist gewählt
 * - `offen` — nichts darunter gewählt
 *
 * Ein Knoten, von dem nur ein Teil der Kinder gewählt ist, zeigt
 * **Teilauswahl, nicht „gewählt"** — sonst behauptet die Anzeige mehr, als
 * der Filter tut.
 */
export function zustand(
  knoten: Knoten,
  tiefe: number,
  ebenen: Ebene[],
  auswahl: Auswahl,
  elternGewaehlt = false,
): Zustand {
  if (elternGewaehlt || selbstGewaehlt(knoten, tiefe, ebenen, auswahl)) return "gewaehlt";
  const kinder = knoten.kinder ?? [];
  if (kinder.length === 0) return "offen";
  const zustaende = kinder.map((k) => zustand(k, tiefe + 1, ebenen, auswahl));
  if (zustaende.every((z) => z === "gewaehlt")) return "teilweise";
  return zustaende.some((z) => z !== "offen") ? "teilweise" : "offen";
}

/**
 * Entfernt überflüssige Auswahlen: Ist ein Elternteil gewählt, sind seine
 * Nachfahren implizit mitgewählt — sie noch einmal aufzuführen verlängert
 * die Adresszeile, ohne etwas zu ändern, und würde beim nächsten neuen Kreis
 * falsch aussehen.
 */
export function normalisiere(baum: Knoten[], ebenen: Ebene[], auswahl: Auswahl): Auswahl {
  // Je Ebene sammeln, was durch einen gewaehlten Vorfahren implizit ist.
  const implizit: Record<string, Set<string>> = {};
  for (const e of ebenen) implizit[e.param] = new Set();

  /** Alle Nachfahren eines Knotens in `implizit` eintragen — er selbst nicht. */
  const nachfahren = (knoten: Knoten, tiefe: number) => {
    for (const kind of knoten.kinder ?? []) {
      const param = ebenen[tiefe + 1]?.param;
      if (param) implizit[param]!.add(kind.wert);
      nachfahren(kind, tiefe + 1);
    }
  };

  const lauf = (knoten: Knoten, tiefe: number) => {
    if (selbstGewaehlt(knoten, tiefe, ebenen, auswahl)) nachfahren(knoten, tiefe);
    for (const kind of knoten.kinder ?? []) lauf(kind, tiefe + 1);
  };
  for (const wurzel of baum) lauf(wurzel, 0);

  const neu: Auswahl = {};
  for (const e of ebenen) {
    neu[e.param] = (auswahl[e.param] ?? []).filter((w) => !implizit[e.param]!.has(w));
  }
  return neu;
}

/**
 * Auswahl nach einem Klick auf einen Knoten. Wird er gewählt, fallen seine
 * Nachfahren aus der Auswahl (sie sind implizit); wird er abgewählt, fällt
 * nur er selbst.
 */
export function schalte(
  baum: Knoten[],
  ebenen: Ebene[],
  auswahl: Auswahl,
  tiefe: number,
  wert: string,
): Auswahl {
  const param = ebenen[tiefe]?.param;
  if (!param) return auswahl;
  const bisher = auswahl[param] ?? [];
  const an = !bisher.includes(wert);

  const neu: Auswahl = {};
  for (const e of ebenen) neu[e.param] = [...(auswahl[e.param] ?? [])];
  neu[param] = an ? [...bisher, wert] : bisher.filter((w) => w !== wert);

  return an ? normalisiere(baum, ebenen, neu) : neu;
}

/** Leert alle Ebenen dieser Hierarchie — ein Zurücksetzen je Hierarchie. */
export function leere(ebenen: Ebene[]): Record<string, null> {
  return Object.fromEntries(ebenen.map((e) => [e.param, null]));
}

/**
 * Kurzfassung für den zusammengeklappten Filter: der erste gewählte Name,
 * dann wie viele weitere — „Baden-Württemberg, +2 Landkreise". Eine lange
 * Liste im Chip ist unlesbar und sagt weniger als die Zahl.
 */
export function kurzfassung(
  baum: Knoten[],
  ebenen: Ebene[],
  auswahl: Auswahl,
): string {
  const namen: { tiefe: number; label: string }[] = [];
  const lauf = (knoten: Knoten, tiefe: number) => {
    if (selbstGewaehlt(knoten, tiefe, ebenen, auswahl)) {
      namen.push({ tiefe, label: knoten.label });
    }
    for (const k of knoten.kinder ?? []) lauf(k, tiefe + 1);
  };
  for (const k of baum) lauf(k, 0);
  if (namen.length === 0) return "";

  const erster = namen[0]!;
  const rest = namen.slice(1);
  if (rest.length === 0) return erster.label;

  // Der Rest wird nach seiner Ebene benannt — „+2 Landkreise" sagt mehr als
  // „+2". Alle auf derselben Ebene: deren Name; gemischt: „Einträge".
  const tiefen = new Set(rest.map((n) => n.tiefe));
  const wort =
    tiefen.size === 1
      ? ebenen[[...tiefen][0]!]?.label ?? "Einträge"
      : "Einträge";
  return `${erster.label}, +${rest.length} ${rest.length === 1 ? einzahl(wort) : wort}`;
}

/** „Landkreise" → „Landkreis". Nur die Fälle, die im Modell vorkommen. */
function einzahl(mehrzahl: string): string {
  if (mehrzahl.endsWith("e")) return mehrzahl.slice(0, -1);
  return mehrzahl;
}

/**
 * Trifft ein Strom die Auswahl? Getroffen ist er, wenn er auf **einer** der
 * gewählten Ebenen passt — die Ebenen sind ODER-verknüpft, nicht UND. Leere
 * Auswahl heißt „alles".
 */
export function trifft(
  auswahl: Auswahl,
  ebenen: Ebene[],
  werteDesStroms: Record<string, string | null>,
): boolean {
  const gesetzt = ebenen.filter((e) => (auswahl[e.param] ?? []).length > 0);
  if (gesetzt.length === 0) return true;
  return gesetzt.some((e) => {
    const wert = werteDesStroms[e.param];
    return wert != null && (auswahl[e.param] ?? []).includes(wert);
  });
}
