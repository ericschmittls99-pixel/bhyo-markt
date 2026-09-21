import { currentUserEmail } from "@/lib/db";
import { ladeStroeme } from "@/lib/stroeme";
import {
  filterAusSearchParams,
  filterStroeme,
  type Strom,
} from "@/lib/stroeme-modell";

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
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const p = new URL(req.url).searchParams;
  const roh: Record<string, string> = {};
  for (const [k, v] of p.entries()) roh[k] = v;
  const filter = filterAusSearchParams(roh);
  const sicht = p.get("sicht") ?? "alle";

  const [bio, out] = await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
  ]);
  const rows = [...filterStroeme(bio, filter), ...filterStroeme(out, filter)];

  const header = [
    "Art",
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
  ];
  const lines = [header.map(csvFeld).join(";")];
  for (const s of rows) {
    const feed = s.art === "biomasse";
    lines.push(
      [
        feed ? "Feedstock" : "Output",
        s.bezeichnung,
        s.akteurName,
        s.ort,
        s.landkreis,
        feed ? s.cluster : s.gruppeLabel,
        feed ? s.materialartLabel : s.produktLabel,
        s.zeitraumVon,
        s.zeitraumBis,
        feed ? s.mengeAtro : s.mengeWert,
        feed ? "t atro/a" : s.mengeEinheit,
        s.qualitaet,
        s.status,
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
