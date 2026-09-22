/**
 * Seed v2 fuer die PREVIEW-Datenbank (Auftrag Eric, 22.09.2026).
 *
 * Sicherheit (§0):
 * - Verbindet AUSSCHLIESSLICH ueber die Env-Variable SEED_DATABASE_URL_PREVIEW
 *   (bewusst nicht DATABASE_URL) und bricht ab, wenn die URL nach Production
 *   aussieht. Es gibt KEIN Flag, das diese Pruefung uebergeht.
 * - Idempotent: geloescht wird ausschliesslich ueber den SEED-v2-Marker
 *   (bezeichnung LIKE '% · SEED-v2', beleg.metadata.seed, akteur.name
 *   LIKE 'Seed: %'). Niemals TRUNCATE; "Test:"-Bestand inkl. des Fixtures
 *   "Saegewerk Hoellental" bleibt unberuehrt.
 * - Deterministisch: Daten kommen aus seed-daten.ts (fester PRNG-Seed,
 *   BASIS_JAHR-Konstante) — zwei Laeufe schreiben identische Zeilen.
 *
 * Aufruf: SEED_DATABASE_URL_PREVIEW=<preview> pnpm --filter web seed:preview
 * (vorgesehen ueber den workflow_dispatch-Job seed-preview.yml, der das
 * GitHub-Secret DATABASE_URL_PREVIEW injiziert.)
 */
import { createSql } from "@bhyo/db/client";

import {
  leiteVerfuegbarkeitAb,
  validiereVergaben,
  vergabenZuFormZeilen,
} from "../lib/verfuegbarkeit";
import { baueSeedDaten, MARKER, STICHTAG } from "./seed-daten";

const url = process.env.SEED_DATABASE_URL_PREVIEW;
if (!url) {
  console.error(
    "Abbruch: SEED_DATABASE_URL_PREVIEW fehlt. Dieses Skript kennt bewusst nur diese eine Variable.",
  );
  process.exit(1);
}
if (/prod/i.test(url)) {
  console.error("Abbruch: die URL sieht nach Production aus. Kein Override vorgesehen.");
  process.exit(1);
}

const sql = createSql(url);
const BELEG_MARKER = "SEED-v2 (synthetisch)";

