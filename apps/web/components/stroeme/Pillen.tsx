import { STATUS_PILL } from "@/lib/status";

/** Qualitaets-Pille V2: nur der Buchstabe, Navy-Rampe A-D (keine Ampel). */
export function KonfidenzPill({ stufe }: { stufe: string | null }) {
  if (!stufe) return <span className="konf konf--leer">–</span>;
  return <span className={`konf konf--${stufe}`}>{stufe}</span>;
}

/** Status-Pille V2: Kleinschreibung mit Schlusspunkt, Ton je Status. */
export function StatusPillV2({ status }: { status: string }) {
  const p = STATUS_PILL[status] ?? { text: `${status}.`, tone: "quiet" };
  return <span className={`spill spill--${p.tone}`}>{p.text}</span>;
}
