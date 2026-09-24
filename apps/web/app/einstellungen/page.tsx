import { benutzer } from "@bhyo/db/schema";
import { asc } from "drizzle-orm";

import { BenutzerVerwaltung } from "@/components/einstellungen/BenutzerVerwaltung";
import { EmptyState } from "@/components/shell/EmptyState";
import { withDb } from "@/lib/db";
import { darf } from "@/lib/rollen";
import { aktuellerZugang } from "@/lib/wache";

export const dynamic = "force-dynamic";

/**
 * einstellungen. — seit F8/E30 die Benutzerverwaltung (nur für Admins).
 * Wer kein Verwaltungsrecht hat, sieht den bisherigen Leerzustand; die
 * tragende Prüfung sitzt in den Aktionen, das hier blendet nur aus.
 */
export default async function EinstellungenPage() {
  const zugang = await aktuellerZugang();
  const istAdmin = zugang.art === "erlaubt" && darf(zugang.rolle, "verwalten");

  if (!istAdmin) {
    return (
      <main className="einst-leer">
        <EmptyState
          icon="gear"
          titel="einstellungen."
          beschreibung="Benutzer und Rechte verwalten Admins. Für Änderungen an deinem Zugang wende dich an eine Person mit Admin-Rolle."
        />
      </main>
    );
  }

  const liste = await withDb((db) =>
    db
      .select({
        email: benutzer.email,
        name: benutzer.name,
        rolle: benutzer.rolle,
        aktiv: benutzer.aktiv,
        erstelltAm: benutzer.erstelltAm,
      })
      .from(benutzer)
      .orderBy(asc(benutzer.email)),
  );

  return (
    <main className="einst">
      <BenutzerVerwaltung
        benutzer={liste.map((b) => ({
          email: b.email,
          name: b.name,
          rolle: b.rolle,
          aktiv: b.aktiv,
          erstelltAm: b.erstelltAm.toISOString().slice(0, 10),
        }))}
        ichSelbst={zugang.email}
      />
    </main>
  );
}
