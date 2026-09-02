// Reine Anzeige-Pillen. Qualitaet A-D als abgestufte Navy->Hellgrau-Pille
// (bewusst keine Ampelfarben). Deutsche Labels leben nur hier im Frontend.

const STATUS_LABEL: Record<string, string> = {
  entwurf: "Entwurf",
  in_pruefung: "in Prüfung",
  geprueft: "geprüft",
  verworfen: "verworfen",
};

export function QualitaetPill({ stufe }: { stufe: string | null }) {
  if (!stufe) return <span className="pill pill--muted">nicht bewertet</span>;
  return <span className={`pill pill--q pill--q${stufe}`}>Qualität {stufe}</span>;
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="pill pill--status">{STATUS_LABEL[status] ?? status}</span>
  );
}

/**
 * Beleg-Zelle: zeigt die Quellenangabe als Linktext. Der Link oeffnet den Beleg
 * (Datei-Route oder externer Link). Ohne Ziel bleibt es Text, ohne Beleg "kein Beleg".
 */
export function BelegLink({
  beleg,
}: {
  beleg: { quelle: string; href: string | null } | null;
}) {
  if (!beleg) return <span className="pill pill--muted">kein Beleg</span>;
  if (!beleg.href) return <span className="pill pill--accent">{beleg.quelle}</span>;
  return (
    <a
      className="pill pill--accent"
      href={beleg.href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {beleg.quelle}
    </a>
  );
}
