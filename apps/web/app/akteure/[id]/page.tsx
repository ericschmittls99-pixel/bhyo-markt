import Link from "next/link";
import { notFound } from "next/navigation";

import { AkteurKarte } from "@/components/akteure/AkteurKarte";
import { AkteurStammdaten } from "@/components/akteure/AkteurStammdaten";
import { Kontaktpersonen } from "@/components/akteure/Kontaktpersonen";
import { EmptyState } from "@/components/shell/EmptyState";
import { ladeAkteur, ladeAkteurStroeme } from "@/lib/akteure";
import { AKTEUR_ZUSTAND_LABEL, zustaendeAus } from "@/lib/akteure-modell";
import { withDb } from "@/lib/db";
import { fmtDatum } from "@/lib/format";
import { ladeKontaktpersonen } from "@/lib/kontaktpersonen";
import { darfRolle } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { ladeSektoren } from "@/lib/register";
import { STATUS_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * Akteur-Detail (AP2.5 PR a1): Stammdaten mit Sitz (bearbeiten ab bearbeiter,
 * ohne Sperre), die Belege/Stroeme des Akteurs mit ihren Standorten, die
 * Karte mit Sitz-Pin und Strom-Standorten unterscheidbar; loeschen nur admin
 * und nur verwaist. Der Reiter Kontaktpersonen folgt mit PR b.
 */
export default async function AkteurSeite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const reiter = (Array.isArray(sp.reiter) ? sp.reiter[0] : sp.reiter) === "kontaktpersonen" ? "kontaktpersonen" : "stammdaten";
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") {
    return (
      <main className="ak ak-leer">
        <EmptyState icon="buildings" titel="akteure." beschreibung="Kein Zugang." />
      </main>
    );
  }
  const [a, stroeme, sektoren, personen] = await Promise.all([
    withDb((db) => ladeAkteur(db, id)),
    withDb((db) => ladeAkteurStroeme(db, id)),
    ladeSektoren(),
    withDb((db) => ladeKontaktpersonen(db, id)),
  ]);
  if (!a) notFound();
  const zustaende = zustaendeAus(a);
  const darfBearbeiten = darfRolle(zugang, "akteur.bearbeiten");
  const darfLoeschen = darfRolle(zugang, "akteur.loeschen") && a.stroeme === 0;
  return (
    <main className="ak ak-detail">
      <div className="ak-detail-kopf">
        <div className="ak-titel">
          <Link href="/akteure" className="btn btn--ghost btn--sm">
            <i className="ph ph-arrow-left" aria-hidden />
            akteure.
          </Link>
          <h2>{a.name}</h2>
          <span className="ak-pillen">
            <span className="pill pill--accent">{a.sektorLabel}</span>
            {zustaende.map((w) => (
              <span key={w} className="pill pill--muted">
                {AKTEUR_ZUSTAND_LABEL[w]}
              </span>
            ))}
            {a.verwaistSeit && <span className="c">seit {fmtDatum(a.verwaistSeit)}</span>}
          </span>
        </div>
        <div className="seg" role="tablist" aria-label="Reiter">
          <Link href={`/akteure/${a.id}`} className="seg-opt" aria-pressed={reiter === "stammdaten"}>
            Stammdaten
          </Link>
          <Link href={`/akteure/${a.id}?reiter=kontaktpersonen`} className="seg-opt" aria-pressed={reiter === "kontaktpersonen"}>
            Kontaktpersonen{personen.length ? ` (${personen.length})` : ""}
          </Link>
        </div>
      </div>

      {reiter === "kontaktpersonen" ? (
        <section className="ov-sec ak-sec">
          <h3>kontaktpersonen.</h3>
          <Kontaktpersonen
            akteurId={a.id}
            personen={personen}
            darfSchreiben={darfRolle(zugang, "kontaktperson.anlegen")}
            darfLoeschen={darfRolle(zugang, "kontaktperson.loeschen")}
            darfAuskunft={darfRolle(zugang, "kontaktperson.auskunft")}
          />
        </section>
      ) : (
      <div className="ak-spalten">
        <section className="ov-sec ak-sec">
          <h3>stammdaten.</h3>
          <AkteurStammdaten akteur={a} sektoren={sektoren.filter((s) => s.aktiv || s.code === a.sektor)} darfBearbeiten={darfBearbeiten} darfLoeschen={darfLoeschen} />
        </section>
        <section className="ov-sec ak-sec">
          <h3>sitz und standorte.</h3>
          <AkteurKarte sitz={a.sitzLng != null && a.sitzLat != null ? { lng: a.sitzLng, lat: a.sitzLat } : null} standorte={stroeme.filter((s) => s.lng != null && s.lat != null).map((s) => ({ id: s.id, lng: s.lng!, lat: s.lat!, label: s.bezeichnung ?? s.belegNr ?? s.art }))} />
          <p className="ov-note">Grüner Pin: Sitz des Akteurs. Dunkle Pins: Standorte seiner Ströme (bleiben am Strom, F0a).</p>
          <h3>belege und ströme.</h3>
          {stroeme.length === 0 ? (
            <p className="ov-note">Kein Strom verweist auf diesen Akteur — er gilt als verwaist.</p>
          ) : (
            <table className="einst-tabelle ak-tabelle">
              <thead>
                <tr>
                  <th>Beleg</th>
                  <th>Strom</th>
                  <th>Standort</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stroeme.map((s) => (
                  <tr key={s.id}>
                    <td>{s.belegNr ?? <span className="c">ohne Beleg</span>}</td>
                    <td>
                      <Link href={`/register?sicht=${s.art === "output" ? "outputs" : "feedstock"}&detail=${s.id}`} className="ak-link">
                        {s.bezeichnung ?? "–"}
                      </Link>
                      <div className="param-schluessel">{s.art === "biomasse" ? "Feedstock" : "Output"}</div>
                    </td>
                    <td>{s.ort ?? <span className="c">–</span>}</td>
                    <td>
                      <span className="pill pill--muted">{STATUS_LABEL[s.status] ?? s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      )}
    </main>
  );
}
