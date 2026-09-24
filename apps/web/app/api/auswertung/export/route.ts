import { ladeAlleVergaben, ladeStroeme } from "@/lib/stroeme";
import { wacheFuerRoute } from "@/lib/wache";
import {
  filterAusSearchParams,
  filterStroeme,
  type Strom,
  kreisAnzeige,
} from "@/lib/stroeme-modell";
import {
  reichereVerfuegbarkeitAn,
  vergabeLabel,
  verfuegbarkeitPill,
  type VergabeDaten,
} from "@/lib/verfuegbarkeit";

export const dynamic = "force-dynamic";

function csvFeld(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV-Export von auswertung. (E9, bleibt in V2): exportiert genau die
 * Auswahl des Dashboards — dasselbe Querystring-Schema wie karte./auswertung.
 * (mehrwertige Facetten kommagetrennt, sicht=), derselbe Datenpfad
 * (ladeStroeme + filterStroeme statt eigener SQL). Beide Arten in einer
 * Tabelle mit vereinheitlichten Spalten; Biomasse-Menge als t atro/a.
 */
export async function GET(req: Request) {
  // F8/E30: auch Lesen laeuft ueber die Wache — eine unbekannte oder
  // deaktivierte Adresse darf keine Daten sehen (fail closed).
  const wache = await wacheFuerRoute("lesen");
  if (!wache.ok) return wache.antwort;
  const p = new URL(req.url).searchParams;
  const roh: Record<string, string> = {};
  for (const [k, v] of p.entries()) roh[k] = v;
  const filter = filterAusSearchParams(roh);
  const sicht = p.get("sicht") ?? "alle";

  const leereMap = new Map<string, VergabeDaten[]>();
  const [bioRoh, outRoh, vergabenBio, vergabenOut] = await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
    sicht !== "outputs" ? ladeAlleVergaben("biomasse") : Promise.resolve(leereMap),
    sicht !== "feedstock" ? ladeAlleVergaben("output") : Promise.resolve(leereMap),
  ]);
  // Neue Felder (AP1j): heutiger Verfuegbarkeitsstatus + Vergaben je Zeile.
  const stichtag = new Date().toISOString().slice(0, 10);
  const bio = reichereVerfuegbarkeitAn(bioRoh, vergabenBio, stichtag);
  const out = reichereVerfuegbarkeitAn(outRoh, vergabenOut, stichtag);
  const rows = [...filterStroeme(bio, filter), ...filterStroeme(out, filter)];
  const vergabenVon = (s: Strom) =>
    ((s.art === "biomasse" ? vergabenBio : vergabenOut).get(s.id) ?? [])
      .map(
        (v) =>
          `${vergabeLabel(v.vergebenVon, v.vergebenBis)} an ${v.vergebenAn ?? "–"} (${v.anBhyo ? "bhyo" : "extern"})`,
      )
      .join(" | ");

  const header = [
    "Art",
    // F4-Review: die Belegnummer gehoert in den Export — sie ist die
    // Referenz, mit der man ausserhalb des Tools ueber einen Beleg spricht.
    "Belegnummer",
    "Bezeichnung",
    "Akteur",
    "Ort",
    "Landkreis",
    "Cluster/Gruppe",
    "Materialart/Produkt",
    "Zeitraum von",
    "Zeitraum bis",
    "Menge",
    "Einheit",
    "Qualitaet",
    "Status",
    "Verfuegbarkeitsstatus (heute)",
    "Reserviert (bhyo)",
    "Reserviert seit",
    "Vergaben",
  ];
  const lines = [header.map(csvFeld).join(";")];
  for (const s of rows) {
    const feed = s.art === "biomasse";
    lines.push(
      [
        feed ? "Feedstock" : "Output",
        s.beleg?.nr ?? "",
        s.bezeichnung,
        s.akteurName,
        s.ort,
        kreisAnzeige(s),
        feed ? s.cluster : s.gruppeLabel,
        feed ? s.materialartLabel : s.produktLabel,
        s.zeitraumVon,
        s.zeitraumBis,
        // E20: Mengen ganzzahlig — der CSV zaehlt als Darstellung.
        feed
          ? (s.mengeAtro == null ? "" : Math.round(s.mengeAtro))
          : (s.mengeWert == null ? "" : Math.round(s.mengeWert)),
        feed ? "t atro/a" : s.mengeEinheit,
        s.qualitaet,
        s.status,
        s.verfuegbarkeit
          ? verfuegbarkeitPill(s.art, s.verfuegbarkeit.status).text
          : "",
        s.reserviertBhyo ? "ja" : "nein",
        s.reserviertSeit ?? "",
        vergabenVon(s),
      ]
        .map(csvFeld)
        .join(";"),
    );
  }
  // BOM, damit Excel UTF-8 korrekt liest; CRLF-Zeilen.
  const csv = "﻿" + lines.join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="auswertung.csv"',
      "Cache-Control": "no-store",
    },
  });
}
