/**
 * Daten des Detail-Panels (components/stroeme/Detail) an EINER Stelle —
 * genutzt von ströme. (RegisterInhalt) und inbox. (AP2.2, „Öffnen" zeigt
 * dasselbe Panel, Rechte wie dort). Die Anreicherung (Verfügbarkeit,
 * Verifikation, Sperr-Rechte, Preiskorridor) steht hier, nicht doppelt.
 */
import { CLUSTER_LABEL } from "@/lib/farben";
import { heuteBerlin } from "@/lib/datum";
import { withDb } from "@/lib/db";
import { offeneAnfrageVon } from "@/lib/inbox/server";
import { preisKorridorEinzel, type PreisKorridorEinzel } from "@/lib/preiskorridor-einzel";
import { darf, type Zugang } from "@/lib/rechte";
import { ladeZuweisbare, sperrObjekt } from "@/lib/rechte/sperre-server";
import { ladeAlleVergaben, ladeErsteAenderung, ladeHistorie, ladeStroeme } from "@/lib/stroeme";
import type { SperrNutzer, Strom, StromArt } from "@/lib/stroeme-modell";
import { reichereVerfuegbarkeitAn, type VerfuegbarkeitsErgebnis, type VergabeDaten } from "@/lib/verfuegbarkeit";

export interface DetailDaten {
  strom: Strom;
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  /** E62: Pruefen und Ablauf-Markierung — aus derselben Matrix, nur zum Ausblenden. */
  sperrRechte: { bearbeiten: boolean; sperren: boolean; entsperren: boolean; zuweisen: boolean; anfragen: boolean; pruefen: boolean; abgelaufenMarkieren: boolean };
  /** PR c: laufende Zugriffsanfrage des Betrachtenden zu diesem Strom. */
  anfrage: { am: string } | null;
  zuweisbare: SperrNutzer[];
  vergaben: VergabeDaten[];
  verfuegbarkeit: VerfuegbarkeitsErgebnis | null;
  preisKorridor: PreisKorridorEinzel | null;
}

/** Die Begruendung des Anlegens ist der aelteste Log-Eintrag ("email: text"). */
export function begruendungAus(ersteAenderung: string | null): string | null {
  return ersteAenderung && ersteAenderung.includes(": ")
    ? ersteAenderung.slice(ersteAenderung.indexOf(": ") + 2)
    : null;
}

/** E44: Sperr-Rechte aus derselben Matrix wie die Wache — nur zum Ausblenden. */
export function sperrRechteFuer(zugang: Zugang, strom: Strom): DetailDaten["sperrRechte"] {
  const sperre = sperrObjekt(strom);
  return {
    bearbeiten: darf(zugang, "strom.bearbeiten", sperre),
    sperren: darf(zugang, "strom.sperren", sperre),
    entsperren: darf(zugang, "strom.entsperren", sperre),
    zuweisen: darf(zugang, "strom.zuweisen", sperre),
    anfragen: darf(zugang, "strom.zugriff_anfragen", sperre),
    pruefen: darf(zugang, "strom.pruefen", sperre),
    abgelaufenMarkieren: darf(zugang, "beleg.abgelaufen_markieren", sperre),
  };
}

/** Zusammenstellung aus bereits geladenen Teilen (RegisterInhalt hat den Pool schon). */
export async function detailDatenAus(
  strom: Strom,
  pool: Strom[],
  vergaben: VergabeDaten[],
  zugang: Zugang,
  historie: { zeitpunkt: string; text: string }[],
  ersteAenderung: string | null,
): Promise<DetailDaten> {
  const sperrRechte = sperrRechteFuer(zugang, strom);
  const zuweisbare = sperrRechte.zuweisen ? await withDb((db) => ladeZuweisbare(db)) : [];
  const anfrage =
    sperrRechte.anfragen && zugang.art === "erlaubt"
      ? await withDb((db) => offeneAnfrageVon(db, zugang.id, strom.art, strom.id))
      : null;
  return {
    strom,
    historie,
    begruendung: begruendungAus(ersteAenderung),
    sperrRechte,
    anfrage,
    zuweisbare,
    vergaben,
    verfuegbarkeit: strom.verfuegbarkeit ?? null,
    preisKorridor: preisKorridorEinzel(strom, pool, { cluster: CLUSTER_LABEL }),
  };
}

/** Alles laden: Pool der Art (fuer den Korridor), Vergaben, Historie — wie in ströme. */
export async function ladeDetailDaten(art: StromArt, id: string, zugang: Zugang): Promise<DetailDaten | null> {
  const [poolRoh, vergabenMap, historie, ersteAenderung] = await Promise.all([
    ladeStroeme(art),
    ladeAlleVergaben(art),
    ladeHistorie(art, id),
    ladeErsteAenderung(art, id),
  ]);
  const stichtag = heuteBerlin();
  const pool = reichereVerfuegbarkeitAn(poolRoh, vergabenMap, stichtag);
  const strom = pool.find((s) => s.id === id);
  if (!strom) return null;
  return detailDatenAus(strom, pool, vergabenMap.get(id) ?? [], zugang, historie, ersteAenderung);
}
