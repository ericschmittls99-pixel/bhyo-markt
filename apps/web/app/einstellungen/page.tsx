import { benutzer } from "@bhyo/db/schema";
import { asc } from "drizzle-orm";

import Link from "next/link";

import { BenutzerVerwaltung } from "@/components/einstellungen/BenutzerVerwaltung";
import { ParameterVerwaltung } from "@/components/einstellungen/ParameterVerwaltung";
import { heuteBerlin } from "@/lib/parameter";
import { ladeParameterUebersicht } from "@/lib/parameter-server";
import { EmptyState } from "@/components/shell/EmptyState";
import { withDb } from "@/lib/db";
import { darf } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * einstellungen. — seit F8/E30 die Benutzerverwaltung (nur für Admins).
 * Wer kein Verwaltungsrecht hat, sieht den bisherigen Leerzustand; die
 * tragende Prüfung sitzt in den Aktionen, das hier blendet nur aus.
 */
type SearchParams = Record<string, string | string[] | undefined>;

/** AP2.3 (E59): Reiter Nutzer · Parameter (Referenzlisten folgen in PR b); nur admin. */
const REITER = [
  ["nutzer", "Nutzer"],
  ["parameter", "Parameter"],
] as const;
type Reiter = (typeof REITER)[number][0];

export default async function EinstellungenPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const reiterRoh = Array.isArray(sp.reiter) ? sp.reiter[0] : sp.reiter;
  const reiter: Reiter = reiterRoh === "parameter" ? "parameter" : "nutzer";
  const zugang = await aktuellerZugang();
  const istAdmin = zugang.art === "erlaubt" && darf(zugang, "benutzer.anlegen");

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
        id: benutzer.id,
        email: benutzer.email,
        name: benutzer.name,
        rolle: benutzer.rolle,
        aktiv: benutzer.aktiv,
        erstelltAm: benutzer.erstelltAm,
      })
      .from(benutzer)
      .orderBy(asc(benutzer.email)),
  );

  const parameter = reiter === "parameter" ? await withDb((db) => ladeParameterUebersicht(db, heuteBerlin())) : [];

  return (
    <main className="einst">
      <div className="seg einst-reiter" role="tablist" aria-label="Einstellungen">
        {REITER.map(([wert, label]) => (
          <Link key={wert} role="tab" href={wert === "nutzer" ? "/einstellungen" : `/einstellungen?reiter=${wert}`} aria-selected={reiter === wert} className="seg-opt">
            {label}
          </Link>
        ))}
      </div>
      {reiter === "parameter" ? (
        <ParameterVerwaltung parameter={parameter} heute={heuteBerlin()} />
      ) : (
      <BenutzerVerwaltung
        benutzer={liste.map((b) => ({
          id: b.id,
          email: b.email,
          name: b.name,
          rolle: b.rolle,
          aktiv: b.aktiv,
          erstelltAm: b.erstelltAm.toISOString().slice(0, 10),
        }))}
        ichSelbst={zugang.email}
      />
      )}
    </main>
  );
}
