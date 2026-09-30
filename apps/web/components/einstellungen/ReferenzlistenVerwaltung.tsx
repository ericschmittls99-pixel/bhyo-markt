"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { LABEL_MAX } from "@/lib/sektor";
import { sektorAnlegen, sektorDeaktivieren, sektorReaktivieren, sektorUmbenennen } from "@/lib/sektor-actions";
import type { SektorZeile } from "@/lib/sektor-server";

/**
 * Reiter „Referenzlisten" (AP2.3 PR b, E59): die Sektorliste. Anlegen mit
 * Bezeichnung (der Code wird abgeleitet), Umbenennen in der Zeile,
 * Deaktivieren/Reaktivieren statt Löschen — ein deaktivierter Sektor bleibt
 * an seinen Akteuren und in Filtern sichtbar, nur nicht mehr auswählbar. Die
 * tragenden Regeln sitzen in den Aktionen und in der Datenbank (Index,
 * CHECK); die Oberfläche prüft nur vorab.
 */
export function ReferenzlistenVerwaltung({ sektoren }: { sektoren: SektorZeile[] }) {
  const router = useRouter();
  const [anlegenStatus, anlegenAction, anlegenLaeuft] = useActionState(sektorAnlegen, { ok: false });
  const [laeuft, starte] = useTransition();
  const [zeilenFehler, setZeilenFehler] = useState<Record<string, string>>({});
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);

  function melde(code: string, fehler?: string) {
    setZeilenFehler((alt) => {
      const neu = { ...alt };
      if (fehler) neu[code] = fehler;
      else delete neu[code];
      return neu;
    });
  }

  function aktivSetzen(z: SektorZeile) {
    starte(async () => {
      const r = z.aktiv ? await sektorDeaktivieren(z.code) : await sektorReaktivieren(z.code);
      melde(z.code, r.ok ? undefined : r.fehler);
      if (r.ok) router.refresh();
    });
  }

  function umbenennen(z: SektorZeile, label: string) {
    starte(async () => {
      const r = await sektorUmbenennen(z.code, label);
      melde(z.code, r.ok ? undefined : r.fehler);
      if (r.ok) {
        setBearbeitet(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="einst-inhalt">
      <header className="einst-kopf">
        <h2>sektoren.</h2>
        <p className="c">
          Die Auswahlliste der Akteur-Anlage. Ein deaktivierter Sektor ist nicht mehr wählbar, bleibt aber an seinen
          Akteuren und im Filter stehen, solange er verwendet wird.
        </p>
      </header>

      <form action={anlegenAction} className="einst-anlegen">
        <label className="pf">
          <span>Neuer Sektor</span>
          <span className="pf-feld">
            <input type="text" name="label" placeholder="Bezeichnung" maxLength={LABEL_MAX} required />
          </span>
        </label>
        <button type="submit" className="btn btn--primary btn--sm" disabled={anlegenLaeuft}>
          <i className="ph ph-plus" aria-hidden />
          Anlegen
        </button>
        {anlegenStatus.fehler && <p className="pf-fehler einst-fehler">{anlegenStatus.fehler}</p>}
      </form>

      <table className="einst-tabelle ref-tabelle">
        <thead>
          <tr>
            <th>Sektor</th>
            <th>Verwendungen</th>
            <th>Status</th>
            <th aria-label="Aktionen" />
          </tr>
        </thead>
        <tbody>
          {sektoren.map((z) => (
            <tr key={z.code} className={z.aktiv ? undefined : "einst-inaktiv"}>
              <td>
                {bearbeitet === z.code ? (
                  <form
                    className="ref-umbenennen"
                    onSubmit={(e) => {
                      e.preventDefault();
                      umbenennen(z, String(new FormData(e.currentTarget).get("label") ?? ""));
                    }}
                  >
                    <span className="pf-feld">
                      <input type="text" name="label" defaultValue={z.label} maxLength={LABEL_MAX} aria-label={`Neue Bezeichnung für ${z.label}`} autoFocus required />
                    </span>
                    <button type="submit" className="btn btn--primary btn--sm" disabled={laeuft}>
                      Speichern
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBearbeitet(null)} disabled={laeuft}>
                      Abbrechen
                    </button>
                  </form>
                ) : (
                  <>
                    <strong>{z.label}</strong>
                    <div className="param-schluessel">{z.code}</div>
                  </>
                )}
              </td>
              <td className="param-wert">{z.verwendungen === 0 ? <span className="c">—</span> : `${z.verwendungen} ${z.verwendungen === 1 ? "Akteur" : "Akteure"}`}</td>
              <td>
                <span className="pill pill--status pill--muted">{z.aktiv ? "aktiv" : "deaktiviert"}</span>
              </td>
              <td className="param-aktionen">
                {bearbeitet !== z.code && (
                  <button type="button" className="btn btn--ghost btn--sm" disabled={laeuft} onClick={() => setBearbeitet(z.code)}>
                    Umbenennen
                  </button>
                )}
                <button type="button" className="btn btn--sm" disabled={laeuft} onClick={() => aktivSetzen(z)}>
                  {z.aktiv ? "Deaktivieren" : "Reaktivieren"}
                </button>
                {zeilenFehler[z.code] && <p className="pf-fehler">{zeilenFehler[z.code]}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="c einst-fuss">
        Gelöscht wird nicht. Der Code eines Sektors bleibt, auch nach einem Umbenennen — er ist der Schlüssel, an dem
        die Akteure hängen.
      </p>
    </div>
  );
}
