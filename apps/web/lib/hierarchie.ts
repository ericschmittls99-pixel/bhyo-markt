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
 * **Gespeichert wird die höchste Ebene, die VOLLSTÄNDIG gewählt ist**
 * (Präzisierung Eric, 25.09.2026). Wer Baden-Württemberg wählt, bekommt
 * `bundesland=08`, nicht alle Kreisschlüssel — das hält die Adresszeile kurz
 * und bleibt richtig, wenn später ein Kreis dazukommt.
 *
 * Wählt jemand darunter einen Kreis ab, ist das Bundesland nicht mehr
 * vollständig: Es wird **automatisch in seine übrigen Kinder aufgelöst**
 * (`landkreis=08226`). Die Adresszeile wird in diesem Fall länger, das Modell
 * bleibt aber ohne Zustand, der sich nicht schreiben lässt. Werden später
 * wieder alle Kinder gewählt, fasst die Normalisierung sie erneut zum
 * Elternteil zusammen.
 *
 * **Eine aufgelöste Auswahl ist eine Momentaufnahme.** Kommt später ein Kreis
 * dazu, ist er nicht enthalten — bei einer Ausschluss-Auswahl ist genau das
 * richtig.
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
 * Bringt eine Auswahl auf ihre kanonische Form: **die höchsten vollständig
 * gewählten Knoten.**
 *
 * Von unten nach oben: Ein Blatt ist vollständig, wenn es gewählt ist; ein
 * innerer Knoten, wenn er selbst gewählt ist **oder** alle seine Kinder
 * vollständig sind. Gespeichert wird dann jeder vollständige Knoten, dessen
 * Elternteil es nicht ist.
 *
 * Damit fällt beides zusammen: Überflüssige Nachfahren eines gewählten
 * Elternteils verschwinden, und vollständig gewählte Geschwister werden zum
 * Elternteil zusammengefasst.
 */
export function normalisiere(baum: Knoten[], ebenen: Ebene[], auswahl: Auswahl): Auswahl {
  const neu: Auswahl = {};
  for (const e of ebenen) neu[e.param] = [];

  /** Ist dieser Teilbaum vollständig gewählt? */
  const vollstaendig = (knoten: Knoten, tiefe: number): boolean => {
    if (selbstGewaehlt(knoten, tiefe, ebenen, auswahl)) return true;
    const kinder = knoten.kinder ?? [];
    if (kinder.length === 0) return false;
    return kinder.every((k) => vollstaendig(k, tiefe + 1));
  };

  /** Den höchsten vollständigen Knoten je Ast eintragen. */
  const lauf = (knoten: Knoten, tiefe: number) => {
    if (vollstaendig(knoten, tiefe)) {
      const param = ebenen[tiefe]?.param;
      if (param) neu[param]!.push(knoten.wert);
      return; // Nachfahren sind implizit
    }
    for (const kind of knoten.kinder ?? []) lauf(kind, tiefe + 1);
  };
  for (const wurzel of baum) lauf(wurzel, 0);

  return neu;
}

/**
 * Löst gewählte Vorfahren eines Knotens in ihre Kinder auf, damit der Knoten
 * danach einzeln abwählbar ist. Ohne das müsste, wer „BW außer einem Kreis"
 * will, das Bundesland abwählen und alle übrigen Kreise einzeln anklicken —
 * dieselbe Auswahl, nur mühsam.
 */
function loeseVorfahrenAuf(
  baum: Knoten[],
  ebenen: Ebene[],
  auswahl: Auswahl,
  tiefe: number,
  wert: string,
): Auswahl {
  const pfad = findePfad(baum, 0, tiefe, wert);
  if (!pfad) return auswahl;

  const neu: Auswahl = {};
  for (const e of ebenen) neu[e.param] = [...(auswahl[e.param] ?? [])];

  // Von oben nach unten: Jeden gewählten Vorfahren durch seine Kinder
  // ersetzen, bis der Knoten selbst auf seiner Ebene explizit dasteht.
  for (let t = 0; t < tiefe; t++) {
    const knoten = pfad[t]!;
    const param = ebenen[t]!.param;
    if (!neu[param]!.includes(knoten.wert)) continue;
    neu[param] = neu[param]!.filter((w) => w !== knoten.wert);
    const kindParam = ebenen[t + 1]?.param;
    if (kindParam) {
      for (const kind of knoten.kinder ?? []) {
        if (!neu[kindParam]!.includes(kind.wert)) neu[kindParam]!.push(kind.wert);
      }
    }
  }
  return neu;
}

/** Kette der Knoten von der Wurzel bis zum gesuchten Knoten, oder null. */
function findePfad(
  knoten: Knoten[],
  tiefe: number,
  zielTiefe: number,
  wert: string,
): Knoten[] | null {
  for (const k of knoten) {
    if (tiefe === zielTiefe && k.wert === wert) return [k];
    const unten = findePfad(k.kinder ?? [], tiefe + 1, zielTiefe, wert);
    if (unten) return [k, ...unten];
  }
  return null;
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

  // Effektiv gewaehlt heisst: selbst gewaehlt ODER durch einen Vorfahren
  // mitgewaehlt. Beides muss sich mit einem Klick zuruecknehmen lassen.
  const pfad = findePfad(baum, 0, tiefe, wert);
  const effektivGewaehlt =
    (auswahl[param] ?? []).includes(wert) ||
    (pfad ?? []).some((k, t) => t < tiefe && (auswahl[ebenen[t]!.param] ?? []).includes(k.wert));

  if (!effektivGewaehlt) {
    const neu: Auswahl = {};
    for (const e of ebenen) neu[e.param] = [...(auswahl[e.param] ?? [])];
    neu[param] = [...(neu[param] ?? []), wert];
    return normalisiere(baum, ebenen, neu);
  }

  // Abwaehlen: erst die gewaehlten Vorfahren aufloesen, dann den Knoten
  // entfernen, dann neu zusammenfassen, was vollstaendig geblieben ist.
  const aufgeloest = loeseVorfahrenAuf(baum, ebenen, auswahl, tiefe, wert);
  aufgeloest[param] = (aufgeloest[param] ?? []).filter((w) => w !== wert);
  return normalisiere(baum, ebenen, aufgeloest);
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
