import { currentUserEmail } from "@/lib/db";
import { listBiomasse, type RegisterFilter } from "@/lib/register";

export const dynamic = "force-dynamic";

function csvFeld(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV-Export der gefilterten Biomasseströme (AP1d; PDF ist AP4). */
export async function GET(req: Request) {
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const p = new URL(req.url).searchParams;
  const val = (k: string) => {
    const v = p.get(k)?.trim();
    return v ? v : undefined;
  };
  const filter: RegisterFilter = {
    regionId: val("region"),
    suche: val("q"),
    materialart: val("materialart"),
    qualitaet: val("qualitaet"),
    status: val("status"),
    landkreis: val("landkreis"),
    jahr: val("jahr"),
  };

  const rows = await listBiomasse(filter);
  const header = [
    "Bezeichnung",
    "Akteur",
    "Ort",
    "Landkreis",
    "Materialart",
    "Zeitraum von",
    "Zeitraum bis",
    "Menge (t atro)",
    "Qualitaet",
    "Status",
  ];
  const lines = [header.map(csvFeld).join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.bezeichnung,
        r.akteurName,
        r.ort,
        r.landkreis,
        r.kategorie,
        r.zeitraumVon,
        r.zeitraumBis,
        r.mengeNum,
        r.qualitaet,
        r.status,
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
