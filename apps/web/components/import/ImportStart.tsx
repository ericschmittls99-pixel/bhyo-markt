"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { importDateiHochladen, type ImportLaufErgebnis } from "@/lib/import-actions";
import { IMPORT_ART_LABEL } from "@/lib/import-modell";
import { BELEG_LABEL, BELEG_TYPEN } from "@/lib/qualitaet";

/**
 * import. — Start eines Laufs (AP2.7 PR b, E67): Datei, Art des Laufs,
 * Belegtyp je Lauf (Pflicht, eine Spalte darf ihn je Zeile ueberschreiben)
 * und Standard-Sektor neuer Akteure (Pflichtauswahl, „ohne Sektor" erlaubt).
 * Nach dem Upload geht es zur Zuordnung des Laufs.
 */
export function ImportStart({ sektoren }: { sektoren: { code: string; label: string }[] }) {
  const router = useRouter();
  const [status, action, laeuft] = useActionState<ImportLaufErgebnis, FormData>(importDateiHochladen, {});
  useEffect(() => {
    if (status.ok && status.id) router.push(`/import/${status.id}`);
  }, [status, router]);

  return (
    <form action={action} className="einst-anlegen imp-start">
      <label className="pf imp-start-datei">
        <span>Datei (CSV oder Excel, bis 5 MB / 5.000 Zeilen)</span>
        <span className="pf-feld">
          <input type="file" name="datei" accept=".csv,.xlsx,.xlsm,.xls" required />
        </span>
      </label>
      <label className="pf">
        <span>Art des Laufs</span>
        <span className="pf-feld">
          <select name="art" defaultValue="biomasse">
            {(Object.keys(IMPORT_ART_LABEL) as (keyof typeof IMPORT_ART_LABEL)[]).map((a) => (
              <option key={a} value={a}>
                {IMPORT_ART_LABEL[a]}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="pf">
        <span>Belegtyp je Lauf</span>
        <span className="pf-feld">
          <select name="beleg_typ" defaultValue="betriebsdaten">
            {BELEG_TYPEN.map((t) => (
              <option key={t} value={t}>
                {BELEG_LABEL[t]}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="pf">
        <span>Sektor neuer Akteure ohne Spaltenwert</span>
        <span className="pf-feld">
          <select name="standard_sektor" defaultValue="ohne_sektor">
            {sektoren.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      <button type="submit" className="btn btn--primary btn--sm" disabled={laeuft}>
        <i className="ph ph-upload-simple" aria-hidden />
        {laeuft ? "Wird gelesen …" : "Hochladen und zuordnen"}
      </button>
      {status.feldFehler?.dateiname && <p className="pf-fehler einst-fehler">{status.feldFehler.dateiname}</p>}
      {status.feldFehler && !status.feldFehler.dateiname && (
        <p className="pf-fehler einst-fehler">{Object.values(status.feldFehler).join(" · ")}</p>
      )}
      {status.fehler && <p className="pf-fehler einst-fehler">{status.fehler}</p>}
    </form>
  );
}
