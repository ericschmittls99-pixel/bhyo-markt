"use client";

import { useActionState, useState, useTransition } from "react";

import { aktivSetzen, benutzerAnlegen, rolleSetzen } from "@/lib/benutzer-actions";
import { aktiveAdmins, type BenutzerZeile } from "@/lib/benutzer-regeln";
import { Avatar } from "@/components/Avatar";
import { ROLLEN, ROLLE_LABEL, type Rolle } from "@/lib/rechte";

export interface BenutzerAnzeige extends BenutzerZeile {
  /** E44: benutzer.id fuer den Avatar (Farbe aus der ID). */
  id: string;
  name: string | null;
  erstelltAm: string;
}

/**
 * Benutzerverwaltung (F8/E30 PR C). Gelöscht wird nicht — nur deaktiviert,
 * wie bei den Referenzdaten (CLAUDE.md).
 *
 * Die Oberfläche sperrt den letzten aktiven Admin sichtbar, damit niemand
 * erst nach dem Klick erfährt, dass es nicht geht. Der tragende Schutz sitzt
 * trotzdem in der Aktion: Wer sie direkt aufruft, sieht diese Seite nie.
 */
export function BenutzerVerwaltung({
  benutzer,
  ichSelbst,
}: {
  benutzer: BenutzerAnzeige[];
  ichSelbst: string;
}) {
  const [anlegenStatus, anlegenAction, anlegenLaeuft] = useActionState(benutzerAnlegen, {
    ok: false,
  });
  const [zeilenFehler, setZeilenFehler] = useState<Record<string, string>>({});
  const [laeuft, starte] = useTransition();

  const letzterAdmin =
    aktiveAdmins(benutzer).length === 1 ? aktiveAdmins(benutzer)[0]!.email : null;

  function melde(email: string, fehler?: string) {
    setZeilenFehler((alt) => {
      const neu = { ...alt };
      if (fehler) neu[email] = fehler;
      else delete neu[email];
      return neu;
    });
  }

  return (
    <div className="einst-inhalt">
      <header className="einst-kopf">
        <h2>benutzer.</h2>
        <p className="c">
          Der Zugang kommt aus Cloudflare Access, die Rolle aus dieser Liste. Wer
          hier nicht steht, kommt nicht herein.
        </p>
      </header>

      <form action={anlegenAction} className="einst-anlegen">
        <label className="pf">
          <span>E-Mail</span>
          <span className="pf-feld">
            <input
              type="text"
              inputMode="email"
              name="email"
              placeholder="vorname.nachname@bhyo.de"
              required
            />
          </span>
        </label>
        <label className="pf">
          <span>Name optional</span>
          <span className="pf-feld">
            <input type="text" name="name" placeholder="Vorname Nachname" />
          </span>
        </label>
        <label className="pf">
          <span>Rolle</span>
          <span className="pf-feld">
            <select name="rolle" defaultValue="bearbeiter">
              {ROLLEN.map((r) => (
                <option key={r} value={r}>
                  {ROLLE_LABEL[r]}
                </option>
              ))}
            </select>
          </span>
        </label>
        <button type="submit" className="btn btn--primary btn--sm" disabled={anlegenLaeuft}>
          <i className="ph ph-plus" aria-hidden />
          Anlegen
        </button>
        {anlegenStatus.fehler && (
          <p className="pf-fehler einst-fehler">{anlegenStatus.fehler}</p>
        )}
      </form>

      <table className="einst-tabelle">
        <thead>
          <tr>
            <th>E-Mail</th>
            <th>Name</th>
            <th>Rolle</th>
            <th>Zugang</th>
            <th>Seit</th>
          </tr>
        </thead>
        <tbody>
          {benutzer.map((b) => {
            const gesperrt = b.email === letzterAdmin;
            return (
              <tr key={b.email} className={b.aktiv ? undefined : "einst-inaktiv"}>
                <td>
                  <span className="einst-avatar">
                    <Avatar nutzer={{ id: b.id, name: b.name, email: b.email }} groesse="s" />
                    {b.email}
                  </span>
                  {b.email === ichSelbst && <span className="einst-du">du</span>}
                </td>
                <td>{b.name ?? "—"}</td>
                <td>
                  <select
                    value={b.rolle}
                    aria-label={`Rolle von ${b.email}`}
                    // Gesperrt nur für den letzten aktiven Admin — die
                    // Begründung steht als Titel daneben, nicht erst nach
                    // dem Klick.
                    disabled={gesperrt || laeuft}
                    title={
                      gesperrt
                        ? "Letzter aktiver Admin — erst eine zweite Person zum Admin machen."
                        : undefined
                    }
                    onChange={(e) => {
                      const neu = e.target.value as Rolle;
                      starte(async () => {
                        const r = await rolleSetzen(b.email, neu);
                        melde(b.email, r.ok ? undefined : r.fehler);
                      });
                    }}
                  >
                    {ROLLEN.map((r) => (
                      <option key={r} value={r}>
                        {ROLLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={(gesperrt && b.aktiv) || laeuft}
                    title={
                      gesperrt && b.aktiv
                        ? "Letzter aktiver Admin — erst eine zweite Person zum Admin machen."
                        : undefined
                    }
                    onClick={() =>
                      starte(async () => {
                        const r = await aktivSetzen(b.email, !b.aktiv);
                        melde(b.email, r.ok ? undefined : r.fehler);
                      })
                    }
                  >
                    {b.aktiv ? "Deaktivieren" : "Aktivieren"}
                  </button>
                </td>
                <td className="c">{b.erstelltAm}</td>
                {zeilenFehler[b.email] && (
                  <td className="einst-fehler pf-fehler" colSpan={5}>
                    {zeilenFehler[b.email]}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="c einst-fuss">
        Gelöscht wird nicht. Ein deaktivierter Zugang bleibt als Eintrag stehen —
        die Änderungshistorie soll auf einen Namen zeigen können, auch wenn die
        Person nicht mehr hereinkommt.
      </p>
    </div>
  );
}
