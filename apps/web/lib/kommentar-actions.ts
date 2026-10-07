"use server";

import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import {
  KommentarFehlerAusnahme,
  istKommentarBezug,
  kommentarBearbeitenInTx,
  kommentarErstellenInTx,
  kommentarLoeschenInTx,
  type KommentarBezug,
} from "@/lib/kommentar-schreibweg";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { Handelnder } from "@/lib/strom-schreibweg";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * AP2.6 PR a (E71): Server-Actions der Kommentare — Wache am Eingang
 * (Rollenstufe), dann der Baustein kommentar-schreibweg.ts in einer
 * Transaktion (Objektstufe am Autor, Text, Erwaehnungen, Protokoll). Die
 * Oberflaeche (PR b) ruft diese drei Funktionen.
 */
function aktualisiere(bezug: KommentarBezug) {
  revalidatePath(bezug.art === "akteur" ? `/akteure/${bezug.id}` : "/register");
}

function meldung(e: unknown, sonst: string): string {
  if (e instanceof KommentarFehlerAusnahme) return e.message;
  return e instanceof Error ? e.message : sonst;
}

export async function kommentarErstellen(bezug: KommentarBezug, fd: FormData): Promise<AktionErgebnis & { id?: string }> {
  const wache = await rechtFuerAction("kommentar.erstellen");
  if ("fehler" in wache) return wache;
  if (!istKommentarBezug(bezug)) return { ok: false, fehler: "Ungültiger Bezug." };
  const handelnder: Handelnder = { id: wache.zugang.id, email: wache.email, rolle: wache.zugang.rolle };
  let id = "";
  try {
    id = (await withDb((db) => db.transaction((tx) => kommentarErstellenInTx(tx, handelnder, bezug, fd.get("text"))))).id;
  } catch (e) {
    return { ok: false, fehler: meldung(e, "Speichern fehlgeschlagen.") };
  }
  aktualisiere(bezug);
  return { ok: true, id };
}

export async function kommentarBearbeiten(id: string, fd: FormData): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("kommentar.bearbeiten");
  if ("fehler" in wache) return wache;
  const handelnder: Handelnder = { id: wache.zugang.id, email: wache.email, rolle: wache.zugang.rolle };
  let bezug: KommentarBezug;
  try {
    bezug = (await withDb((db) => db.transaction((tx) => kommentarBearbeitenInTx(tx, handelnder, id, fd.get("text"))))).bezug;
  } catch (e) {
    return { ok: false, fehler: meldung(e, "Speichern fehlgeschlagen.") };
  }
  aktualisiere(bezug);
  return { ok: true };
}

export async function kommentarLoeschen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("kommentar.loeschen");
  if ("fehler" in wache) return wache;
  const handelnder: Handelnder = { id: wache.zugang.id, email: wache.email, rolle: wache.zugang.rolle };
  let bezug: KommentarBezug;
  try {
    bezug = (await withDb((db) => db.transaction((tx) => kommentarLoeschenInTx(tx, handelnder, id)))).bezug;
  } catch (e) {
    return { ok: false, fehler: meldung(e, "Löschen fehlgeschlagen.") };
  }
  aktualisiere(bezug);
  return { ok: true };
}
