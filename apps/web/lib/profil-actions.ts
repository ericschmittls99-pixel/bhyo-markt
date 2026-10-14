"use server";

import { benutzer } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getBelegeBucket, getEnvironment, withDb } from "@/lib/db";
import { profilbildKey, profilbildUrl, pruefeAnzeigename, pruefeProfilbild } from "@/lib/profil-bild";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";

/**
 * Eric 14.10.2026: Das Profilbild ist ein Personendatum — beim Entfernen und
 * beim Ersetzen wird die alte Datei SOFORT aus R2 geloescht, in derselben
 * Transaktion wie die Zeile. Schlaegt das Loeschen fehl, rollt die Zeile
 * zurueck und der Nutzer sieht einen Fehler statt einer herrenlosen Datei.
 */
class BildLoeschenFehlgeschlagen extends Error {}
const LOESCH_FEHLER = "Die alte Bilddatei konnte nicht gelöscht werden; nichts wurde geändert. Bitte noch einmal versuchen.";

async function loescheBild(bucket: { delete: (key: string) => Promise<void> }, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch (e) {
    throw new BildLoeschenFehlgeschlagen(e instanceof Error ? e.message : String(e));
  }
}

export interface ProfilErgebnis {
  ok: boolean;
  fehler?: string;
  /** Nach Setzen/Entfernen des Bildes: neue Bild-URL (null = Initialen). */
  bildUrl?: string | null;
}

/**
 * E77 R7: Das eigene Profil. Jede Rolle darf das — nur fuer sich selbst:
 * geschrieben wird ausschliesslich die Zeile des angemeldeten Nutzers (die
 * Aktion kennt keinen Parameter fuer eine fremde ID). Jede Aenderung landet
 * im Protokoll (Art geaendert, Entitaet benutzer), nie das Bild selbst.
 */
export async function anzeigenameSetzen(roh: string): Promise<ProfilErgebnis> {
  const wache = await rechtFuerAction("profil.bearbeiten");
  if ("fehler" in wache) return wache;
  const geprueft = pruefeAnzeigename(String(roh ?? ""));
  if ("fehler" in geprueft) return { ok: false, fehler: geprueft.fehler };
  const name = geprueft.wert;
  await withDb((db) =>
    db.transaction(async (tx) => {
      await tx.update(benutzer).set({ name, geaendertAm: new Date() }).where(eq(benutzer.id, wache.zugang.id));
      await protokolliere(tx, {
        art: "geaendert",
        entitaet: "benutzer",
        id: wache.zugang.id,
        benutzerId: wache.zugang.id,
        benutzerEmail: wache.email,
        text: name ? `Anzeigename auf „${name}“ gesetzt` : "Anzeigename entfernt",
      });
    }),
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Profilbild setzen: der Browser hat quadratisch auf 256 px verkleinert; hier
 * zaehlen nur die Bytes (Typ) und die Groesse (<= 1 MB). Das Objekt liegt im
 * Beleg-Bucket unter profil/<umgebung>/<benutzer.id>/ und wird ausschliesslich
 * ueber /api/profil/bild/<id> hinter der Wache ausgeliefert. Das alte Objekt
 * wird in der Transaktion der Zeile geloescht (kein Datensatz, nur die Datei).
 */
export async function profilBildSetzen(formData: FormData): Promise<ProfilErgebnis> {
  const wache = await rechtFuerAction("profil.bearbeiten");
  if ("fehler" in wache) return wache;
  const datei = formData.get("bild");
  if (!(datei instanceof File)) return { ok: false, fehler: "Keine Bilddatei übermittelt." };
  const bytes = new Uint8Array(await datei.arrayBuffer());
  const geprueft = pruefeProfilbild(bytes);
  if ("fehler" in geprueft) return { ok: false, fehler: geprueft.fehler };

  const env = await getEnvironment();
  const key = profilbildKey(env, wache.zugang.id, crypto.randomUUID(), geprueft.typ);
  const bucket = await getBelegeBucket();
  await bucket.put(key, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: geprueft.typ } });

  const jetzt = new Date();
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [vorher] = await tx.select({ bildKey: benutzer.bildKey }).from(benutzer).where(eq(benutzer.id, wache.zugang.id)).limit(1);
        await tx.update(benutzer).set({ bildKey: key, bildGeaendertAm: jetzt, geaendertAm: jetzt }).where(eq(benutzer.id, wache.zugang.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "benutzer",
          id: wache.zugang.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: vorher?.bildKey ? "Profilbild ersetzt" : "Profilbild gesetzt",
        });
        if (vorher?.bildKey && vorher.bildKey !== key) await loescheBild(bucket, vorher.bildKey);
      }),
    );
  } catch (e) {
    // Zeile nicht umgeschrieben (oder altes Objekt nicht loeschbar): das frische
    // Objekt darf nicht herrenlos liegen bleiben; das alte bleibt die gueltige Datei.
    await bucket.delete(key).catch(() => {});
    if (e instanceof BildLoeschenFehlgeschlagen) return { ok: false, fehler: LOESCH_FEHLER };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, bildUrl: profilbildUrl(wache.zugang.id, jetzt) };
}

/** Profilbild entfernen: zurueck zu den Initialen; die Datei wird in derselben Transaktion geloescht. */
export async function profilBildEntfernen(): Promise<ProfilErgebnis> {
  const wache = await rechtFuerAction("profil.bearbeiten");
  if ("fehler" in wache) return wache;
  const bucket = await getBelegeBucket();
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [vorher] = await tx.select({ bildKey: benutzer.bildKey }).from(benutzer).where(eq(benutzer.id, wache.zugang.id)).limit(1);
        if (!vorher?.bildKey) return;
        await tx.update(benutzer).set({ bildKey: null, bildGeaendertAm: null, geaendertAm: new Date() }).where(eq(benutzer.id, wache.zugang.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "benutzer",
          id: wache.zugang.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: "Profilbild entfernt",
        });
        await loescheBild(bucket, vorher.bildKey);
      }),
    );
  } catch (e) {
    if (e instanceof BildLoeschenFehlgeschlagen) return { ok: false, fehler: LOESCH_FEHLER };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, bildUrl: null };
}
