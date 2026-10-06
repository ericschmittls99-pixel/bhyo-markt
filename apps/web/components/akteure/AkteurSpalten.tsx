"use client";

import { useState, type ReactNode } from "react";

import { AkteurKarte } from "@/components/akteure/AkteurKarte";
import { AkteurStammdaten } from "@/components/akteure/AkteurStammdaten";
import type { AkteurZeile } from "@/lib/akteure-modell";

/**
 * Sitz-Erfassung d (05.10.2026): Die beiden Spalten der Akteur-Seite teilen
 * sich den Bearbeiten-Zustand, damit beim Bearbeiten nur EINE MapLibre-
 * Instanz lebt — die Lese-Karte wird abgehaengt, der Sitz-Pin steht dann im
 * Formular (AdresseBlock). Gemessen vorher: zwei Karten (zwei Canvases)
 * sobald das Formular offen ist. Die Stroeme-Tabelle kommt als children vom
 * Server-Teil der Seite und bleibt unveraendert.
 */
export function AkteurSpalten({
  akteur,
  sektoren,
  darfBearbeiten,
  darfLoeschen,
  sitz,
  standorte,
  children,
}: {
  akteur: AkteurZeile;
  sektoren: { code: string; label: string; aktiv: boolean }[];
  darfBearbeiten: boolean;
  darfLoeschen: boolean;
  sitz: { lng: number; lat: number } | null;
  standorte: { id: string; lng: number; lat: number; label: string }[];
  children?: ReactNode;
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  return (
    <div className="ak-spalten">
      <section className="ov-sec ak-sec">
        <h3>stammdaten.</h3>
        <AkteurStammdaten
          akteur={akteur}
          sektoren={sektoren}
          darfBearbeiten={darfBearbeiten}
          darfLoeschen={darfLoeschen}
          bearbeiten={bearbeiten}
          setBearbeiten={setBearbeiten}
        />
      </section>
      <section className="ov-sec ak-sec">
        <h3>sitz und standorte.</h3>
        {bearbeiten ? (
          <div className="ak-karte ak-karte--ruht" aria-label="Karte ruht während der Bearbeitung">
            <span className="ak-karte-platzhalter">Karte ruht während der Bearbeitung — der Sitz-Pin steht im Formular.</span>
          </div>
        ) : (
          <AkteurKarte sitz={sitz} standorte={standorte} />
        )}
        <p className="ov-note">Grüner Pin: Sitz des Akteurs. Dunkle Pins: Standorte seiner Ströme (bleiben am Strom, F0a).</p>
        {children}
      </section>
    </div>
  );
}