async function main() {
  const { akteure, feedstock, outputs } = baueSeedDaten();
  const alle = [...feedstock, ...outputs];

  // --- Loeschen (nur Marker-Zeilen, FK-Reihenfolge) --------------------------
  await sql.begin(async (tx) => {
    await tx`DELETE FROM vergabe_zeitraum WHERE biomassestrom_id IN
      (SELECT id FROM biomassestrom WHERE bezeichnung LIKE ${"%" + MARKER})`;
    await tx`DELETE FROM vergabe_zeitraum WHERE output_bedarf_id IN
      (SELECT id FROM output_bedarf WHERE bezeichnung LIKE ${"%" + MARKER})`;
    await tx`DELETE FROM biomassestrom WHERE bezeichnung LIKE ${"%" + MARKER}`;
    await tx`DELETE FROM output_bedarf WHERE bezeichnung LIKE ${"%" + MARKER}`;
    await tx`DELETE FROM beleg WHERE metadata->>'seed' = ${BELEG_MARKER}`;
    await tx`DELETE FROM akteur WHERE name LIKE 'Seed: %'
      AND NOT EXISTS (SELECT 1 FROM biomassestrom b WHERE b.akteur_id = akteur.id)
      AND NOT EXISTS (SELECT 1 FROM output_bedarf o WHERE o.akteur_id = akteur.id)`;
  });

  // --- Einfuegen ---------------------------------------------------------------
  await sql.begin(async (tx) => {
    for (const a of akteure) {
      await tx`INSERT INTO akteur (id, name, sektor, rollen, status)
        VALUES (${a.id}, ${a.name}, ${a.sektor}, '{}', 'geprueft')`;
    }
    for (const s of alle) {
      let belegId: string | null = null;
      if (s.beleg) {
        const [row] = await tx`INSERT INTO beleg
          (typ, extern_nachvollziehbar, metadata, erstellt_am)
          VALUES (${s.beleg.typ}, ${s.beleg.extern},
            ${tx.json({ seed: BELEG_MARKER, quellenangabe: s.beleg.quellenangabe })},
            ${s.beleg.erhebungsdatum + "T09:00:00Z"})
          RETURNING id`;
        belegId = row!.id as string;
      }
      const akteurId = akteure[s.akteurIndex]!.id;
      if (s.art === "biomasse") {
        await tx`INSERT INTO biomassestrom
          (id, akteur_id, bezeichnung, ort, landkreis, standort_geom,
           materialart_code, menge_roh_fm, ts_anteil_pct, aschegehalt_pct,
           zeitraum_von, zeitraum_bis, saisonalitaet,
           preis_min, preis_mittel, preis_max,
           preis_herkunft, beleg_id, qualitaet, status,
           reserviert_bhyo, reserviert_seit)
          VALUES (${s.id}, ${akteurId}, ${s.bezeichnung}, ${s.ort}, ${s.landkreis},
            ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326),
            ${s.materialartCode!}, ${s.mengeRohFm!}, ${s.tsAnteilPct!}, ${s.aschegehaltPct!},
            ${s.zeitraumVon}, ${s.zeitraumBis}, ${tx.json(s.saisonalitaet)},
            ${s.preisMin ?? null}, ${s.preisMittel ?? null}, ${s.preisMax ?? null},
            ${s.preisMittel == null ? null : "schaetzung"}, ${belegId}, ${s.qualitaet}, ${s.status},
            ${s.reserviertBhyo}, ${s.reserviertSeit})`;
        for (const v of s.vergaben)
          await tx`INSERT INTO vergabe_zeitraum
            (biomassestrom_id, vergeben_von, vergeben_bis, vergeben_an, an_bhyo)
            VALUES (${s.id}, ${v.vergebenVon}, ${v.vergebenBis}, ${v.vergebenAn}, ${v.anBhyo})`;
      } else {
        await tx`INSERT INTO output_bedarf
          (id, akteur_id, bezeichnung, ort, landkreis, standort_geom,
           produkt_code, menge_wert, menge_einheit, preis, preis_einheit,
           preis_herkunft, zeitraum_von, zeitraum_bis, saisonalitaet,
           beleg_id, qualitaet, status, reserviert_bhyo, reserviert_seit)
          VALUES (${s.id}, ${akteurId}, ${s.bezeichnung}, ${s.ort}, ${s.landkreis},
            ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326),
            ${s.produktCode!}, ${s.mengeWert!}, ${s.mengeEinheit!}, ${s.preis ?? null}, ${s.preisEinheit ?? null},
            ${s.preis == null ? null : "schaetzung"}, ${s.zeitraumVon}, ${s.zeitraumBis},
            ${tx.json(s.saisonalitaet)}, ${belegId}, ${s.qualitaet}, ${s.status},
            ${s.reserviertBhyo}, ${s.reserviertSeit})`;
        for (const v of s.vergaben)
          await tx`INSERT INTO vergabe_zeitraum
            (output_bedarf_id, vergeben_von, vergeben_bis, vergeben_an, an_bhyo)
            VALUES (${s.id}, ${v.vergebenVon}, ${v.vergebenBis}, ${v.vergebenAn}, ${v.anBhyo})`;
      }
    }
  });

  // --- Selbstpruefung §4 (aus der DB zurueckgelesen) ---------------------------
  const [nFeed] = await sql`SELECT count(*)::int AS n FROM biomassestrom
    WHERE bezeichnung LIKE ${"%" + MARKER}`;
  const [nOut] = await sql`SELECT count(*)::int AS n FROM output_bedarf
    WHERE bezeichnung LIKE ${"%" + MARKER}`;
  const fehler: string[] = [];
  if (nFeed!.n !== 60) fehler.push(`Feedstock: ${nFeed!.n} statt 60`);
  if (nOut!.n !== 50) fehler.push(`Outputs: ${nOut!.n} statt 50`);

  const [preisKaputt] = await sql`SELECT count(*)::int AS n FROM biomassestrom
    WHERE bezeichnung LIKE ${"%" + MARKER} AND preis_mittel IS NOT NULL
      AND NOT (preis_min::numeric <= preis_mittel::numeric AND preis_mittel::numeric <= preis_max::numeric)`;
  if (preisKaputt!.n !== 0) fehler.push(`${preisKaputt!.n} Belege mit min>mittel oder mittel>max`);

  // Vergaben + Saison + Status ueber die generierten (deterministisch = DB-Inhalt)
  for (const s of alle) {
    const summe = s.saisonalitaet.reduce((a, b) => a + b, 0);
    if (Math.abs(summe - 100) > 0.1) fehler.push(`${s.bezeichnung}: Saison-Summe ${summe}`);
    if (s.vergaben.length) {
      const f = validiereVergaben(
        s.zeitraumVon.slice(0, 7),
        s.zeitraumBis.slice(0, 7),
        vergabenZuFormZeilen(s.vergaben),
      );
      if (Object.keys(f).length) fehler.push(`${s.bezeichnung}: Vergabe ungueltig ${JSON.stringify(f)}`);
    }
  }

  const statusZaehler: Record<string, number> = {};
  let nebentag = 0;
  for (const s of alle) {
    const erg = leiteVerfuegbarkeitAb(
      STICHTAG,
      { zeitraumVon: s.zeitraumVon, zeitraumBis: s.zeitraumBis, reserviertBhyo: s.reserviertBhyo },
      s.vergaben,
    );
    statusZaehler[erg.status] = (statusZaehler[erg.status] ?? 0) + 1;
    if (erg.reserviertZusatz) nebentag++;
  }
  for (const muss of ["verfuegbar", "vergeben_extern", "vergeben_bhyo", "reserviert_bhyo", "noch_nicht_verfuegbar", "abgelaufen"])
    if (!statusZaehler[muss]) fehler.push(`Status ${muss} kommt nicht vor`);

  const jahre = alle.flatMap((s) => [Number(s.zeitraumVon.slice(0, 4)), Number(s.zeitraumBis.slice(0, 4))]);
  const positiv = feedstock.filter((s) => (s.preisMittel ?? 0) > 0).length;
  const negativ = feedstock.filter((s) => (s.preisMittel ?? 0) < 0).length;
  const ohne = alle.filter((s) => s.preisMittel == null && s.preis == null).length;

  console.log("--- Selbstpruefung Seed v2 ---");
  console.log(`Feedstock: ${nFeed!.n} | Outputs: ${nOut!.n} (alle mit Marker)`);
  console.log(`Statusverteilung (Stichtag ${STICHTAG}):`, JSON.stringify(statusZaehler));
  console.log(`Nebentag reserviert (bhyo): ${nebentag}`);
  console.log(`Zeitraum-Spannweite: ${Math.min(...jahre)} .. ${Math.max(...jahre)}`);
  console.log(`Preise: positiv ${positiv} | negativ ${negativ} | ohne ${ohne}`);
  if (fehler.length) {
    console.error("VERLETZUNGEN:\n- " + fehler.join("\n- "));
    process.exit(1);
  }
  console.log("Alle Invarianten erfuellt.");
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
