import { EmptyState } from "@/components/shell/EmptyState";

export const dynamic = "force-dynamic";

/** einstellungen. — laut V2-Mockup vorerst nur der Leerzustand. */
export default function EinstellungenPage() {
  return (
    <main
      style={{
        flex: 1,
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: "8px var(--gutter) var(--gutter)",
      }}
    >
      <EmptyState
        icon="gear"
        titel="einstellungen."
        beschreibung="Konto, Team und Rechte folgen im nächsten Schritt."
      />
    </main>
  );
}
