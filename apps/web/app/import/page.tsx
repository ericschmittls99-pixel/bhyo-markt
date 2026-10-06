import Link from "next/link";

import { ImportStart } from "@/components/import/ImportStart";
import { EmptyState } from "@/components/shell/EmptyState";
import { withDb } from "@/lib/db";
import { IMPORT_ART_LABEL, IMPORT_LAUF_STATUS_LABEL } from "@/lib/import-modell";
import { ladeImportLaeufe } from "@/lib/import-server";
import { BELEG_LABEL } from "@/lib/qualitaet";
import { darf } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { ladeSektoren } from "@/lib/register";

export const dynamic = "force-dynamic";

/**
 * import. (AP2.7 PR b, E67): Start eines Laufs und die Liste der Laeufe.
 * Nur Pruefer und Admin (import.ausfuehren) — die Oberflaeche blendet aus,
 * entschieden wird in der Action.
 */
export default async function ImportPage() {
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt" || !darf(zugang, "import.ausfuehren")) {
    return (
      <main className="einst-leer">
        <EmptyState icon="upload-simple" titel="import." beschreibung="Der Import ist Prüfern und Admins vorbehalten." />
      </main>
    );
  }
  const [laeufe, sektoren] = await Promise.all([withDb((db) => ladeImportLaeufe(db)), ladeSektoren()]);
  const datum = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  return (
    <main className="einst imp">
      <div className="einst-inhalt">
        <header className="einst-kopf">
          <h2>import.</h2>
          <p className="c">
            Eine Datei, eine Art, ein Belegtyp: Der Lauf legt Ströme samt Akteur als Entwurf an — keine Akteure allein,
            keine Kontaktpersonen. Personen-Spalten werden erkannt und nie übernommen.
          </p>
        </header>
        <ImportStart sektoren={sektoren.filter((s) => s.aktiv).map((s) => ({ code: s.code, label: s.label }))} />
        {laeufe.length === 0 ? (
          <p className="einst-fuss">Noch kein Lauf.</p>
        ) : (
          <table className="einst-tabelle">
            <thead>
              <tr>
                <th>Datei</th>
                <th>Art</th>
                <th>Belegtyp</th>
                <th>Zeilen</th>
                <th>importiert · Fehler · übersprungen</th>
                <th>Zustand</th>
                <th>Angelegt</th>
              </tr>
            </thead>
            <tbody>
              {laeufe.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/import/${l.id}`}>{l.dateiname}</Link>
                  </td>
                  <td>{IMPORT_ART_LABEL[l.art as keyof typeof IMPORT_ART_LABEL] ?? l.art}</td>
                  <td>{BELEG_LABEL[l.belegTyp as keyof typeof BELEG_LABEL] ?? l.belegTyp}</td>
                  <td className="kv--num">{l.zaehler?.zeilen ?? "—"}</td>
                  <td className="kv--num">
                    {l.zaehler?.importiert ?? 0} · {l.zaehler?.fehler ?? 0} · {l.zaehler?.uebersprungen ?? 0}
                  </td>
                  <td>
                    <span className="pill pill--status pill--muted">
                      {IMPORT_LAUF_STATUS_LABEL[l.status as keyof typeof IMPORT_LAUF_STATUS_LABEL] ?? l.status}
                    </span>
                  </td>
                  <td>
                    {datum.format(l.createdAt)}
                    {l.erstellerEmail ? ` · ${l.erstellerEmail}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
