"use server";

import { benutzer, biomassestrom, outputBedarf, stromZuweisung } from "@bhyo/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { darfZugewiesenWerden } from "@/lib/rechte";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { protokolliere } from "@/lib/protokoll";
import {
  Gesperrt,
  loescheZuweisungen,
  pruefeStromSperre,
  type StromArt,
} from "@/lib/rechte/sperre-server";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * E44 (AP2.1 PR b): Sperren, Entsperren, Zuweisen. Jede Aktion: Rollenstufe
 * am Eingang (Wache), Objektstufe IN der Transaktion (Zeilensperre, Matrix),
 * bedingtes UPDATE — Sperren greift nur, wenn die Zeile noch frei ist,
 * Entsperren nur, wenn sie noch vom erwarteten Inhaber gehalten wird. Kein
 * stilles Gewinnen bei gleichzeitigem Zugriff. Jede Wirkung steht im
 * Aenderungsprotokoll.
 */
function tabelle(art: StromArt) {
  return art === "biomasse" ? biomassestrom : outputBedarf;
}
function entitaetTyp(art: StromArt) {
  return art === "biomasse" ? "biomassestrom" : "output_bedarf";
}
function fehler(e: unknown): AktionErgebnis {
  return { ok: false, fehler: e instanceof Error ? e.message : "Aktion fehlgeschlagen." };
}

export async function stromSperren(art: StromArt, id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.sperren");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await pruefeStromSperre(tx, wache.zugang, "strom.sperren", art, id);
        const t = tabelle(art);
        const geaendert = await tx
          .update(t)
          .set({ gesperrtVon: wache.zugang.id, gesperrtAm: new Date() })
          .where(and(eq(t.id, id), isNull(t.gesperrtVon)))
          .returning({ id: t.id });
        if (!geaendert.length) throw new Error("Der Strom wurde zwischenzeitlich gesperrt — bitte neu laden.");
        await protokolliere(tx, { art: "gesperrt", entitaet: entitaetTyp(art), id, benutzerId: wache.zugang.id, benutzerEmail: wache.email });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/register");
  return { ok: true };
}

export async function stromEntsperren(art: StromArt, id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.entsperren");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const zustand = await pruefeStromSperre(tx, wache.zugang, "strom.entsperren", art, id);
        const t = tabelle(art);
        const geaendert = await tx
          .update(t)
          .set({ gesperrtVon: null, gesperrtAm: null })
          .where(and(eq(t.id, id), eq(t.gesperrtVon, zustand.gesperrtVon!)))
          .returning({ id: t.id });
        if (!geaendert.length) throw new Error("Die Sperre wurde zwischenzeitlich geändert — bitte neu laden.");
        // E44: Entsperren entfernt die Zuweisungen.
        await loescheZuweisungen(tx, art, id);
        await protokolliere(tx, { art: "entsperrt", entitaet: entitaetTyp(art), id, benutzerId: wache.zugang.id, benutzerEmail: wache.email });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/register");
  return { ok: true };
}

export async function stromZuweisen(art: StromArt, id: string, nutzerId: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.zuweisen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await pruefeStromSperre(tx, wache.zugang, "strom.zuweisen", art, id);
        // E44: Zuweisen nur an aktive Nutzer mit Rolle >= bearbeiter — Pruefung am Eingang.
        const [ziel] = await tx
          .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv, name: benutzer.name, email: benutzer.email })
          .from(benutzer)
          .where(eq(benutzer.id, nutzerId))
          .limit(1);
        if (!ziel) throw new Error("Diese Person ist nicht eingetragen.");
        if (!darfZugewiesenWerden(ziel)) throw new Error("Zuweisen geht nur an aktive Nutzer mit mindestens Bearbeiter-Rolle.");
        // Der Teil-Unique-Index ist die Wahrheit: ON CONFLICT DO NOTHING fügt
        // bei bestehender Zuweisung 0 Zeilen ein. Das ist kein Erfolg und
        // bekommt kein „zugewiesen"-Protokoll (Rückfrage Eric, 29.09.2026).
        const neu = await tx
          .insert(stromZuweisung)
          .values({
            biomassestromId: art === "biomasse" ? id : null,
            outputBedarfId: art === "biomasse" ? null : id,
            nutzerId,
            zugewiesenVon: wache.zugang.id,
          })
          .onConflictDoNothing()
          .returning({ id: stromZuweisung.id });
        if (!neu.length) throw new Error(`${ziel.name ?? ziel.email} ist bereits zugewiesen.`);
        // PR c: betrifftId => Freischaltung an den Zugewiesenen, offene Anfragen dieser Person werden abgeraeumt.
        await protokolliere(tx, { art: "zugewiesen", entitaet: entitaetTyp(art), id, benutzerId: wache.zugang.id, benutzerEmail: wache.email, text: `${ziel.name ?? ziel.email} zugewiesen`, betrifftId: nutzerId });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/register");
  return { ok: true };
}

export async function zuweisungEntfernen(art: StromArt, id: string, nutzerId: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.zuweisung_entfernen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await pruefeStromSperre(tx, wache.zugang, "strom.zuweisung_entfernen", art, id);
        const spalte = art === "biomasse" ? stromZuweisung.biomassestromId : stromZuweisung.outputBedarfId;
        await tx.delete(stromZuweisung).where(and(eq(spalte, id), eq(stromZuweisung.nutzerId, nutzerId)));
        await protokolliere(tx, { art: "zuweisung_entfernt", entitaet: entitaetTyp(art), id, benutzerId: wache.zugang.id, benutzerEmail: wache.email });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/register");
  return { ok: true };
}

export { Gesperrt };

/** PR c: Laenge der optionalen Notiz einer Zugriffsanfrage. */
export const NOTIZ_MAX = 500;

/**
 * PR c: Zugriff auf einen gesperrten Strom anfragen — Rolle >= bearbeiter,
 * Strom gesperrt, weder Inhaber noch zugewiesen (Objektregel). Das Ereignis
 * zugriff_angefragt stellt die Anfrage an den Sperrinhaber zu (Register);
 * eine zweite Anfrage derselben Person buendelt die DB.
 */
export async function zugriffAnfragen(art: StromArt, id: string, notiz?: string | null): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.zugriff_anfragen");
  if ("fehler" in wache) return wache;
  const text = (notiz ?? "").trim();
  if (text.length > NOTIZ_MAX) return { ok: false, fehler: `Die Notiz darf höchstens ${NOTIZ_MAX} Zeichen lang sein.` };
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await pruefeStromSperre(tx, wache.zugang, "strom.zugriff_anfragen", art, id);
        await protokolliere(tx, {
          art: "zugriff_angefragt",
          entitaet: entitaetTyp(art),
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: text || undefined,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/register");
  revalidatePath("/inbox");
  return { ok: true };
}
