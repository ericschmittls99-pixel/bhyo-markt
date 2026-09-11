import { EmptyState } from "@/components/shell/EmptyState";
import { PlatzhalterAktion } from "@/components/shell/PlatzhalterAktion";

export const dynamic = "force-dynamic";

/** import. — laut V2-Mockup vorerst nur der Leerzustand; der Import selbst folgt. */
export default function ImportPage() {
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
        icon="upload-simple"
        titel="noch kein import."
        beschreibung="Lade eine CSV- oder Excel-Datei hoch, um viele Ströme auf einmal anzulegen."
      >
        <PlatzhalterAktion
          label="Datei auswählen"
          icon="upload-simple"
          toast="Der Import folgt im nächsten Schritt."
        />
      </EmptyState>
    </main>
  );
}
