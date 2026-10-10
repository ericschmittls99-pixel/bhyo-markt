/**
 * TEMPORAER (vor dem Merge von #219 wieder loeschen): legt auf der Preview-DB
 * die beiden Mail-Hinweise fuer die Screenshots an — ueber die echten
 * Funktionen aus lib/inbox/mail-hinweise.ts, nichts von Hand:
 *   mail_stoerung         Ursache secret_abgelaufen, an alle aktiven Admins
 *   mail_secret_laeuft_ab Ablaufdatum in 20 Tagen → Stufe 30, an alle Admins
 * Ziel-Pruefung wie die Seed-Skripte (pruefeSeedZiel, nur SEED_DATABASE_URL_PREVIEW).
 * Log nur Zaehler (E73).
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";

import type { AppDb } from "../lib/db";
import { stelleSecretAblaufZu, stelleStoerungZu } from "../lib/inbox/mail-hinweise";
import { pruefeSeedZiel } from "./seed-guard";

const ziel = pruefeSeedZiel(process.env);
if ("fehler" in ziel) {
  console.error(`ABBRUCH: ${ziel.fehler}`);
  process.exit(2);
}
const verbindung = createSql(ziel.url, { max: 1 });
const db = drizzle(verbindung, { schema }) as unknown as AppDb;

async function main() {
  const heute = new Date();
  const stichtag = heute.toISOString().slice(0, 10);
  const in20 = new Date(heute);
  in20.setUTCDate(in20.getUTCDate() + 20);
  const ablauf = in20.toISOString().slice(0, 10);
  const stoerung = await stelleStoerungZu(db, "secret_abgelaufen");
  const secret = await stelleSecretAblaufZu(db, ablauf, stichtag);
  console.log(`PREVIEW-MAIL-HINWEISE stoerung_zugestellt=${stoerung} secret_zugestellt=${secret.zugestellt} secret_abgeraeumt=${secret.abgeraeumt} ablauf=${ablauf} stichtag=${stichtag}`);
}

main()
  .catch((e) => {
    console.error("PREVIEW-MAIL-HINWEISE FEHLER:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => verbindung.end());
