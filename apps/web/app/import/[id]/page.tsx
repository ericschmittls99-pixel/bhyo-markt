import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shell/EmptyState";
import { withDb } from "@/lib/db";
import { IMPORT_ART_LABEL, IMPORT_LAUF_STATUS_LABEL } from "@/lib/import-modell";
import { ladeGleicheDatei, ladeImportLauf } from "@/lib/import-server";
import { BELEG_LABEL } from "@/lib/qualitaet";
import { darf } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * Ein Import-Lauf (AP2.7 PR b, E67): Kopf mit Datei, Art, Belegtyp und
 * Zaehlern; Warnung bei gleichem Datei-Hash wie ein frueherer Lauf. Die
 * Zuordnung der Spalten folgt in diesem PR direkt darunter.
 */
export default async function ImportLaufPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt" || !darf(zugang, "import.ausfuehren")) {
    return (
      <main className="einst-leer">
        <EmptyState icon="upload-simple" titel="import." beschreibung="Der Import ist Prüfern und Admins vorbehalten." />
      </main>
    );
  }
  const lauf = await withDb((db) => ladeImportLauf(db, id));
  if (!lauf) notFound();
  const gleiche = await withDb((db) => ladeGleicheDatei(db, lauf.dateiHash, lauf.id));
  const datum = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  return (
    <main className="einst imp">
      <div className="einst-inhalt">
        <header className="einst-kopf">
          <p className="c">
            <Link href="/import">import.</Link> · Lauf
          </p>
          <h2>{lauf.dateiname}</h2>
          <p className="c">
            <span className="pill pill--status pill--muted">{IMPORT_LAUF_STATUS_LABEL[lauf.status as keyof typeof IMPORT_LAUF_STATUS_LABEL] ?? lauf.status}</span>{" "}
            {IMPORT_ART_LABEL[lauf.art as keyof typeof IMPORT_ART_LABEL] ?? lauf.art} · Belegtyp{" "}
            {BELEG_LABEL[lauf.belegTyp as keyof typeof BELEG_LABEL] ?? lauf.belegTyp} · {lauf.zaehler?.zeilen ?? "—"} Zeilen,{" "}
            {lauf.zaehler?.spalten ?? "—"} Spalten · angelegt {datum.format(lauf.createdAt)}
            {lauf.erstellerEmail ? ` von ${lauf.erstellerEmail}` : ""}
          </p>
        </header>
        {gleiche.length > 0 && (
          <div className="hinweis-box">
            <i className="ph ph-warning" aria-hidden />
            <div>
              Dieselbe Datei (gleicher SHA-256) wurde schon hochgeladen:{" "}
              {gleiche.map((g, i) => (
                <span key={g.id}>
                  {i > 0 && ", "}
                  <Link href={`/import/${g.id}`}>{g.dateiname}</Link> ({IMPORT_LAUF_STATUS_LABEL[g.status as keyof typeof IMPORT_LAUF_STATUS_LABEL] ?? g.status},{" "}
                  {datum.format(g.createdAt)})
                </span>
              ))}
              . Ein zweiter Lauf legt die Ströme erneut an.
            </div>
          </div>
        )}
        <section className="hinweis-box">
          <i className="ph ph-columns" aria-hidden />
          <div>Die Zuordnung der Spalten folgt als nächster Schritt dieses PR.</div>
        </section>
      </div>
    </main>
  );
}
