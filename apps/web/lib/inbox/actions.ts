"use server";

import { benutzer, inboxEintrag } from "@bhyo/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { protokolliere } from "@/lib/protokoll";
import { darfZugewiesenWerden, type Zugang } from "@/lib/rechte";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

import { pruefeAufgabe } from "./aufgabe";
import { INBOX_TYPEN, type InboxTyp } from "./register";
import { pruefeInboxEmpfaenger } from "./server";

/**
 * AP2.2: Zustand der eigenen Inbox-Eintraege. Kein fachliches Ereignis —
 * diese Aktionen protokollieren nicht (benannte Ausnahme in
 * scripts/protokoll-check.ts). Jede Aktion geht durch die Wache (Rollenstufe)
 * und prueft in der Transaktion die Objektstufe: nur der Empfaenger.
 */
function fehler(e: unknown): AktionErgebnis {
  return { ok: false, fehler: e instanceof Error ? e.message : "Aktion fehlgeschlagen." };
}

function aktualisiere() {
  revalidatePath("/inbox");
  // Zaehler-Badge in der Navigation (Layout).
  revalidatePath("/", "layout");
}

export async function inboxGelesen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("inbox.gelesen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const e = await pruefeInboxEmpfaenger(tx, wache.zugang, "inbox.gelesen", id);
        if (!e.gelesen) await tx.update(inboxEintrag).set({ gelesenAm: new Date() }).where(eq(inboxEintrag.id, e.id));
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  aktualisiere();
  return { ok: true };
}

export async function inboxUngelesen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("inbox.ungelesen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const e = await pruefeInboxEmpfaenger(tx, wache.zugang, "inbox.ungelesen", id);
        await tx.update(inboxEintrag).set({ gelesenAm: null }).where(eq(inboxEintrag.id, e.id));
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  aktualisiere();
  return { ok: true };
}

/**
 * Gemeinsamer Rumpf fuer Erledigen und Verwerfen. Die Wache sitzt am Eingang
 * der exportierten Aktion (Literal, sichtbar fuer rechte-check), hier kommt
 * der geprueffte Zugang herein; die Objektstufe prueft dieser Rumpf.
 */
async function setzeZustand(
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  aktion: "inbox.erledigen" | "inbox.verwerfen",
  id: string,
  zustand: "erledigt" | "verworfen",
): Promise<AktionErgebnis> {
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const e = await pruefeInboxEmpfaenger(tx, zugang, aktion, id);
        if (e.zustand !== "offen") throw new Error("Der Eintrag ist nicht mehr offen.");
        const jetzt = new Date();
        await tx
          .update(inboxEintrag)
          .set({ zustand, zustandSeit: jetzt, gelesenAm: e.gelesen ? undefined : jetzt })
          .where(and(eq(inboxEintrag.id, e.id), eq(inboxEintrag.zustand, "offen")));
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  aktualisiere();
  return { ok: true };
}

export async function inboxErledigen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("inbox.erledigen");
  if ("fehler" in wache) return wache;
  return setzeZustand(wache.zugang, "inbox.erledigen", id, "erledigt");
}

export async function inboxVerwerfen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("inbox.verwerfen");
  if ("fehler" in wache) return wache;
  return setzeZustand(wache.zugang, "inbox.verwerfen", id, "verworfen");
}

/** „Alle erledigt": nur reine Hinweise, nur eigene, nur offene. */
export async function inboxAlleErledigen(): Promise<AktionErgebnis & { anzahl?: number }> {
  const wache = await rechtFuerAction("inbox.alle_erledigen");
  if ("fehler" in wache) return wache;
  const hinweisTypen = (Object.keys(INBOX_TYPEN) as InboxTyp[]).filter((t) => INBOX_TYPEN[t].reinerHinweis);
  let anzahl = 0;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const jetzt = new Date();
        const geaendert = await tx
          .update(inboxEintrag)
          .set({ zustand: "erledigt", zustandSeit: jetzt })
          .where(
            and(
              eq(inboxEintrag.empfaengerId, wache.zugang.id),
              eq(inboxEintrag.zustand, "offen"),
              inArray(inboxEintrag.typ, hinweisTypen),
            ),
          )
          .returning({ id: inboxEintrag.id });
        anzahl = geaendert.length;
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  aktualisiere();
  return { ok: true, anzahl };
}

