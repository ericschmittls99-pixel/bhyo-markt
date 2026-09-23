import { STATUS_PILL } from "@/lib/status";
import type { StromArt } from "@/lib/stroeme-modell";
import {
  verfuegbarkeitPill,
  type VerfuegbarkeitsErgebnis,
} from "@/lib/verfuegbarkeit";

/**
 * Qualitaets-Pille V2: nur der Buchstabe, Navy-Rampe A-D (keine Ampel).
 * E24: ohne Beleg gibt es keine Stufe — Anzeige "unbelegt" (nicht "–",
 * damit der Zustand benannt ist und im Filter wiederauffindbar bleibt).
 */
export function KonfidenzPill({ stufe }: { stufe: string | null }) {
  if (!stufe || stufe === "unbelegt")
    return <span className="konf konf--leer">unbelegt</span>;
  return <span className={`konf konf--${stufe}`}>{stufe}</span>;
}

/** Status-Pille V2: Kleinschreibung mit Schlusspunkt, Ton je Status. */
export function StatusPillV2({ status }: { status: string }) {
  const p = STATUS_PILL[status] ?? { text: `${status}.`, tone: "quiet" };
  return <span className={`spill spill--${p.tone}`}>{p.text}</span>;
}

/**
 * Reservierungs-Stempel (Review 22.09.2026): kleine Bildmarke statt grosser
 * Pille — passt in dieselbe Zeile wie die Verfuegbarkeits-Pille.
 */
export function ReserviertStempel() {
  return (
    <span
      className="res-stempel"
      title="Für bhyo reserviert"
      aria-label="Für bhyo reserviert"
    >
      <img src="/logo/bhyo-mark-navy.svg" alt="" aria-hidden className="logo-light" />
      <img src="/logo/bhyo-mark-white.svg" alt="" aria-hidden className="logo-dark" />
    </span>
  );
}

/** Verfuegbarkeits-Pille (AP1j): Label-Satz je Stromart + Zusatz-Reservierung. */
export function VerfuegbarkeitsPill({
  art,
  ergebnis,
}: {
  art: StromArt;
  ergebnis: VerfuegbarkeitsErgebnis;
}) {
  const p = verfuegbarkeitPill(art, ergebnis.status);
  return (
    <>
      <span className={`spill spill--${p.tone}`}>{p.text}</span>
      {ergebnis.reserviertZusatz && <ReserviertStempel />}
    </>
  );
}
