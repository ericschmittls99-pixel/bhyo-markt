"use server";

import { akteur, akteurInteresse, akteurKeineDublette, biomassestrom, kontaktperson, outputBedarf } from "@bhyo/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { entscheidungenAus, konflikte, type KonfliktFeld, type ZusammenfuehrenErgebnis } from "@/lib/dubletten-modell";
import { zusammenfuehrungsText } from "@/lib/dubletten";
import { protokolliere } from "@/lib/protokoll";
import { Gesperrt, pruefeStromSperre } from "@/lib/rechte/sperre-server";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * AP2.5 PR c (E66): Dubletten — „keine Dublette" (ab bearbeiter) und
 * Zusammenfuehren (nur pruefer/admin, endgueltig). Jeder Pfad protokolliert;
 * im Freitext stehen nur IDs und Feldnamen (E57).
 */
export async function keineDubletteMarkieren(aId: string, bId: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("akteur.keine_dublette");
  if ("fehler" in wache) return wache;
  if (aId === bId) return { ok: false, fehler: "Ein Akteur ist keine Dublette von sich selbst." };
  // Geordnet wie der CHECK der Tabelle (uuid-Vergleich = Vergleich der Hex-Darstellung).
  const [a, b] = [aId.toLowerCase(), bId.toLowerCase()].sort();
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await tx.insert(akteurKeineDublette).values({ akteurA: a!, akteurB: b! });
        for (const id of [a!, b!]) {
          await protokolliere(tx, {
            art: "keine_dublette_markiert",
            entitaet: "akteur",
            id,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Paar ${a} · ${b}`,
          });
        }
      }),
    );
  } catch (e) {
    const text = e instanceof Error ? e.message : "";
    return { ok: false, fehler: /akteur_keine_dublette_paar_uniq/.test(text) ? `Dieses Paar ist schon als „keine Dublette" markiert.` : text || "Markieren fehlgeschlagen." };
  }
  revalidatePath("/akteure/dubletten");
  return { ok: true };
}

/**
 * Zusammenfuehren: Quelle → Ziel in EINER Transaktion. Feldkonflikte
 * entscheidet der Nutzer (voreingestellt gewinnt das Ziel); Stroeme (Belege,
 * E48), Kontaktpersonen und Interessen wandern zum Ziel, die Quelle wird
 * geloescht. Leitplanke Belege (E44): jeder Strom der Quelle wird mit der
 * Objektregel von strom.bearbeiten geprueft (Zeilensperre) — ist einer fuer
 * den Handelnden gesperrt, wird mit klarer Meldung abgewiesen, nichts
 * geschrieben. Der Trigger kontaktperson_kein_umhaengen laesst das
 * Umhaengen nur mit dem Ereignis akteur_zusammengefuehrt dieser Transaktion
 * zu. Die Beteiligten der Stroeme bekommen ueber das Ereignis „geaendert" je
 * Strom die uebliche gebuendelte Aenderungs-Mitteilung.
 */
export async function akteureZusammenfuehren(quelleId: string, zielId: string, entscheidungenRoh: unknown): Promise<ZusammenfuehrenErgebnis> {
  const wache = await rechtFuerAction("akteur.zusammenfuehren");
  if ("fehler" in wache) return wache;
  if (quelleId === zielId) return { ok: false, fehler: "Quelle und Ziel sind derselbe Akteur." };
  const entscheidungen = entscheidungenAus(entscheidungenRoh);
  let stroemeGesamt = 0;
  let personenGesamt = 0;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const zeilen = await tx.select().from(akteur).where(inArray(akteur.id, [quelleId, zielId])).for("update");
        const quelle = zeilen.find((z) => z.id === quelleId);
        const ziel = zeilen.find((z) => z.id === zielId);
        if (!quelle || !ziel) throw new Error("Quelle oder Ziel nicht gefunden.");

        // Leitplanke Belege: alle Stroeme der Quelle, Sperre je Strom in der Transaktion.
        const stroeme: { art: "biomasse" | "output"; id: string; bezeichnung: string | null }[] = [];
        for (const s of await tx.select({ id: biomassestrom.id, bezeichnung: biomassestrom.bezeichnung }).from(biomassestrom).where(eq(biomassestrom.akteurId, quelleId)))
          stroeme.push({ art: "biomasse", ...s });
        for (const s of await tx.select({ id: outputBedarf.id, bezeichnung: outputBedarf.bezeichnung }).from(outputBedarf).where(eq(outputBedarf.akteurId, quelleId)))
          stroeme.push({ art: "output", ...s });
        for (const s of stroeme) {
          try {
            await pruefeStromSperre(tx, wache.zugang, "strom.bearbeiten", s.art, s.id);
          } catch (e) {
            if (e instanceof Gesperrt) {
              throw new Error(`Zusammenführen abgewiesen: Strom „${s.bezeichnung ?? s.id}" ist von ${e.von.name ?? e.von.email} gesperrt. Erst entsperren oder zuweisen lassen.`);
            }
            throw e;
          }
        }

        // Feldentscheidungen: nur echte Konflikte, voreingestellt gewinnt das Ziel.
        const vergleich = (a: typeof quelle) => ({ name: a.name, sektor: a.sektor ?? "ohne_sektor", sitzStrasse: a.sitzStrasse, sitzHausnummer: a.sitzHausnummer, sitzPlz: a.sitzPlz, sitzOrt: a.sitzOrt });
        const ausQuelle = konflikte(vergleich(ziel), vergleich(quelle)).filter((f) => entscheidungen[f] === "quelle");
        const felder: string[] = [];
        const neu: Record<string, unknown> = {};
        for (const f of ausQuelle as KonfliktFeld[]) {
          if (f === "name") {
            neu.name = quelle.name;
            felder.push("name");
          } else if (f === "sektor") {
            neu.sektor = quelle.sektor;
            felder.push("sektor");
          } else {
            neu.sitzStrasse = quelle.sitzStrasse;
            neu.sitzHausnummer = quelle.sitzHausnummer;
            neu.sitzPlz = quelle.sitzPlz;
            neu.sitzOrt = quelle.sitzOrt;
            neu.sitzGeom = sql`(select sitz_geom from akteur where id = ${quelleId})`;
            felder.push("sitz_strasse", "sitz_hausnummer", "sitz_plz", "sitz_ort", "sitz_geom");
          }
        }

        // Das Ereignis der Quelle ZUERST — der Trigger der Kontaktpersonen liest es.
        await protokolliere(tx, {
          art: "akteur_zusammengefuehrt",
          entitaet: "akteur",
          id: quelleId,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `${zusammenfuehrungsText(quelleId, zielId)}; ${stroeme.length} Strom/Ströme; Felder aus Quelle: ${felder.join(", ") || "keine"}`,
        });

        if (felder.length) {
          await tx.update(akteur).set({ ...neu, updatedAt: new Date() }).where(eq(akteur.id, zielId));
        }
        await protokolliere(tx, {
          art: "akteur_geaendert",
          entitaet: "akteur",
          id: zielId,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Zusammengeführt aus ${quelleId}; Felder: ${felder.join(", ") || "keine"}`,
        });

        // Stroeme umhaengen — je Strom ein Ereignis (gebuendelte Mitteilung an die Beteiligten).
        await tx.update(biomassestrom).set({ akteurId: zielId }).where(eq(biomassestrom.akteurId, quelleId));
        await tx.update(outputBedarf).set({ akteurId: zielId }).where(eq(outputBedarf.akteurId, quelleId));
        for (const s of stroeme) {
          await protokolliere(tx, {
            art: "geaendert",
            entitaet: s.art === "biomasse" ? "biomassestrom" : "output_bedarf",
            id: s.id,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Akteur zusammengeführt: ${quelleId} → ${zielId}`,
          });
        }
        stroemeGesamt = stroeme.length;

        // Kontaktpersonen umhaengen (Trigger-Ausnahme durch das Ereignis oben) — je Person ein Ereignis, nur IDs.
        const personen = await tx.update(kontaktperson).set({ akteurId: zielId, updatedAt: new Date() }).where(eq(kontaktperson.akteurId, quelleId)).returning({ id: kontaktperson.id });
        for (const p of personen) {
          await protokolliere(tx, {
            art: "kontaktperson_geaendert",
            entitaet: "kontaktperson",
            id: p.id,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Felder: akteur_id (Zusammenführung ${quelleId} → ${zielId})`,
          });
        }
        personenGesamt = personen.length;

        // Interessen: Duplikate derselben Region zusammenlegen (Entscheidung Eric 01.10.2026), Rest umhaengen.
        const zielRegionen = (await tx.select({ regionId: akteurInteresse.regionId }).from(akteurInteresse).where(eq(akteurInteresse.akteurId, zielId))).map((r) => r.regionId);
        if (zielRegionen.length) await tx.delete(akteurInteresse).where(and(eq(akteurInteresse.akteurId, quelleId), inArray(akteurInteresse.regionId, zielRegionen)));
        await tx.update(akteurInteresse).set({ akteurId: zielId }).where(eq(akteurInteresse.akteurId, quelleId));

        // Quelle loeschen — keine-Dublette-Paare und Verwaist-Hinweise gehen per CASCADE.
        await tx.delete(akteur).where(eq(akteur.id, quelleId));
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Zusammenführen fehlgeschlagen." };
  }
  revalidatePath("/akteure");
  revalidatePath("/akteure/dubletten");
  revalidatePath(`/akteure/${zielId}`);
  revalidatePath("/register");
  return { ok: true, zielId, stroeme: stroemeGesamt, kontaktpersonen: personenGesamt };
}
