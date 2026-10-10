import { benutzer } from "@bhyo/db/schema";
import { asc, eq } from "drizzle-orm";

import Link from "next/link";

import { BenutzerVerwaltung } from "@/components/einstellungen/BenutzerVerwaltung";
import { RoundupEinstellung } from "@/components/einstellungen/RoundupEinstellung";
import { ParameterVerwaltung } from "@/components/einstellungen/ParameterVerwaltung";
import { ReferenzlistenVerwaltung } from "@/components/einstellungen/ReferenzlistenVerwaltung";
import { heuteBerlin, kalendertag } from "@/lib/datum";
import { ladeParameterUebersicht } from "@/lib/parameter-server";
import { ladeSektorUebersicht } from "@/lib/sektor-server";
import { EmptyState } from "@/components/shell/EmptyState";
import { getBindings, withDb } from "@/lib/db";
import { darf, normalisiereEmail } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * einstellungen. — seit F8/E30 die Benutzerverwaltung (nur für Admins).
 * Wer kein Verwaltungsrecht hat, sieht den bisherigen Leerzustand; die
 * tragende Prüfung sitzt in den Aktionen, das hier blendet nur aus.
 */
type SearchParams = Record<string, string | string[] | undefined>;

/** AP2.3 (E59): Reiter Nutzer · Referenzlisten · Parameter; nur admin. */
const REITER = [
  ["nutzer", "Nutzer"],
  ["referenzlisten", "Referenzlisten"],
  ["parameter", "Parameter"],
] as const;
type Reiter = (typeof REITER)[number][0];

async function testadresseIst(email: string): Promise<boolean> {
  try {
    const test = normalisiereEmail((await getBindings()).MAIL_TEST_EMPFAENGER ?? "");
    return !!test && normalisiereEmail(email) === test;
  } catch {
    return false;
  }
}

export default async function EinstellungenPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const reiterRoh = Array.isArray(sp.reiter) ? sp.reiter[0] : sp.reiter;
  const reiter: Reiter = REITER.find(([w]) => w === reiterRoh)?.[0] ?? "nutzer";
  const zugang = await aktuellerZugang();
  const istAdmin = zugang.art === "erlaubt" && darf(zugang, "benutzer.anlegen");
  // AP2.9 (E76): die eigene Roundup-Einstellung sieht jede Rolle.
  const roundupAn =
    zugang.art === "erlaubt"
      ? ((await withDb((db) => db.select({ roundup: benutzer.roundup }).from(benutzer).where(eq(benutzer.id, zugang.id)).limit(1)))[0]?.roundup ?? true)
      : true;

  // AP2.9 Umschalten: Testversand-Knopf nur fuer den Admin, der die hinterlegte Testadresse ist
  // (MAIL_TEST_EMPFAENGER); die Aktion prueft dieselbe Regel noch einmal.
  const testversand =
    istAdmin && zugang.art === "erlaubt" && (await testadresseIst(zugang.email));

  if (!istAdmin) {
    return (
      <main className="einst-leer">
        <EmptyState
          icon="gear"
          titel="einstellungen."
          beschreibung="Benutzer und Rechte verwalten Admins. Für Änderungen an deinem Zugang wende dich an eine Person mit Admin-Rolle."
        />
        {zugang.art === "erlaubt" && <RoundupEinstellung an={roundupAn} />}
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
  const sektoren = reiter === "referenzlisten" ? await withDb((db) => ladeSektorUebersicht(db)) : [];

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
      ) : reiter === "referenzlisten" ? (
        <ReferenzlistenVerwaltung sektoren={sektoren} />
      ) : (
      <>
      <RoundupEinstellung an={roundupAn} testversand={testversand} />
      <BenutzerVerwaltung
        benutzer={liste.map((b) => ({
          id: b.id,
          email: b.email,
          name: b.name,
          rolle: b.rolle,
          aktiv: b.aktiv,
          erstelltAm: kalendertag(b.erstelltAm),
        }))}
        ichSelbst={zugang.email}
      />
      </>
      )}
    </main>
  );
}
