/**
 * Abfragen der Inbox (Zaehler, Liste) und die Objektstufe der Wache:
 * Eintraege liest und aendert nur der Empfaenger (Matrix: nurEmpfaenger).
 */
import { akteur, benutzer, biomassestrom, inboxEintrag, kontaktperson, outputBedarf, importLauf } from "@bhyo/db/schema";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { type Aktion, darf } from "@/lib/rechte";
import type { Zugang } from "@/lib/rechte";
import type { Tx } from "@/lib/rechte/sperre-server";
import type { StromArt } from "@/lib/stroeme-modell";

import { type InboxTyp, zeilenText } from "./register";

export type Leser = Pick<AppDb, "select">;

export interface InboxZeile {
  id: string;
  typ: InboxTyp;
  zustand: "offen" | "erledigt" | "verworfen";
  anzahl: number;
  gelesen: boolean;
  /** ISO-Zeitpunkt der letzten Aenderung des Buendels. */
  aktualisiertAm: string;
  zustandSeit: string;
  /** null bei den Hinweisen des Jobs (PR b). */
  ausloeser: { id: string; name: string | null; email: string } | null;
  /** null beim Objektbezug Akteur (akteur_verwaist, AP2.5). */
  strom: { art: StromArt; id: string } | null;
  /** AP2.5: Objektbezug Akteur. */
  akteur: { id: string; name: string } | null;
  /** AP2.5 PR b: Objektbezug Kontaktperson (Name erst hier aufgeloest, E57). */
  kontaktperson: { id: string; name: string; akteurId: string } | null;
  /** AP2.7 PR c (E67): Objektbezug Import-Lauf beim Typ import_abgeschlossen. */
  importLauf?: { id: string; dateiname: string } | null;
  /** PR b: Bezugsdatum eines Job-Hinweises (verifiziert_bis). */
  bezugsdatum: string | null;
  /** PR c: Aufgabentext beim Typ aufgabe. */
  aufgabe: string | null;
  belegNr: string | null;
  bezeichnung: string | null;
  /** PR c: Notiz der Zugriffsanfrage. */
  notiz: string | null;
  /** Fertiger Zeilentext aus dem Register. */
  text: string;
}

/** Ungelesene offene Eintraege — der Zaehler der Navigation. */
export async function zaehleUngelesen(db: Leser, nutzerId: string): Promise<number> {
  const [z] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxEintrag)
    .where(and(eq(inboxEintrag.empfaengerId, nutzerId), eq(inboxEintrag.zustand, "offen"), isNull(inboxEintrag.gelesenAm)));
  return z?.n ?? 0;
}

/** Liste des Empfaengers: „offen" oder „erledigt" (dort auch Verworfene, gekennzeichnet). */
export async function ladeEintraege(db: Leser, nutzerId: string, sicht: "offen" | "erledigt"): Promise<InboxZeile[]> {
  const zeilen = await db
    .select({
      id: inboxEintrag.id,
      typ: inboxEintrag.typ,
      zustand: inboxEintrag.zustand,
      anzahl: inboxEintrag.anzahl,
      gelesenAm: inboxEintrag.gelesenAm,
      aktualisiertAm: inboxEintrag.aktualisiertAm,
      zustandSeit: inboxEintrag.zustandSeit,
      notiz: inboxEintrag.notiz,
      bezugsdatum: inboxEintrag.bezugsdatum,
      aufgabe: inboxEintrag.aufgabe,
      biomassestromId: inboxEintrag.biomassestromId,
      outputBedarfId: inboxEintrag.outputBedarfId,
      akteurId: inboxEintrag.akteurId,
      hinweisAkteurName: sql<string | null>`coalesce(${akteur.name}, (select a2.name from akteur a2 where a2.id = ${kontaktperson.akteurId}))`,
      kontaktpersonId: inboxEintrag.kontaktpersonId,
      kontaktpersonName: kontaktperson.name,
      kontaktpersonAkteurId: kontaktperson.akteurId,
      importLaufId: inboxEintrag.importLaufId,
      importDateiname: importLauf.dateiname,
      importZaehler: importLauf.zaehler,
      ausloeserId: benutzer.id,
      ausloeserName: benutzer.name,
      ausloeserEmail: benutzer.email,
      bezeichnung: sql<string | null>`coalesce(${biomassestrom.bezeichnung}, ${outputBedarf.bezeichnung})`,
      belegNr: sql<string | null>`(select b.beleg_nr from beleg b where b.id = coalesce(${biomassestrom.belegId}, ${outputBedarf.belegId}))`,
      akteurName: sql<string | null>`(select a.name from akteur a where a.id = coalesce(${biomassestrom.akteurId}, ${outputBedarf.akteurId}))`,
    })
    .from(inboxEintrag)
    .leftJoin(benutzer, eq(benutzer.id, inboxEintrag.ausloeserId))
    .leftJoin(biomassestrom, eq(biomassestrom.id, inboxEintrag.biomassestromId))
    .leftJoin(outputBedarf, eq(outputBedarf.id, inboxEintrag.outputBedarfId))
    .leftJoin(akteur, eq(akteur.id, inboxEintrag.akteurId))
    .leftJoin(kontaktperson, eq(kontaktperson.id, inboxEintrag.kontaktpersonId))
    .leftJoin(importLauf, eq(importLauf.id, inboxEintrag.importLaufId))
    .where(
      and(
        eq(inboxEintrag.empfaengerId, nutzerId),
        sicht === "offen" ? eq(inboxEintrag.zustand, "offen") : ne(inboxEintrag.zustand, "offen"),
      ),
    )
    .orderBy(desc(inboxEintrag.aktualisiertAm));
  return zeilen.map((z) => {
    const ausloeser = z.ausloeserId && z.ausloeserEmail ? { id: z.ausloeserId, name: z.ausloeserName, email: z.ausloeserEmail } : null;
    const bezeichnung = z.bezeichnung ?? z.akteurName;
    return {
      id: z.id,
      typ: z.typ,
      zustand: z.zustand,
      anzahl: z.anzahl,
      gelesen: z.gelesenAm != null,
      aktualisiertAm: z.aktualisiertAm.toISOString(),
      zustandSeit: z.zustandSeit.toISOString(),
      ausloeser,
      strom: z.biomassestromId ? { art: "biomasse", id: z.biomassestromId } : z.outputBedarfId ? { art: "output", id: z.outputBedarfId } : null,
      akteur: z.akteurId ? { id: z.akteurId, name: z.hinweisAkteurName ?? "–" } : null,
      kontaktperson: z.kontaktpersonId ? { id: z.kontaktpersonId, name: z.kontaktpersonName ?? "–", akteurId: z.kontaktpersonAkteurId ?? "" } : null,
      importLauf: z.importLaufId ? { id: z.importLaufId, dateiname: z.importDateiname ?? "–" } : null,
      belegNr: z.belegNr,
      bezeichnung,
      notiz: z.notiz,
      bezugsdatum: z.bezugsdatum,
      aufgabe: z.aufgabe,
      text: zeilenText(z.typ, {
        ausloeserName: ausloeser ? (ausloeser.name ?? ausloeser.email) : "",
        belegNr: z.belegNr,
        bezeichnung,
        anzahl: z.anzahl,
        bezugsdatum: z.bezugsdatum,
        aufgabe: z.aufgabe,
        akteurName: z.hinweisAkteurName,
        kontaktpersonName: z.kontaktpersonName,
              importDateiname: z.importDateiname ?? null,
        importZaehler: (z.importZaehler as Record<string, number> | null) ?? null,
      }, z.id),
    };
  });
}

