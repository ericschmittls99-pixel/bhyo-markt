import Link from "next/link";

import { DublettenListe } from "@/components/akteure/DublettenListe";
import { EmptyState } from "@/components/shell/EmptyState";
import { DUBLETTE_ORT_METER, DUBLETTE_SCHWACH, DUBLETTE_STARK } from "@/lib/akteur-norm";
import { withDb } from "@/lib/db";
import { ladeDubletten, ladeKeineDubletten } from "@/lib/dubletten";
import { darfRolle } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { ladeSektoren } from "@/lib/register";

export const dynamic = "force-dynamic";

/**
 * akteure. › moegliche Dubletten (AP2.5 PR c, E66): Paare ab der Schwelle
 * (pg_trgm ueber akteur_name_norm), stark mit Ortsbezug, schwach ohne. Ein
 * Paar laesst sich als „keine Dublette" markieren (Pruefer/Admin, aufhebbar)
 * oder zusammenfuehren (Pruefer/Admin, endgueltig).
 */
export default async function DublettenPage() {
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") {
    return (
      <main className="ak ak-leer">
        <EmptyState icon="buildings" titel="akteure." beschreibung="Kein Zugang." />
      </main>
    );
  }
  const [paare, markiert, sektoren] = await Promise.all([withDb((db) => ladeDubletten(db)), withDb((db) => ladeKeineDubletten(db)), ladeSektoren()]);
  return (
    <main className="ak ak-detail">
      <div className="ak-detail-kopf">
        <div className="ak-titel">
          <Link href="/akteure" className="btn btn--ghost btn--sm">
            <i className="ph ph-arrow-left" aria-hidden />
            akteure.
          </Link>
          <h2>mögliche dubletten.</h2>
          <span className="ak-pillen">
            <span className="pill pill--muted">{paare.filter((p) => p.grad === "stark").length} stark</span>
            <span className="pill pill--muted">{paare.filter((p) => p.grad === "schwach").length} schwach</span>
          </span>
        </div>
      </div>
      <p className="ov-note">
        Ähnlichkeit der normalisierten Namen (pg_trgm). Stark: ab {Math.round(DUBLETTE_STARK * 100)} % mit gleicher PLZ oder Sitz-Abstand bis {DUBLETTE_ORT_METER / 1000} km. Schwach: ab {Math.round(DUBLETTE_SCHWACH * 100)} % ohne Ortsbezug.
        Als „keine Dublette" markierte Paare erscheinen nicht mehr (unten aufhebbar). Zusammenführen ist endgültig.
      </p>
      <DublettenListe
        paare={paare}
        markiert={markiert}
        sektoren={sektoren.map((s) => ({ code: s.code, label: s.label }))}
        darfMarkieren={darfRolle(zugang, "akteur.keine_dublette")}
        darfZusammenfuehren={darfRolle(zugang, "akteur.zusammenfuehren")}
      />
    </main>
  );
}
