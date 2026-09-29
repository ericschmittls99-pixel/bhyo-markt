/**
 * Daten des Detail-Panels (components/stroeme/Detail) an EINER Stelle —
 * genutzt von ströme. (RegisterInhalt) und inbox. (AP2.2, „Öffnen" zeigt
 * dasselbe Panel, Rechte wie dort). Die Anreicherung (Verfügbarkeit,
 * Verifikation, Sperr-Rechte, Preiskorridor) steht hier, nicht doppelt.
 */
import { CLUSTER_LABEL } from "@/lib/farben";
import { withDb } from "@/lib/db";
import { preisKorridorEinzel, type PreisKorridorEinzel } from "@/lib/preiskorridor-einzel";
import { darf, type Zugang } from "@/lib/rechte";
import { ladeZuweisbare, sperrObjekt } from "@/lib/rechte/sperre-server";
import { ladeAlleVergaben, ladeErsteAenderung, ladeHistorie, ladeStroeme } from "@/lib/stroeme";
import type { SperrNutzer, Strom, StromArt } from "@/lib/stroeme-modell";
import { reichereVerfuegbarkeitAn, type VerfuegbarkeitsErgebnis, type VergabeDaten } from "@/lib/verfuegbarkeit";
import { reichereVerifikationAn, verifikationsFaelligkeit } from "@/lib/verifizierung";

export interface DetailDaten {
  strom: Strom;
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  verifizierung: string | null;
  sperrRechte: { bearbeiten: boolean; sperren: boolean; entsperren: boolean; zuweisen: boolean };
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
  return {
    strom,
    historie,
    begruendung: begruendungAus(ersteAenderung),
    verifizierung: verifikationsFaelligkeit(strom.beleg, strom, vergaben),
    sperrRechte,
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
  const stichtag = new Date().toISOString().slice(0, 10);
  const pool = reichereVerifikationAn(reichereVerfuegbarkeitAn(poolRoh, vergabenMap, stichtag), vergabenMap, stichtag);
  const strom = pool.find((s) => s.id === id);
  if (!strom) return null;
  return detailDatenAus(strom, pool, vergabenMap.get(id) ?? [], zugang, historie, ersteAenderung);
}
