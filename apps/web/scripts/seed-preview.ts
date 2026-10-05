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

import { deriveQualitaet } from "../lib/qualitaet";
import {
  leiteVerfuegbarkeitAb,
  validiereVergaben,
  vergabenZuFormZeilen,
} from "../lib/verfuegbarkeit";
import { A25_ORTE } from "./seed-akteure-daten";
import { baueSeedDaten, MARKER, STICHTAG } from "./seed-daten";
import { pruefeSeedZiel, pruefeStammdaten } from "./seed-guard";

const ziel = pruefeSeedZiel(process.env);
if ("fehler" in ziel) {
  console.error(`Abbruch: ${ziel.fehler}`);
  process.exit(1);
}

const sql = createSql(ziel.url);
const BELEG_MARKER = "SEED-v2 (synthetisch)";

async function main() {
  const { akteure, feedstock, outputs } = baueSeedDaten();
  const alle = [...feedstock, ...outputs];

  // E23-Guard: Ein Stufenwert im Seed-Input ist ein Fehler und bricht LAUT ab
  // — die Stufe entsteht ausschliesslich in der DB (GENERATED auf beleg).
  // Der Typ verbietet das Feld bereits; das hier faengt eine kuenftige
  // Wiedereinfuehrung zur Laufzeit.
  for (const s of alle)
    if ("qualitaet" in (s as unknown as Record<string, unknown>)) {
      console.error(
        `Abbruch: Seed-Input traegt einen Stufenwert ("${s.bezeichnung}"). ` +
          "Der Seed setzt nur Felder; die Stufe leitet die DB ab (E23). " +
          "Generator korrigieren, keinen Stufenwert durchreichen.",
      );
      process.exit(1);
    }

  // --- Stammdaten-Guard: VOR dem ersten Schreibzugriff, kein Ersatzprodukt ---
  const [materialarten, produkte] = await Promise.all([
    sql`SELECT code FROM materialart`,
    sql`SELECT code FROM output_produkt`,
  ]);
  const stammdaten = pruefeStammdaten({
    verwendeteMaterialarten: feedstock.map((s) => s.materialartCode!),
    verwendeteProdukte: outputs.map((s) => s.produktCode!),
    bekannteMaterialarten: materialarten.map((r) => r.code as string),
    bekannteProdukte: produkte.map((r) => r.code as string),
  });
  if (stammdaten) {
    console.error(`Abbruch: ${stammdaten.fehler}`);
    process.exit(1);
  }

  // --- Loeschen (nur Marker-Zeilen, FK-Reihenfolge) --------------------------
  await sql.begin(async (tx) => {
    await tx`DELETE FROM vergabe_zeitraum WHERE biomassestrom_id IN
      (SELECT id FROM biomassestrom WHERE bezeichnung LIKE ${"%" + MARKER})`;
    await tx`DELETE FROM vergabe_zeitraum WHERE output_bedarf_id IN
      (SELECT id FROM output_bedarf WHERE bezeichnung LIKE ${"%" + MARKER})`;
    // AP2.1/AP2.2 (Zuweisungen, Inbox) und AP2.4 (Hinweise) verweisen seither auf
    // Stroeme: die Zeilen zu Marker-Stroemen sind Testdaten derselben Preview und
    // gehen mit — sonst bricht der Marker-DELETE am Fremdschluessel ab (01.10.2026).
    for (const tabelle of ["strom_zuweisung", "inbox_eintrag"] as const) {
      await tx.unsafe(`DELETE FROM ${tabelle} WHERE biomassestrom_id IN (SELECT id FROM biomassestrom WHERE bezeichnung LIKE $1)`, ["%" + MARKER]);
      await tx.unsafe(`DELETE FROM ${tabelle} WHERE output_bedarf_id IN (SELECT id FROM output_bedarf WHERE bezeichnung LIKE $1)`, ["%" + MARKER]);
    }
    await tx`DELETE FROM biomassestrom WHERE bezeichnung LIKE ${"%" + MARKER}`;
    await tx`DELETE FROM output_bedarf WHERE bezeichnung LIKE ${"%" + MARKER}`;
    await tx`DELETE FROM beleg WHERE metadata->>'seed' = ${BELEG_MARKER}`;
    await tx`DELETE FROM akteur WHERE name LIKE 'Seed: %'
      AND NOT EXISTS (SELECT 1 FROM biomassestrom b WHERE b.akteur_id = akteur.id)
      AND NOT EXISTS (SELECT 1 FROM output_bedarf o WHERE o.akteur_id = akteur.id)`;
  });

  // --- Einfuegen ---------------------------------------------------------------
  // AP2.5 PR a2 (0039): sektor, sitz_plz und sitz_ort sind NOT NULL. Der Sitz
  // eines Bestand-Akteurs ist der Standort seines ersten Stroms mit Ort (die
  // Reihenfolge der Seed-Daten ist die Anlage-Reihenfolge; vorher tat das
  // seed-akteure.ts nachtraeglich per UPDATE — jetzt eine Stelle). Die PLZ
  // kommt aus derselben Ortsliste wie bei Seed-A25; ein Ort ohne Eintrag
  // bekommt die Platzhalter-PLZ 00000 (Testdaten). Ein Akteur ohne Strom mit
  // Ort ist im Seed nicht vorgesehen — dann bricht der Seed ab, statt einen
  // Sitz zu erfinden.
  const plzJeOrt = new Map(A25_ORTE.map((o) => [o.ort, o.plz]));
  const sitzJeAkteur = new Map<number, { ort: string; plz: string; lng: number | null; lat: number | null }>();
  for (const s of alle) {
    if (sitzJeAkteur.has(s.akteurIndex) || !s.ort) continue;
    sitzJeAkteur.set(s.akteurIndex, { ort: s.ort, plz: plzJeOrt.get(s.ort) ?? "00000", lng: s.lng, lat: s.lat });
  }
  await sql.begin(async (tx) => {
    for (const [i, a] of akteure.entries()) {
      const sitz = sitzJeAkteur.get(i);
      if (!sitz) throw new Error(`Seed-Akteur ${a.name} hat keinen Strom mit Ort — kein Sitz ableitbar (NOT NULL seit 0039).`);
      // Idempotent auch dann, wenn ein Seed-Akteur wegen Nicht-Seed-Referenzen
      // (z. B. manuell erfasste Stroeme auf der Preview) nicht geloescht
      // wurde: dieselbe deterministische ID ist DERSELBE Akteur — er wird auf
      // den Generator-Stand aktualisiert statt am Primaerschluessel zu platzen.
      // AP2.5 (E66): „ohne Sektor" ist die Systemzeile ohne_sektor, nicht NULL.
      await tx`INSERT INTO akteur (id, name, sektor, status, sitz_plz, sitz_ort, sitz_geom)
        VALUES (${a.id}, ${a.name}, ${a.sektor ?? "ohne_sektor"}, 'geprueft', ${sitz.plz}, ${sitz.ort},
          ${sitz.lng == null ? null : tx`ST_SetSRID(ST_MakePoint(${sitz.lng}, ${sitz.lat}), 4326)`})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
          sektor = EXCLUDED.sektor, sitz_plz = EXCLUDED.sitz_plz, sitz_ort = EXCLUDED.sitz_ort, sitz_geom = EXCLUDED.sitz_geom`;
    }
    for (const s of alle) {
      let belegId: string | null = null;
      if (s.beleg) {
        const [row] = await tx`INSERT INTO beleg
          (typ, extern_nachvollziehbar, link_url, gueltig_bis, metadata, erstellt_am)
          VALUES (${s.beleg.typ}, ${s.beleg.extern}, ${s.beleg.linkUrl}, ${s.beleg.gueltigBis},
            ${tx.json({ seed: BELEG_MARKER, quellenangabe: s.beleg.quellenangabe })},
            ${s.beleg.erhebungsdatum + "T09:00:00Z"})
          RETURNING id`;
        belegId = row!.id as string;
      }
      const akteurId = akteure[s.akteurIndex]!.id;
      if (s.art === "biomasse") {
        await tx`INSERT INTO biomassestrom
          (id, akteur_id, bezeichnung, ort, standort_geom,
           materialart_code, menge_roh_fm, ts_anteil_pct, aschegehalt_pct,
           zeitraum_von, zeitraum_bis, saisonalitaet,
           preis_min, preis_mittel, preis_max,
           preis_herkunft, beleg_id, status,
           reserviert_bhyo, reserviert_seit)
          VALUES (${s.id}, ${akteurId}, ${s.bezeichnung}, ${s.ort},
            ${s.lng == null ? null : tx`ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)`},
            ${s.materialartCode!}, ${s.mengeRohFm!}, ${s.tsAnteilPct!}, ${s.aschegehaltPct!},
            ${s.zeitraumVon}, ${s.zeitraumBis}, ${tx.json(s.saisonalitaet)},
            ${s.preisMin ?? null}, ${s.preisMittel ?? null}, ${s.preisMax ?? null},
            ${s.preisMittel == null ? null : "schaetzung"}, ${belegId}, ${s.status},
            ${s.reserviertBhyo}, ${s.reserviertSeit})`;
        for (const v of s.vergaben)
          await tx`INSERT INTO vergabe_zeitraum
            (biomassestrom_id, vergeben_von, vergeben_bis, vergeben_an, an_bhyo)
            VALUES (${s.id}, ${v.vergebenVon}, ${v.vergebenBis}, ${v.vergebenAn}, ${v.anBhyo})`;
      } else {
        await tx`INSERT INTO output_bedarf
          (id, akteur_id, bezeichnung, ort, standort_geom,
           produkt_code, menge_wert, menge_einheit, preis, preis_einheit,
           preis_herkunft, zeitraum_von, zeitraum_bis, saisonalitaet,
           beleg_id, status, reserviert_bhyo, reserviert_seit)
          VALUES (${s.id}, ${akteurId}, ${s.bezeichnung}, ${s.ort},
            ${s.lng == null ? null : tx`ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)`},
            ${s.produktCode!}, ${s.mengeWert!}, ${s.mengeEinheit!}, ${s.preis ?? null}, ${s.preisEinheit ?? null},
            ${s.preis == null ? null : "schaetzung"}, ${s.zeitraumVon}, ${s.zeitraumBis},
            ${tx.json(s.saisonalitaet)}, ${belegId}, ${s.status},
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

  // --- E23: Stufen-Anker — die DB-abgeleitete Stufe (GENERATED auf beleg)
  // muss fuer JEDEN Seed-Strom exakt der TS-Ableitung aus den gesetzten
  // Feldern entsprechen; die stillgelegte Strom-Spalte bleibt leer.
  const dbStufen = await sql`
    SELECT s.id, b.qualitaet::text AS stufe
      FROM biomassestrom s JOIN beleg b ON b.id = s.beleg_id
      WHERE s.bezeichnung LIKE ${"%" + MARKER}
    UNION ALL
    SELECT s.id, b.qualitaet::text
      FROM output_bedarf s JOIN beleg b ON b.id = s.beleg_id
      WHERE s.bezeichnung LIKE ${"%" + MARKER}`;
  const stufeJeStrom = new Map(dbStufen.map((r) => [r.id as string, r.stufe as string]));
  for (const s of alle) {
    if (!s.beleg) {
      if (stufeJeStrom.has(s.id)) fehler.push(`${s.bezeichnung}: Stufe ohne Seed-Beleg`);
      continue;
    }
    // E34: nur Typ und Nachweis (hier immer Link) bestimmen die Stufe.
    const erwartet = deriveQualitaet({ typ: s.beleg.typ as never, linkUrl: s.beleg.linkUrl });
    const db = stufeJeStrom.get(s.id);
    if (db !== erwartet)
      fehler.push(`${s.bezeichnung}: DB-Stufe ${db ?? "fehlt"} statt ${erwartet}`);
  }
  // (Der Waechter auf die stillgelegte Strom-Spalte qualitaet ist mit
  // Migration 0014 entfallen — die Spalte existiert nicht mehr; ein
  // Wiedereinfuehren scheitert jetzt physisch am Schema.)

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
  const verteilung: Record<string, number> = {};
  for (const st of stufeJeStrom.values()) verteilung[st] = (verteilung[st] ?? 0) + 1;
  console.log(`Abgeleitete Stufen (aus der DB):`, JSON.stringify(verteilung), `| ohne Beleg: ${alle.filter((s) => !s.beleg).length}`);
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
