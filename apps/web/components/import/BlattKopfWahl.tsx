"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BlattInfo } from "@/lib/import-datei";

/**
 * Blatt und Kopfzeile (AP2.7 PR e, Eric 07.10.2026): alle Blaetter mit
 * Zeilenzahl, leere oder tabellenlose Blaetter markiert, nicht verboten; die
 * Kopfzeile ist erkannt und von Hand korrigierbar, mit Vorschau. Die Wahl
 * reist als ?blatt=&kopf= zur Seite (der Server parst erneut) und wird mit
 * der Zuordnung gespeichert — die Zeilennummern bleiben die der Datei.
 */
export function BlattKopfWahl({
  laufId,
  blaetter,
  blatt,
  kopfzeile,
  vorschau,
  uebersprungen,
  vorlage,
}: {
  laufId: string;
  blaetter: BlattInfo[];
  blatt: string;
  kopfzeile: number;
  vorschau: string[][];
  uebersprungen: { oben: number; leer: number; summe: number; fuss: number };
  vorlage: string | null;
}) {
  const router = useRouter();
  const [kopf, setKopf] = useState(String(kopfzeile));

  function navigiere(b: string, k: string) {
    const p = new URLSearchParams();
    p.set("blatt", b);
    if (k) p.set("kopf", k);
    if (vorlage) p.set("vorlage", vorlage);
    router.push(`/import/${laufId}?${p}`);
  }

  return (
    <section className="imp-blatt">
      <header className="einst-kopf">
        <h3>blatt und kopfzeile.</h3>
        <p className="c">
          Zeilen über der Kopfzeile werden ignoriert; darunter werden Leerzeilen, eine Summenzeile („Summe“, „Gesamt“ oder
          Formel) und Fußzeilen übersprungen und gezählt. Erkannt: Kopfzeile ist Zeile {kopfzeile}.
        </p>
      </header>
      <div className="fp-zeile">
        <label className="pf">
          <span>Tabellenblatt</span>
          <span className="pf-feld">
            <select value={blatt} onChange={(e) => navigiere(e.target.value, "")}>
              {blaetter.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} · {b.zeilen} Zeile(n){b.tabelle ? "" : " · keine Tabelle erkannt"}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="pf adr-kurz">
          <span>Kopfzeile ist Zeile</span>
          <span className="pf-feld">
            <input
              type="number"
              min={1}
              value={kopf}
              onChange={(e) => setKopf(e.target.value)}
              onBlur={() => kopf && Number(kopf) !== kopfzeile && navigiere(blatt, kopf)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  navigiere(blatt, kopf);
                }
              }}
            />
          </span>
        </label>
      </div>
      <table className="einst-tabelle imp-tabelle imp-vorschau">
        <tbody>
          {vorschau.map((z, i) => (
            <tr key={i} className={i === 0 ? "imp-vorschau-kopf" : undefined}>
              <td className="c">{kopfzeile + i}</td>
              {z.slice(0, 8).map((t, j) => (
                <td key={j}>{t || "·"}</td>
              ))}
              {z.length > 8 && <td className="c">… {z.length - 8} weitere</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="c">
        Übersprungen: {uebersprungen.oben} über der Kopfzeile · {uebersprungen.leer} leer · {uebersprungen.summe} Summe ·{" "}
        {uebersprungen.fuss} Fußzeile(n)
      </span>
    </section>
  );
}
