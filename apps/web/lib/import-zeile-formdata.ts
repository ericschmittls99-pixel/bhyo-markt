/**
 * AP2.7/E75: Formulardaten einer Import-Zeile — eine reine Funktion ausserhalb
 * der Server-Actions-Datei, weil eine "use server"-Datei nur async-Exporte
 * vertraegt (Turbopack-Build: „Server Actions must be async functions").
 * Ohne eigenen Zeitraum gilt der des Laufs; E75: „unbefristet" in der Zelle
 * oder als Lauf-Standard wird zum Kaestchen, eine leere Zelle bleibt
 * Lauf-Zeitraum.
 */
import { UNBEFRISTET, zielfeld } from "@/lib/import-zuordnung";
import { monatAusDatum } from "@/lib/import-zeitraum";

export function formDataAusZeile(felder: Record<string, string>, akteurId: string, lauf?: { zeitraumVon: string | null; zeitraumBis: string | null; zeitraumUnbefristet?: boolean; preisBezugStandard?: string }): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) {
    const def = zielfeld(k);
    if (def && def.gruppe === "strom") fd.set(k, v);
  }
  // E69: ohne eigene Spalte gilt der Preis-Bezug des Laufs — nur wenn ein Preis da ist.
  if ((felder.preis_min || felder.preis_mittel || felder.preis_max) && !felder.preis_bezug) fd.set("preis_bezug", lauf?.preisBezugStandard ?? "fm");
  // PR e: ohne eigenen Zeitraum gilt der des Laufs (Pflicht am Lauf, geprueft in importBelegDatenSetzen).
  if (!felder.zeitraum_von && lauf?.zeitraumVon) fd.set("zeitraum_von", monatAusDatum(lauf.zeitraumVon));
  // E75: „unbefristet" in der Zelle oder als Lauf-Standard wird zum Kaestchen; eine leere Zelle bleibt Lauf-Zeitraum.
  if (felder.zeitraum_bis === UNBEFRISTET) {
    fd.delete("zeitraum_bis");
    fd.set("unbefristet", "on");
  } else if (!felder.zeitraum_bis) {
    if (lauf?.zeitraumBis) fd.set("zeitraum_bis", monatAusDatum(lauf.zeitraumBis));
    else if (lauf?.zeitraumUnbefristet) fd.set("unbefristet", "on");
  }
  fd.set("akteur_id", akteurId);
  return fd;
}
