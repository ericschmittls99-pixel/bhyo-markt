import { akteurNameNorm } from "@/lib/akteur-norm";

/**
 * AP2.7 PR b (E67): Akteure werden je eindeutigem Akteur aufgeloest, nicht
 * je Zeile — auch innerhalb des Laufs. Schluessel ist Normname + PLZ (wie
 * die Klasse „identisch" des Matchers). Reine Regeln; die Datenbank-Seite
 * (sucheAehnliche, Zeilen-Update) sitzt in import-actions.ts.
 *
 * Ergebnis je Zeile in import_zeile.felder (keine neue Spalte):
 *   akteur_gruppe        Schluessel der Gruppe
 *   akteur_id            vorhandener Akteur (identisch oder bestaetigt)
 *   akteur_vorschlag_id/_name/_grad  starker Treffer, der auf Bestaetigung wartet (Zeile „aehnlich")
 *   akteur_neu = "1"     wird beim Ausfuehren neu angelegt (Sitz aus den akteur_sitz_*-Feldern)
 */
export interface ZeileFuerAkteur {
  id: string;
  status: string;
  felder: Record<string, string>;
}

export interface AkteurGruppe {
  schluessel: string;
  name: string;
  plz: string;
  ort: string;
  zeilenIds: string[];
}

export function gruppenSchluessel(name: string, plz: string): string {
  return `${akteurNameNorm(name)}|${plz.trim()}`;
}

/** Zeilen mit Akteur-Name → Gruppen (Reihenfolge des ersten Auftretens). */
export function akteurGruppen(zeilen: readonly ZeileFuerAkteur[]): AkteurGruppe[] {
  const gruppen = new Map<string, AkteurGruppe>();
  for (const z of zeilen) {
    const name = (z.felder.akteur_name ?? "").trim();
    if (!name) continue;
    const plz = (z.felder.akteur_sitz_plz ?? "").trim();
    const schluessel = gruppenSchluessel(name, plz);
    const g = gruppen.get(schluessel);
    if (g) g.zeilenIds.push(z.id);
    else gruppen.set(schluessel, { schluessel, name, plz, ort: (z.felder.akteur_sitz_ort ?? "").trim(), zeilenIds: [z.id] });
  }
  return [...gruppen.values()];
}

export type GruppenErgebnis = "identisch" | "vorschlag" | "neu" | "offen";

export interface AkteurGruppeAnzeige extends AkteurGruppe {
  ergebnis: GruppenErgebnis;
  akteurId: string | null;
  vorschlagId: string | null;
  vorschlagName: string | null;
}

/** Gruppen mit dem Stand aus den Feldern — fuer die Seite nach dem Aufloesen. */
export function akteurGruppenAnzeige(zeilen: readonly ZeileFuerAkteur[]): AkteurGruppeAnzeige[] {
  const nachId = new Map(zeilen.map((z) => [z.id, z]));
  return akteurGruppen(zeilen).map((g) => {
    const f = nachId.get(g.zeilenIds[0]!)!.felder;
    const ergebnis: GruppenErgebnis = f.akteur_id ? "identisch" : f.akteur_vorschlag_id ? "vorschlag" : f.akteur_neu === "1" ? "neu" : "offen";
    return { ...g, ergebnis, akteurId: f.akteur_id ?? null, vorschlagId: f.akteur_vorschlag_id ?? null, vorschlagName: f.akteur_vorschlag_name ?? null };
  });
}

export interface TrefferFuerImport {
  id: string;
  name: string;
  grad: "identisch" | "stark" | "schwach";
}

/**
 * Entscheidung aus dem obersten Treffer (E67): identisch → uebernehmen;
 * stark → Vorschlag, der bestaetigt wird; schwach oder nichts → neuer Akteur.
 * Liefert den Feld-Patch der Gruppe und den Zeilenstatus fuer bisher offene Zeilen.
 */
export function entscheidungAusTreffer(schluessel: string, treffer: readonly TrefferFuerImport[]): { patch: Record<string, string>; ergebnis: Exclude<GruppenErgebnis, "offen">; statusOffen: "offen" | "aehnlich" } {
  const top = treffer[0];
  if (top?.grad === "identisch") return { patch: { akteur_gruppe: schluessel, akteur_id: top.id }, ergebnis: "identisch", statusOffen: "offen" };
  if (top?.grad === "stark") {
    return { patch: { akteur_gruppe: schluessel, akteur_vorschlag_id: top.id, akteur_vorschlag_name: top.name, akteur_vorschlag_grad: "stark" }, ergebnis: "vorschlag", statusOffen: "aehnlich" };
  }
  return { patch: { akteur_gruppe: schluessel, akteur_neu: "1" }, ergebnis: "neu", statusOffen: "offen" };
}
