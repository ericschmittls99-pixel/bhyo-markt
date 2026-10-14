import { benutzer } from "@bhyo/db/schema";
import { asc, eq } from "drizzle-orm";

import Link from "next/link";

import { BenutzerVerwaltung } from "@/components/einstellungen/BenutzerVerwaltung";
import { ProfilEinstellung } from "@/components/einstellungen/ProfilEinstellung";
import { ParameterVerwaltung } from "@/components/einstellungen/ParameterVerwaltung";
import { ReferenzlistenVerwaltung } from "@/components/einstellungen/ReferenzlistenVerwaltung";
import { heuteBerlin, kalendertag } from "@/lib/datum";
import { ladeParameterUebersicht } from "@/lib/parameter-server";
import { ladeSektorUebersicht } from "@/lib/sektor-server";
import { getBindings, withDb } from "@/lib/db";
import { profilbildUrl } from "@/lib/profil-bild";
import { darf, normalisiereEmail } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * einstellungen. — E77 R7: Reiter „Profil" (eigene Daten, jede Rolle) zuerst;
 * danach Nutzer · Referenzlisten · Parameter nur fuer Admins (AP2.3/E59,
 * bestehende Inhalte). Wer kein Verwaltungsrecht hat, sieht nur sein Profil,
 * ohne Reiterleiste. Die tragende Pruefung sitzt in den Aktionen; das hier
 * blendet nur aus. Der Mail-Link „Abmelden" (/einstellungen#roundup) landet
 * im Profil, wo der Schalter der Tages-Mail steht.
 */
type SearchParams = Record<string, string | string[] | undefined>;

const REITER = [
  ["profil", "Profil"],
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
  const zugang = await aktuellerZugang();
  // Das Layout hat Unbekannte und Deaktivierte schon abgefangen; ohne Zugang gibt es hier nichts Eigenes.
  if (zugang.art !== "erlaubt") return <main className="einst-leer" />;
  const istAdmin = darf(zugang, "benutzer.anlegen");
  // Nicht-Admins haben nur das Profil — ein fremder Reiterwert faellt darauf zurueck.
  const gewuenscht: Reiter = REITER.find(([w]) => w === reiterRoh)?.[0] ?? "profil";
  const reiter: Reiter = istAdmin ? gewuenscht : "profil";

  // Eigene Zeile: Name, Bildversion und Roundup — immer frisch (nach dem Speichern revalidiert).
  const [ich] = await withDb((db) =>
    db
      .select({ name: benutzer.name, bildGeaendertAm: benutzer.bildGeaendertAm, roundup: benutzer.roundup })
      .from(benutzer)
      .where(eq(benutzer.id, zugang.id))
      .limit(1),
  );
  // AP2.9 Umschalten: Testversand-Knopf nur fuer den Admin, der die hinterlegte Testadresse ist
  // (MAIL_TEST_EMPFAENGER); die Aktion prueft dieselbe Regel noch einmal.
  const testversand = istAdmin && (await testadresseIst(zugang.email));
  const profil = {
    id: zugang.id,
    email: zugang.email,
    name: ich?.name ?? zugang.name,
    rolle: zugang.rolle,
    bildUrl: profilbildUrl(zugang.id, ich?.bildGeaendertAm ?? null),
    roundup: ich?.roundup ?? true,
    testversand,
  };

  if (!istAdmin) {
    return (
      <main className="einst">
        <ProfilEinstellung profil={profil} />
      </main>
    );
  }

  const liste =
    reiter === "nutzer"
      ? await withDb((db) =>
          db
            .select({
              id: benutzer.id,
              email: benutzer.email,
              name: benutzer.name,
              rolle: benutzer.rolle,
              aktiv: benutzer.aktiv,
              erstelltAm: benutzer.erstelltAm,
              bildGeaendertAm: benutzer.bildGeaendertAm,
            })
            .from(benutzer)
            .orderBy(asc(benutzer.email)),
        )
      : [];

  const parameter = reiter === "parameter" ? await withDb((db) => ladeParameterUebersicht(db, heuteBerlin())) : [];
  const sektoren = reiter === "referenzlisten" ? await withDb((db) => ladeSektorUebersicht(db)) : [];

  return (
    <main className="einst">
      <div className="seg einst-reiter" role="tablist" aria-label="Einstellungen">
        {REITER.map(([wert, label]) => (
          <Link key={wert} role="tab" href={wert === "profil" ? "/einstellungen" : `/einstellungen?reiter=${wert}`} aria-selected={reiter === wert} className="seg-opt">
            {label}
          </Link>
        ))}
      </div>
      {reiter === "parameter" ? (
        <ParameterVerwaltung parameter={parameter} heute={heuteBerlin()} />
      ) : reiter === "referenzlisten" ? (
        <ReferenzlistenVerwaltung sektoren={sektoren} />
      ) : reiter === "nutzer" ? (
        <BenutzerVerwaltung
          benutzer={liste.map((b) => ({
            id: b.id,
            email: b.email,
            name: b.name,
            rolle: b.rolle,
            aktiv: b.aktiv,
            erstelltAm: kalendertag(b.erstelltAm),
            bildUrl: profilbildUrl(b.id, b.bildGeaendertAm),
          }))}
          ichSelbst={zugang.email}
        />
      ) : (
        <ProfilEinstellung profil={profil} />
      )}
    </main>
  );
}
