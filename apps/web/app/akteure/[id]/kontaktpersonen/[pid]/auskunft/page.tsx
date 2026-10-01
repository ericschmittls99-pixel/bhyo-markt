import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shell/EmptyState";
import { ladeAkteur } from "@/lib/akteure";
import { withDb } from "@/lib/db";
import { fmtDatum, fmtDatumZeit } from "@/lib/format";
import { ladeKontaktperson, ladeKontaktpersonEreignisse } from "@/lib/kontaktpersonen";
import { STANDARDTEXT } from "@/lib/protokoll";
import { darfRolle } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * Auskunft je Person (Art. 15 DSGVO, AP2.5 PR b): Druckansicht ueber die
 * Druck-Route-Idee aus F6 — gedruckt wird aus dem Browser als PDF. Nur Admin
 * (kontaktperson.auskunft, fail closed). Enthaelt alle gespeicherten Felder
 * und alle Protokollereignisse zur Person; deren Freitext traegt nur IDs und
 * Feldnamen (E57).
 */
export default async function AuskunftSeite({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt" || !darfRolle(zugang, "kontaktperson.auskunft")) {
    return (
      <main className="ak ak-leer">
        <EmptyState icon="buildings" titel="Auskunft." beschreibung="Diese Ansicht ist Admins vorbehalten." />
      </main>
    );
  }
  const [person, akteur, ereignisse] = await Promise.all([
    withDb((db) => ladeKontaktperson(db, pid)),
    withDb((db) => ladeAkteur(db, id)),
    withDb((db) => ladeKontaktpersonEreignisse(db, pid)),
  ]);
  if (!person || !akteur || person.akteurId !== akteur.id) notFound();
  const felder: [string, string | null][] = [
    ["Name", person.name],
    ["Funktion", person.funktion],
    ["E-Mail (dienstlich)", person.mailDienstlich],
    ["Telefon", person.telefon],
    ["Notiz", person.notiz],
    ["Akteur", `${akteur.name} (${akteur.id})`],
    ["Angelegt", fmtDatumZeit(person.erstelltAm)],
    ["Zuletzt geändert", fmtDatumZeit(person.geaendertAm)],
    ["Letzte Aktivität", person.letzteAktivitaet ? fmtDatum(person.letzteAktivitaet) : null],
    ["Kennung", person.id],
  ];
  return (
    <main className="druck druck--intern kp-auskunft">
      <div className="druck-aktionen">
        <span className="c">Auskunft nach Art. 15 DSGVO — gedruckt wird aus dem Browser als PDF. Nur für den Betroffenen bestimmt.</span>
      </div>
      <header className="druck-kopf">
        <h1>bhyo · Auskunft zur Kontaktperson</h1>
        <p className="druck-modus">Alle gespeicherten Angaben und alle Protokollereignisse zu dieser Person.</p>
      </header>
      <section className="druck-blatt">
        <h2>Gespeicherte Angaben</h2>
        <table className="einst-tabelle">
          <tbody>
            {felder.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="druck-blatt">
        <h2>Protokollereignisse ({ereignisse.length})</h2>
        {ereignisse.length === 0 ? (
          <p className="druck-leer">Keine Ereignisse.</p>
        ) : (
          <table className="einst-tabelle">
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Ereignis</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {ereignisse.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDatumZeit(e.zeitpunkt)}</td>
                  <td>{(STANDARDTEXT as Record<string, string>)[e.art] ?? e.art}</td>
                  <td>{e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <footer className="druck-fuss">Backups halten gelöschte Daten noch 30 Tage (docs/betrieb.md).</footer>
    </main>
  );
}
