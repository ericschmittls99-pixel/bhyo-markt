"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { kontaktpersonAnlegen, kontaktpersonAuskunftErstellen, kontaktpersonBearbeiten, kontaktpersonLoeschen } from "@/lib/kontaktperson-actions";
import { KONTAKT_GRENZEN, NOTIZ_HINWEIS, type Kontaktperson } from "@/lib/kontaktperson-modell";
import { fmtDatum } from "@/lib/format";

/**
 * Reiter Kontaktpersonen (AP2.5 PR b, E66): lesen alle mit Zugang, anlegen und
 * bearbeiten ab bearbeiter, loeschen Pruefer/Admin (echtes Loeschen, mit
 * Bestaetigung), Auskunft (Art. 15) nur Admin. Jede Person gehoert zu genau
 * diesem Akteur — es gibt kein Feld zum Umhaengen. Am Notizfeld steht der
 * Hinweis „Keine privaten oder sensiblen Angaben".
 */
export function Kontaktpersonen({
  akteurId,
  personen,
  darfSchreiben,
  darfLoeschen,
  darfAuskunft,
}: {
  akteurId: string;
  personen: Kontaktperson[];
  darfSchreiben: boolean;
  darfLoeschen: boolean;
  darfAuskunft: boolean;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState<"neu" | string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function speichern(id: "neu" | string, fd: FormData) {
    start(async () => {
      const erg = id === "neu" ? await kontaktpersonAnlegen(akteurId, fd) : await kontaktpersonBearbeiten(id, fd);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
        return;
      }
      setFehler(null);
      setOffen(null);
      router.refresh();
    });
  }
  // Auskunft (Art. 15): die Aktion schreibt das Ereignis und oeffnet danach die Druckansicht.
  function auskunft(id: string) {
    start(async () => {
      const erg = await kontaktpersonAuskunftErstellen(id);
      if (!erg.ok || !erg.ereignisId) {
        setFehler(erg.fehler ?? "Auskunft fehlgeschlagen.");
        return;
      }
      router.push(`/akteure/${akteurId}/kontaktpersonen/${id}/auskunft?ereignis=${erg.ereignisId}`);
    });
  }
  function loeschen(id: string) {
    start(async () => {
      const erg = await kontaktpersonLoeschen(id);
      setConfirm(null);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Löschen fehlgeschlagen.");
        return;
      }
      setFehler(null);
      router.refresh();
    });
  }

  const formular = (p: Kontaktperson | null) => (
    <form
      className="ak-formular kp-formular"
      onSubmit={(e) => {
        e.preventDefault();
        speichern(p?.id ?? "neu", new FormData(e.currentTarget));
      }}
    >
      <label className="pf">
        <span>
          Name<em className="pf-pflicht" aria-hidden> *</em>
        </span>
        <span className="pf-feld">
          <input type="text" name="name" defaultValue={p?.name ?? ""} required maxLength={KONTAKT_GRENZEN.name} />
        </span>
      </label>
      <label className="pf">
        <span>Funktion</span>
        <span className="pf-feld">
          <input type="text" name="funktion" defaultValue={p?.funktion ?? ""} maxLength={KONTAKT_GRENZEN.funktion} />
        </span>
      </label>
      <label className="pf">
        <span>E-Mail (dienstlich)</span>
        <span className="pf-feld">
          <input type="email" name="mail_dienstlich" defaultValue={p?.mailDienstlich ?? ""} maxLength={KONTAKT_GRENZEN.mailDienstlich} />
        </span>
      </label>
      <label className="pf">
        <span>Telefon</span>
        <span className="pf-feld">
          <input type="text" name="telefon" defaultValue={p?.telefon ?? ""} maxLength={KONTAKT_GRENZEN.telefon} />
        </span>
      </label>
      <label className="pf">
        <span>Notiz</span>
        <span className="pf-feld">
          <textarea name="notiz" rows={3} defaultValue={p?.notiz ?? ""} maxLength={KONTAKT_GRENZEN.notiz} />
        </span>
        <span className="c kp-notiz-hinweis">{NOTIZ_HINWEIS}</span>
      </label>
      {fehler && (
        <p className="pf-fehler" role="alert">
          {fehler}
        </p>
      )}
      <div className="ak-aktionen">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          Speichern
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => { setOffen(null); setFehler(null); }}>
          Abbrechen
        </button>
      </div>
    </form>
  );

  return (
    <div className="kp">
      <p className="ov-note">Jede Kontaktperson gehört zu genau diesem Akteur. Wechselt jemand den Arbeitgeber, wird dort eine neue Person angelegt.</p>
      {personen.length === 0 && offen !== "neu" && <p className="ov-note">Noch keine Kontaktperson erfasst.</p>}
      {personen.length > 0 && (
        <table className="einst-tabelle ak-tabelle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Funktion</th>
              <th>Kontakt</th>
              <th>Letzte Aktivität</th>
              <th className="param-aktionen">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {personen.map((p) => (
              <tr key={p.id}>
                {offen === p.id ? (
                  <td colSpan={5}>{formular(p)}</td>
                ) : (
                  <>
                    <td>
                      <strong>{p.name}</strong>
                      {p.notiz && <div className="c kp-notiz">{p.notiz}</div>}
                    </td>
                    <td>{p.funktion ?? <span className="c">–</span>}</td>
                    <td>
                      {p.mailDienstlich ? <a href={`mailto:${p.mailDienstlich}`}>{p.mailDienstlich}</a> : <span className="c">–</span>}
                      {p.telefon && <div className="c">{p.telefon}</div>}
                    </td>
                    <td>{p.letzteAktivitaet ? fmtDatum(p.letzteAktivitaet) : <span className="c">–</span>}</td>
                    <td className="param-aktionen">
                      {darfSchreiben && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => { setOffen(p.id); setFehler(null); }}>
                          Bearbeiten
                        </button>
                      )}
                      {darfAuskunft && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => auskunft(p.id)}>
                          Auskunft erstellen
                        </button>
                      )}
                      {darfLoeschen && confirm !== p.id && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => setConfirm(p.id)}>
                          Löschen
                        </button>
                      )}
                      {darfLoeschen && confirm === p.id && (
                        <span className="ak-confirm">
                          <span>Endgültig löschen? Backups halten die Daten noch 30 Tage.</span>
                          <button type="button" className="btn btn--primary btn--sm" disabled={pending} onClick={() => loeschen(p.id)}>
                            Ja, löschen
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => setConfirm(null)}>
                            Abbrechen
                          </button>
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {offen === "neu" ? (
        formular(null)
      ) : (
        darfSchreiben && (
          <div className="ak-aktionen">
            <button type="button" className="btn btn--sm" disabled={pending} onClick={() => { setOffen("neu"); setFehler(null); }}>
              <i className="ph ph-user-plus" aria-hidden />
              Kontaktperson anlegen
            </button>
          </div>
        )
      )}
      {fehler && offen === null && (
        <p className="pf-fehler" role="alert">
          {fehler}
        </p>
      )}
    </div>
  );
}
