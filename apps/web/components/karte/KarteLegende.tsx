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
 * (Doppelklick = auf/zu, Pfeiltasten ±24 px), vier Gruppen — Cluster und
 * Output-Gruppe (Orbs, klick-filtern), Rand = Qualitaet,
 * Regionen mit Sichtbarkeitsschaltern. Offen/Hoehe/Regionsschalter leben im
 * Cookie bhyo_ui und ueberleben Einklappen und Reload.
 */
export function KarteLegende({
  punkte,
  gesamt,
  umrisseAn,
  onUmrisseToggle,
  onClusterKlick,
  onGruppeKlick,
  auswahlCluster,
  auswahlGruppe,
  initial,
}: {
  punkte: KartePunkt[];
  gesamt: number;
  /** Master-Toggle regionsumrisse. (Review Eric: ohne Einzelauswahl). */
  umrisseAn: boolean;
  onUmrisseToggle: () => void;
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
  const [zieht, setZieht] = useState(false);
  const dragRef = useRef<{ startY: number; startHoehe: number } | null>(null);

  function speichere(patch: { offen?: boolean; hoehe?: number }) {
    const aktuell = updateUiCookie({}).legende;
    updateUiCookie({
      legende: {
        offen: patch.offen ?? offen,
        hoehe: patch.hoehe ?? hoehe,
        umrisse: aktuell?.umrisse ?? umrisseAn,
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
    setZieht(true);
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
    setZieht(false);
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
      className={`km-legende${offen ? "" : " zu"}${zieht ? " ziehen" : ""}`}
      aria-label="Legende"
      style={{ maxHeight: offen ? hoehe : 48 }}
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
                <img
                  className="km-leg-orb"
                  src={`/orbs/cluster/${k}.webp`}
                  alt=""
                  aria-hidden
                  width={18}
                  height={18}
                />
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
                {k === "add_ons" ? (
                  <i className="km-leg-kreis" style={{ background: farbe }} aria-hidden />
                ) : (
                  <img
                    className="km-leg-orb"
                    src={`/orbs/output/${k}.webp`}
                    alt=""
                    aria-hidden
                    width={18}
                    height={18}
                  />
                )}
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

          <div className="km-leg-grp">
            <h3>regionsumrisse.</h3>
            <button
              type="button"
              className="km-leg-zeile"
              aria-pressed={umrisseAn}
              onClick={onUmrisseToggle}
            >
              <span className="lbl">Umrisse anzeigen</span>
              <span
                className="toggle toggle--sm"
                role="presentation"
                aria-checked={umrisseAn}
                style={{ pointerEvents: "none" }}
              />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