/**
 * PR c: Zugriffsanfrage ablehnen — nur der Empfaenger, nur offene Anfragen.
 * Das Ereignis zugriff_abgelehnt (Protokoll, Objektbezug Strom) stellt die
 * Antwort an den Anfragenden zu und raeumt die Anfrage bei ALLEN Empfaengern
 * ab (lib/inbox/zustellung.ts). Das ist ein fachliches Ereignis und wird
 * deshalb protokolliert — anders als der Lese-/Erledigt-Zustand.
 */
export async function inboxAblehnen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("inbox.ablehnen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const e = await pruefeInboxEmpfaenger(tx, wache.zugang, "inbox.ablehnen", id);
        if (e.typ !== "zugriffsanfrage") throw new Error("Nur eine Zugriffsanfrage lässt sich ablehnen.");
        if (e.zustand !== "offen") throw new Error("Die Anfrage ist nicht mehr offen.");
        if (!e.ausloeserId) throw new Error("Die Anfrage hat keinen Urheber.");
        if (!e.strom) throw new Error("Die Anfrage hat keinen Strom.");
        await protokolliere(tx, {
          art: "zugriff_abgelehnt",
          entitaet: e.strom.art === "biomasse" ? "biomassestrom" : "output_bedarf",
          id: e.strom.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          betrifftId: e.ausloeserId,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  aktualisiere();
  return { ok: true };
}

/** PR c (D5): Eintraege, die sich als Aufgabe weitergeben lassen. */
const WEITERGEBBAR: readonly InboxTyp[] = ["pruefauftrag", "verifikation_laeuft_ab", "verifikation_abgelaufen"];

/**
 * AP2.4 PR c (E63, D5): Weitergeben — der Empfaenger eines Pruefauftrags oder
 * Ablauf-Hinweises gibt ihn als Aufgabe an eine Person weiter (aktiv, Rolle
 * >= bearbeiter, nie an sich selbst). Der eigene Eintrag ist damit erledigt;
 * das Ereignis weitergegeben (Protokoll, Objektbezug Strom, betroffene
 * Person, Aufgabentext) stellt die Aufgabe in derselben Transaktion zu.
 */
export async function inboxWeitergeben(id: string, empfaengerId: string, aufgabeEingabe: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("inbox.weitergeben");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const e = await pruefeInboxEmpfaenger(tx, wache.zugang, "inbox.weitergeben", id);
        if (!WEITERGEBBAR.includes(e.typ) || !e.strom) throw new Error("Dieser Eintrag lässt sich nicht weitergeben.");
        if (e.zustand !== "offen") throw new Error("Der Eintrag ist nicht mehr offen.");
        // Dieselbe Regel wie der DB-CHECK (nicht leer, max. 500) — hier mit Meldung, dort als letzte Grenze.
        const text = pruefeAufgabe(aufgabeEingabe);
        if (!text.ok) throw new Error(text.fehler);
        const aufgabe = text.text;
        if (empfaengerId === wache.zugang.id) throw new Error("Weitergeben an dich selbst ist nicht möglich.");
        const [ziel] = await tx
          .select({ id: benutzer.id, name: benutzer.name, email: benutzer.email, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
          .from(benutzer)
          .where(eq(benutzer.id, empfaengerId))
          .limit(1);
        if (!darfZugewiesenWerden(ziel)) throw new Error("Diese Person kann keine Aufgabe übernehmen (nicht aktiv oder nur Betrachter).");
        // E65 (Eric 04.10.2026): Der eigene Eintrag bleibt OFFEN, bis die Sache selbst
        // erledigt ist (geprueft/reverifiziert/verworfen raeumen Hinweis und Aufgabe bei
        // allen ab, zustellung.ts). Verwirft der Empfaenger die Aufgabe, bleibt der
        // Absender-Eintrag offen. Weitergeben gilt nur als gelesen.
        if (!e.gelesen) {
          await tx.update(inboxEintrag).set({ gelesenAm: new Date() }).where(and(eq(inboxEintrag.id, e.id), eq(inboxEintrag.zustand, "offen")));
        }
        await protokolliere(tx, {
          art: "weitergegeben",
          entitaet: e.strom.art === "biomasse" ? "biomassestrom" : "output_bedarf",
          id: e.strom.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          betrifftId: ziel!.id,
          text: `Weitergegeben an ${ziel!.name ?? ziel!.email}: ${aufgabe}`,
          aufgabe,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  aktualisiere();
  return { ok: true };
}
