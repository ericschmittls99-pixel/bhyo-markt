import Link from "next/link";
import { redirect } from "next/navigation";

import { AlleErledigt, InboxListe } from "@/components/inbox/InboxListe";
import { EmptyState } from "@/components/shell/EmptyState";
import { Detail } from "@/components/stroeme/Detail";
import { withDb } from "@/lib/db";
import { ladeDetailDaten } from "@/lib/detail-daten";
import { fmtRelativ } from "@/lib/format";
import { ladeEintraege } from "@/lib/inbox/server";
import { darfRolle } from "@/lib/rechte";
import { ladeZuweisbare } from "@/lib/rechte/sperre-server";
import { aktuellerZugang } from "@/lib/rechte/wache";
import type { StromArt } from "@/lib/stroeme-modell";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const ersterWert = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * inbox. (AP2.2 PR b): die eigenen Mitteilungen. Kopfzeile nach dem
 * E39-Muster (Segment „Offen | Erledigt", rechts „Alle erledigt"), Zeilen mit
 * Ungelesen-Punkt, Avatar des Auslösers, Text und relativer Zeit. „Öffnen"
 * zeigt dasselbe Detail-Panel wie ströme. — auf dieser Seite, Rechte wie
 * dort. Der Zähler in der Navigation aktualisiert sich beim nächsten
 * Seitenaufruf (keine Live-Aktualisierung, Entscheidung Eric).
 */
export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") {
    return (
      <main className="ib ib-leer">
        <EmptyState icon="tray" titel="inbox." beschreibung="Kein Zugang." />
      </main>
    );
  }

  // Bearbeiten aus dem Detail heraus (?form=<id>) lebt in ströme. — dorthin.
  const form = ersterWert(sp.form);
  const sicht = ersterWert(sp.sicht) === "outputs" ? "outputs" : "feedstock";
  if (form) redirect(`/register?sicht=${sicht}&form=${encodeURIComponent(form)}`);

  const zustand = ersterWert(sp.zustand) === "erledigt" ? ("erledigt" as const) : ("offen" as const);
  const eintraege = await withDb((db) => ladeEintraege(db, zugang.id, zustand));
  // PR c: moegliche Empfaenger einer Weitergabe — aktiv, Rolle >= bearbeiter (dieselbe Liste wie beim Zuweisen).
  const empfaenger = darfRolle(zugang, "inbox.weitergeben") ? await withDb((db) => ladeZuweisbare(db)) : [];
  const jetzt = new Date();
  const zeilen = eintraege.map((e) => ({ ...e, zeit: fmtRelativ(e.aktualisiertAm, jetzt) }));

  // Detail: ?detail=<strom-id>&sicht=feedstock|outputs — dasselbe Panel wie ströme.
  const detailId = ersterWert(sp.detail);
  const art: StromArt = sicht === "outputs" ? "output" : "biomasse";
  const detail = detailId ? await ladeDetailDaten(art, detailId, zugang) : null;
  const canEdit = darfRolle(zugang, "strom.bearbeiten");
  const offenAnzahl = zustand === "offen" ? zeilen.length : null;

  return (
    <main className="ib">
      <div className="st-toolbar aw-kopfzeile">
        <div className="seg" role="group" aria-label="Offen oder Erledigt">
          {(
            [
              ["offen", "Offen"],
              ["erledigt", "Erledigt"],
            ] as const
          ).map(([wert, label]) => (
            <Link
              key={wert}
              href={wert === "offen" ? "/inbox" : "/inbox?zustand=erledigt"}
              className="seg-opt"
              aria-pressed={zustand === wert}
            >
              {label}
            </Link>
          ))}
        </div>
        <span className="st-count">
          {zustand === "offen"
            ? `${zeilen.length} ${zeilen.length === 1 ? "offene Mitteilung" : "offene Mitteilungen"}`
            : `${zeilen.length} erledigt oder verworfen`}
        </span>
        <div className="st-toolbar-rechts">
          <AlleErledigt anzahlOffen={offenAnzahl ?? 0} />
        </div>
      </div>

      {zeilen.length === 0 ? (
        <div className="ib-leer">
          <EmptyState
            icon="tray"
            titel={zustand === "offen" ? "Keine offenen Mitteilungen." : "Nichts erledigt."}
            beschreibung={
              zustand === "offen"
                ? "Änderungen an Einträgen, an denen du beteiligt bist, erscheinen hier."
                : "Erledigte und verworfene Mitteilungen erscheinen hier."
            }
          />
        </div>
      ) : (
        <InboxListe
          zeilen={zeilen}
          zustand={zustand}
          darfReverifizieren={darfRolle(zugang, "strom.reverifizieren")}
          darfWeitergeben={darfRolle(zugang, "inbox.weitergeben")}
          empfaenger={empfaenger}
          ichId={zugang.id}
        />
      )}

      {detail && (
        <Detail
          strom={detail.strom}
          historie={detail.historie}
          begruendung={detail.begruendung}
          modal
          canEdit={canEdit}
          sperrRechte={detail.sperrRechte}
          zuweisbare={detail.zuweisbare}
          anfrage={detail.anfrage}
          verfuegbarkeit={detail.verfuegbarkeit}
          vergaben={detail.vergaben}
          preisKorridor={detail.preisKorridor}
          kommentare={detail.kommentare}
          kommentarZugang={detail.kommentarZugang}
          darfKommentieren={detail.darfKommentieren}
        />
      )}
    </main>
  );
}