export class FremderEintrag extends Error {
  constructor() {
    super("Dieser Eintrag gehört einer anderen Person.");
    this.name = "FremderEintrag";
  }
}

/**
 * Objektstufe der Inbox-Aktionen: Eintrag mit Zeilensperre lesen und gegen
 * die Matrix pruefen (empfaenger_id = nutzer.id). Fremde Eintraege werden
 * abgewiesen, ohne zu verraten, ob es sie gibt (nicht gefunden = fremd).
 */
export async function pruefeInboxEmpfaenger(
  tx: Tx,
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  aktion: Aktion,
  eintragId: string,
): Promise<{
  id: string;
  empfaengerId: string;
  ausloeserId: string | null;
  typ: InboxTyp;
  zustand: "offen" | "erledigt" | "verworfen";
  gelesen: boolean;
  strom: { art: StromArt; id: string } | null;
}> {
  const [e] = await tx
    .select({
      id: inboxEintrag.id,
      empfaengerId: inboxEintrag.empfaengerId,
      ausloeserId: inboxEintrag.ausloeserId,
      typ: inboxEintrag.typ,
      zustand: inboxEintrag.zustand,
      gelesenAm: inboxEintrag.gelesenAm,
      biomassestromId: inboxEintrag.biomassestromId,
      outputBedarfId: inboxEintrag.outputBedarfId,
    })
    .from(inboxEintrag)
    .where(eq(inboxEintrag.id, eintragId))
    .for("update");
  if (!e || !darf(zugang, aktion, { empfaengerId: e.empfaengerId })) throw new FremderEintrag();
  return {
    id: e.id,
    empfaengerId: e.empfaengerId,
    ausloeserId: e.ausloeserId,
    typ: e.typ,
    zustand: e.zustand,
    gelesen: e.gelesenAm != null,
    strom: e.biomassestromId ? { art: "biomasse", id: e.biomassestromId } : e.outputBedarfId ? { art: "output", id: e.outputBedarfId } : null,
  };
}

/**
 * PR c: Laeuft von dieser Person schon eine offene Zugriffsanfrage zu dem
 * Strom? Dann zeigt der Beleg-Kopf „Angefragt am …" statt des Knopfs —
 * abgeleitet aus dem offenen Eintrag (beim Sperrinhaber oder den Admins).
 */
export async function offeneAnfrageVon(
  db: Leser,
  nutzerId: string,
  art: StromArt,
  stromId: string,
): Promise<{ am: string } | null> {
  const spalte = art === "biomasse" ? inboxEintrag.biomassestromId : inboxEintrag.outputBedarfId;
  const [e] = await db
    .select({ am: inboxEintrag.aktualisiertAm })
    .from(inboxEintrag)
    .where(
      and(
        eq(inboxEintrag.ausloeserId, nutzerId),
        eq(spalte, stromId),
        eq(inboxEintrag.zustand, "offen"),
        sql`${inboxEintrag.typ}::text = 'zugriffsanfrage'`,
      ),
    )
    .limit(1);
  return e ? { am: e.am.toISOString() } : null;
}
