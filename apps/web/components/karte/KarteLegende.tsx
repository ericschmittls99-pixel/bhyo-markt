"use client";

import { useRef, useState } from "react";

import {
  CLUSTER_FARBE,
  CLUSTER_LABEL,
  OUTPUT_FARBE,
  OUTPUT_LABEL,
  QUALITAET_RING,
} from "@/lib/farben";
import { qualitaetsRing, type KartePunkt } from "@/lib/karte-modell";
import { updateUiCookie } from "@/lib/ui-state";

const MIN_HOEHE = 96;
const MAX_HOEHE = 480;
const DEFAULT_HOEHE = 320;

/**
 * Glas-Legende von karte. (PR 6): klappbar, Hoehe per Griff ziehbar
 * (Doppelklick = auf/zu, Pfeiltasten ±24 px), vier Gruppen — Cluster (Kreis,
 * klick-filtert), Output-Gruppe (Raute, klick-filtert), Rand = Qualitaet,
 * Regionen mit Sichtbarkeitsschaltern. Offen/Hoehe/Regionsschalter leben im
 * Cookie bhyo_ui und ueberleben Einklappen und Reload.
 */
export function KarteLegende({
  punkte,
  gesamt,
  regionen,
  regionenAus,
  onRegionToggle,
  onClusterKlick,
  onGruppeKlick,
  auswahlCluster,
  auswahlGruppe,
  initial,
}: {
  punkte: KartePunkt[];
  gesamt: number;
  regionen: { id: string; name: string }[];
  regionenAus: string[];
  onRegionToggle: (id: string) => void;
  onClusterKlick: (key: string) => void;
  onGruppeKlick: (key: string) => void;
  auswahlCluster: string[];
  auswahlGruppe: string[];
  initial: { offen: boolean; hoehe?: number };
}) {
  const [offen, setOffen] = useState(initial.offen);
  const [hoehe, setHoehe] = useState(
    Math.min(MAX_HOEHE, Math.max(MIN_HOEHE, initial.hoehe ?? DEFAULT_HOEHE)),
  );
  const dragRef = useRef<{ startY: number; startHoehe: number } | null>(null);

  function speichere(patch: { offen?: boolean; hoehe?: number }) {
    const aktuell = updateUiCookie({}).legende;
    updateUiCookie({
      legende: {
        offen: patch.offen ?? offen,
        hoehe: patch.hoehe ?? hoehe,
        regionenAus: aktuell?.regionenAus ?? regionenAus,
      },
    });
  }

  function toggle() {
    const neu = !offen;
    setOffen(neu);
    speichere({ offen: neu });
  }

  function setzeHoehe(px: number) {
    const geclampt = Math.min(MAX_HOEHE, Math.max(MIN_HOEHE, px));
    setHoehe(geclampt);
    return geclampt;
  }

  function onGriffPointerDown(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, startHoehe: offen ? hoehe : MIN_HOEHE };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onGriffPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    // Legende sitzt unten: nach oben ziehen = groesser.
    const delta = dragRef.current.startY - e.clientY;
    const neu = setzeHoehe(dragRef.current.startHoehe + delta);
    if (!offen && neu > MIN_HOEHE) setOffen(true);
  }
  function onGriffPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const zu = hoehe <= MIN_HOEHE;
    if (zu) setOffen(false);
    speichere({ offen: !zu, hoehe });
  }
  function onGriffKey(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : null;
    if (delta == null) return;
    e.preventDefault();
    const neu = setzeHoehe((offen ? hoehe : MIN_HOEHE) + delta);
    const zu = neu <= MIN_HOEHE && delta < 0;
    setOffen(!zu);
    speichere({ offen: !zu, hoehe: neu });
  }

  const zaehle = (art: "biomasse" | "output", key: string) =>
    punkte.filter((p) => p.art === art && p.farbeKey === key).length;

  return (
    <section
      className={`km-legende${offen ? "" : " zu"}`}
      aria-label="Legende"
      style={offen ? { maxHeight: hoehe } : undefined}
    >
      <div
        className="km-legende-griff"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Legendenhöhe ändern"
        tabIndex={0}
        onPointerDown={onGriffPointerDown}
        onPointerMove={onGriffPointerMove}
        onPointerUp={onGriffPointerUp}
        onDoubleClick={toggle}
        onKeyDown={onGriffKey}
      >
        <span aria-hidden />
      </div>
      <header className="km-legende-kopf">
        <h2>legende.</h2>
        <span className="km-legende-zahl">
          {punkte.length} von {gesamt}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={offen}
          aria-label={offen ? "Legende einklappen" : "Legende ausklappen"}
          onClick={toggle}
        >
          <i className={`ph-bold ph-caret-${offen ? "down" : "up"}`} aria-hidden />
        </button>
      </header>

      {offen && (
        <div className="km-legende-body">
          <div className="km-leg-grp">
            <h3>cluster.</h3>
            {Object.entries(CLUSTER_FARBE).map(([k, farbe]) => (
              <button
                key={k}
                type="button"
                className={`km-leg-zeile${auswahlCluster.includes(k) ? " aktiv" : ""}`}
                onClick={() => onClusterKlick(k)}
              >
                <i className="km-leg-kreis" style={{ background: farbe }} aria-hidden />
                <span className="lbl">{CLUSTER_LABEL[k]}</span>
                <span className="anz">{zaehle("biomasse", k)}</span>
              </button>
            ))}
          </div>

          <div className="km-leg-grp">
            <h3>output-gruppe.</h3>
            {Object.entries(OUTPUT_FARBE).map(([k, farbe]) => (
              <button
                key={k}
                type="button"
                className={`km-leg-zeile${auswahlGruppe.includes(k) ? " aktiv" : ""}`}
                onClick={() => onGruppeKlick(k)}
              >
                <i className="km-leg-raute" style={{ background: farbe }} aria-hidden />
                <span className="lbl">{OUTPUT_LABEL[k]}</span>
                <span className="anz">{zaehle("output", k)}</span>
              </button>
            ))}
          </div>

          <div className="km-leg-grp">
            <h3>rand · qualität.</h3>
            <div className="km-leg-qual">
              {Object.entries(QUALITAET_RING).map(([k, farbe]) => {
                const ring = qualitaetsRing(k);
                return (
                  <span className="km-leg-qual-item" key={k}>
                    <i
                      style={{
                        borderColor: farbe,
                        borderWidth: ring.breite,
                        borderStyle: ring.stil,
                      }}
                      aria-hidden
                    />
                    {k}
                  </span>
                );
              })}
            </div>
            <p className="km-leg-hinweis">
              Größe ~ Menge (t atro/a bzw. Bedarfsmenge). Ströme ohne
              Karten-Pin erscheinen nicht.
            </p>
          </div>

          {regionen.length > 0 && (
            <div className="km-leg-grp">
              <h3>regionen.</h3>
              {regionen.map((r) => {
                const sichtbar = !regionenAus.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`km-leg-zeile${sichtbar ? "" : " aus"}`}
                    aria-pressed={sichtbar}
                    title={sichtbar ? "Umriss ausblenden" : "Umriss einblenden"}
                    onClick={() => onRegionToggle(r.id)}
                  >
                    <i
                      className={`ph ${sichtbar ? "ph-eye" : "ph-eye-slash"}`}
                      aria-hidden
                    />
                    <span className="lbl">{r.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
