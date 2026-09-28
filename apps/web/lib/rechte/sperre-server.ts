import { benutzer, biomassestrom, outputBedarf, stromZuweisung } from "@bhyo/db/schema";
import { eq, or, sql } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { type Aktion, type StromSperre, darf, darfZugewiesenWerden } from "./matrix";
import type { Zugang } from "./rollen";

/**
 * E44: Objektstufe der Wache — die Sperre eines Stroms wird IN der
 * Transaktion des Schreibpfads gelesen (Zeilensperre `FOR UPDATE`) und gegen
 * die Matrix geprueft. Gleichzeitiges Sperren und Bearbeiten kann so nicht
 * kollidieren: Wer zuerst die Zeile haelt, entscheidet; der andere sieht den
 * neuen Zustand. Kein eigener Regelvorrat — die Regeln stehen in matrix.ts.
 */
export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
export type StromArt = "biomasse" | "output";

/** Wird geworfen, wenn die Sperre den Schreibpfad verbietet — mit klarer Meldung fuer die Oberflaeche. */
export class Gesperrt extends Error {
  constructor(
    readonly von: { id: string; name: string | null; email: string },
    readonly am: Date | null,
    meldung?: string,
  ) {
    super(meldung ?? `Gesperrt von ${von.name ?? von.email}.`);
    this.name = "Gesperrt";
  }
}

export interface SperrZustand extends StromSperre {
  inhaber: { id: string; name: string | null; email: string } | null;
  gesperrtAm: Date | null;
}

function tabelleFuer(art: StromArt) {
  return art === "biomasse" ? biomassestrom : outputBedarf;
}

/**
 * Liest Sperre und Zuweisungen eines Stroms und HAELT die Zeile bis zum
 * Ende der Transaktion (`FOR UPDATE`). Wirft, wenn der Strom fehlt.
 */
export async function ladeSperre(tx: Tx, art: StromArt, id: string): Promise<SperrZustand> {
  const t = tabelleFuer(art);
  const [zeile] = await tx
    .select({
      gesperrtVon: t.gesperrtVon,
      gesperrtAm: t.gesperrtAm,
      inhaberName: benutzer.name,
      inhaberEmail: benutzer.email,
    })
    .from(t)
    .leftJoin(benutzer, eq(benutzer.id, t.gesperrtVon))
    .where(eq(t.id, id))
    .for("update", { of: t })
    .limit(1);
  if (!zeile) throw new Error("Datensatz nicht gefunden.");
  const zugewiesene = (
    await tx
      .select({ nutzerId: stromZuweisung.nutzerId })
      .from(stromZuweisung)
      .where(eq(art === "biomasse" ? stromZuweisung.biomassestromId : stromZuweisung.outputBedarfId, id))
  ).map((z) => z.nutzerId);
  return {
    gesperrtVon: zeile.gesperrtVon,
    gesperrtAm: zeile.gesperrtAm,
    zugewiesene,
    inhaber: zeile.gesperrtVon
      ? { id: zeile.gesperrtVon, name: zeile.inhaberName, email: zeile.inhaberEmail ?? "" }
      : null,
  };
}

/**
 * Objektstufe fuer einen fachlichen Schreibpfad: liest die Sperre (mit
 * Zeilensperre) und wirft `Gesperrt`, wenn die Matrix die Aktion fuer diesen
 * Nutzer an diesem Strom verbietet. Gibt den Zustand zurueck, damit die
 * Sperr-Actions ihn weiterverwenden koennen.
 */
export async function pruefeStromSperre(
  tx: Tx,
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  aktion: Aktion,
  art: StromArt,
  id: string,
): Promise<SperrZustand> {
  const zustand = await ladeSperre(tx, art, id);
  if (!darf(zugang, aktion, zustand)) {
    if (zustand.inhaber) throw new Gesperrt(zustand.inhaber, zustand.gesperrtAm);
    throw new Error("Für diese Aktion fehlt das Recht.");
  }
  return zustand;
}

/**
 * E44, geteilte Belege: Ein Beleg darf nur geaendert werden, wenn KEINER der
 * referenzierenden Stroeme (beide Tabellen) fuer den Handelnden gesperrt ist.
 * Alle referenzierenden Zeilen werden gehalten (`FOR UPDATE`).
 */
export async function pruefeBelegSperre(
  tx: Tx,
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  belegId: string,
): Promise<void> {
  const referenzen: { art: StromArt; id: string }[] = [];
  for (const art of ["biomasse", "output"] as const) {
    const t = tabelleFuer(art);
    const zeilen = await tx
      .select({ id: t.id })
      .from(t)
      .where(eq(t.belegId, belegId))
      .for("update");
    for (const z of zeilen) referenzen.push({ art, id: z.id });
  }
  for (const r of referenzen) {
    const zustand = await ladeSperre(tx, r.art, r.id);
    if (!darf(zugang, "strom.bearbeiten", zustand) && zustand.inhaber) {
      throw new Gesperrt(
        zustand.inhaber,
        zustand.gesperrtAm,
        `Der Beleg gehört auch zu einem Strom, der von ${zustand.inhaber.name ?? zustand.inhaber.email} gesperrt ist.`,
      );
    }
  }
}

/** E44: Nutzer, an die zugewiesen werden kann (aktiv, Rolle >= bearbeiter) — fuer das Zuweisen-Menue. */
export async function ladeZuweisbare(db: AppDb | Tx): Promise<{ id: string; name: string | null; email: string }[]> {
  const alle = await db
    .select({ id: benutzer.id, name: benutzer.name, email: benutzer.email, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
    .from(benutzer)
    .orderBy(benutzer.email);
  return alle.filter((b) => darfZugewiesenWerden(b)).map(({ id, name, email }) => ({ id, name, email }));
}

/** Sperrzustand aus einem geladenen Strom (fuer darf() in der Oberflaeche). */
export function sperrObjekt(s: {
  sperre?: { von: { id: string } } | null;
  zuweisungen?: { id: string }[];
}): StromSperre {
  return { gesperrtVon: s.sperre?.von.id ?? null, zugewiesene: (s.zuweisungen ?? []).map((z) => z.id) };
}

/** Alle Zuweisungen eines Stroms loeschen (Entsperren, E44). */
export async function loescheZuweisungen(tx: Tx, art: StromArt, id: string): Promise<void> {
  await tx
    .delete(stromZuweisung)
    .where(eq(art === "biomasse" ? stromZuweisung.biomassestromId : stromZuweisung.outputBedarfId, id));
}

// or/sql werden von Aufrufern (Actions) fuer bedingte Updates gebraucht — hier re-exportiert,
// damit die Sperr-Actions keine zweite drizzle-Importliste pflegen.
export { or, sql };
