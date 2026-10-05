"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AdresseBlock } from "@/components/stroeme/AdresseBlock";
import { akteurBearbeiten, akteurLoeschen } from "@/lib/akteur-actions";
import { sitzText, type AkteurZeile } from "@/lib/akteure-modell";

/**
 * Stammdaten-Formular des Akteurs (AP2.5 PR a1): Name, Sektor (inkl. der
 * Systemzeile „ohne Sektor"), Sitz ueber den AdresseBlock (Adresse frei, PLZ
 * und Ort Pflicht, Pin ueber den Geocoder — der Kreis-ARS braucht die
 * Koordinate). Bearbeiten ab bearbeiter ohne Sperre; die Wache prueft
 * serverseitig erneut. Loeschen nur admin und nur verwaist.
 */
export function AkteurStammdaten({
  akteur,
  sektoren,
  darfBearbeiten,
  darfLoeschen,
  bearbeiten,
  setBearbeiten,
}: {
  akteur: AkteurZeile;
  sektoren: { code: string; label: string; aktiv: boolean }[];
  darfBearbeiten: boolean;
  darfLoeschen: boolean;
  /** Sitz-Erfassung d: Zustand liegt in AkteurSpalten, damit die Lese-Karte beim Bearbeiten abgehaengt wird. */
  bearbeiten: boolean;
  setBearbeiten: (v: boolean) => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function speichern(fd: FormData) {
    start(async () => {
      const erg = await akteurBearbeiten(akteur.id, fd);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
        return;
      }
      setFehler(null);
      setBearbeiten(false);
      setToast("Stammdaten gespeichert");
      router.refresh();
    });
  }

  function loeschen() {
    start(async () => {
      const erg = await akteurLoeschen(akteur.id);
      setConfirm(false);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Löschen fehlgeschlagen.");
        return;
      }
      router.push("/akteure");
      router.refresh();
    });
  }

  if (!bearbeiten) {
    return (
      <div className="ak-stammdaten">
        <div className="kv">
          <span className="kv-k">Name</span>
          <span className="kv-w">{akteur.name}</span>
          <span className="kv-k">Sektor</span>
          <span className="kv-w">{akteur.sektorLabel}</span>
          <span className="kv-k">Sitz</span>
          <span className="kv-w">{sitzText(akteur)}</span>
          <span className="kv-k">Kreis</span>
          <span className="kv-w">{akteur.kreisName ? `${akteur.kreisName} · ${akteur.kreisArs}` : "– (kein Pin oder außerhalb)"}</span>
        </div>
        {fehler && <p className="pf-fehler" role="alert">{fehler}</p>}
        {toast && <p className="ov-note">{toast}</p>}
        <div className="ak-aktionen">
          {darfBearbeiten && (
            <button type="button" className="btn btn--sm" onClick={() => setBearbeiten(true)} disabled={pending}>
              <i className="ph ph-pencil-simple" aria-hidden />
              Bearbeiten
            </button>
          )}
          {darfLoeschen && !confirm && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(true)} disabled={pending}>
              <i className="ph ph-trash" aria-hidden />
              Löschen (verwaist)
            </button>
          )}
          {darfLoeschen && confirm && (
            <span className="ak-confirm">
              <span>Endgültig löschen? Kein Strom verweist auf diesen Akteur.</span>
              <button type="button" className="btn btn--primary btn--sm" onClick={loeschen} disabled={pending}>
                Ja, löschen
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)} disabled={pending}>
                Abbrechen
              </button>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      className="ak-formular"
      onSubmit={(e) => {
        e.preventDefault();
        speichern(new FormData(e.currentTarget));
      }}
    >
      <label className="pf">
        <span>
          Name<em className="pf-pflicht" aria-hidden> *</em>
        </span>
        <span className="pf-feld">
          <input type="text" name="name" defaultValue={akteur.name} required maxLength={200} />
        </span>
      </label>
      <label className="pf">
        <span>
          Sektor<em className="pf-pflicht" aria-hidden> *</em>
        </span>
        <span className="pf-feld">
          <select name="sektor" defaultValue={akteur.sektor}>
            {sektoren.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
                {s.aktiv ? "" : " (deaktiviert)"}
              </option>
            ))}
          </select>
        </span>
      </label>
      <p className="ov-note">
        Sitz des Akteurs — PLZ, Ort und Pin sind Pflicht. Der Pin kommt aus der Adresssuche, von einem Standort dieses Akteurs
        („Adresse von bestehendem Standort übernehmen") oder per Klick in die Karte; er bestimmt den Kreis (E25).
      </p>
      <AdresseBlock
        initial={{
          strasse: akteur.sitzStrasse ?? "",
          hausnummer: akteur.sitzHausnummer ?? "",
          plz: akteur.sitzPlz ?? "",
          ort: akteur.sitzOrt ?? "",
          lat: akteur.sitzLat != null ? String(akteur.sitzLat) : "",
          lng: akteur.sitzLng != null ? String(akteur.sitzLng) : "",
        }}
        akteurId={akteur.id}
        fehler={fehler ?? undefined}
        hinweisOhnePin="Ohne Pin ist der Kreis des Sitzes nicht bestimmbar — Adresse suchen, vom Standort übernehmen oder Pin in der Karte setzen."
      />
      <div className="ak-aktionen">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
          Speichern
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setBearbeiten(false); setFehler(null); }} disabled={pending}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
