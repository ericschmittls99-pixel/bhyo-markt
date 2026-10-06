import Link from "next/link";
import { notFound } from "next/navigation";

import { AdressenAufloesen } from "@/components/import/AdressenAufloesen";
import { AkteureAufloesen } from "@/components/import/AkteureAufloesen";
import { ZuordnungTabelle, type CodeOptionen, type SpalteAnzeige } from "@/components/import/ZuordnungTabelle";
import { EmptyState } from "@/components/shell/EmptyState";
import { getBelegeBucket, getEnvironment, withDb } from "@/lib/db";
import { MENGE_EINHEITEN } from "@/lib/formular-modell";
import { parseImportDatei, type ImportTabelle } from "@/lib/import-datei";
import { adressStand } from "@/lib/import-adressen";
import { akteurGruppenAnzeige } from "@/lib/import-akteure";
import { IMPORT_ART_LABEL, IMPORT_LAUF_STATUS_LABEL } from "@/lib/import-modell";
import { importRohKey, ladeGleicheDatei, ladeImportLauf, ladeImportVorlagen, ladeImportZeilen } from "@/lib/import-server";
import { PERSON, spaltenWerte, vorlageAnwenden, vorschlagZuordnung, werteVorschlag, zielfeld, zielfelderFuer } from "@/lib/import-zuordnung";
import { BELEG_LABEL, BELEG_TYPEN } from "@/lib/qualitaet";
import { darf } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { ladeSektoren, listMaterialarten, listOutputProdukte } from "@/lib/register";
import type { StromArt } from "@/lib/stroeme-modell";

export const dynamic = "force-dynamic";

const ZEILEN_ANZEIGE = 200;

/**
 * Ein Import-Lauf (AP2.7 PR b, E67): Kopf mit Datei, Art, Belegtyp und
 * Zaehlern; Warnung bei gleichem Datei-Hash. Im Zustand „angelegt" die
 * Zuordnung der Spalten (Roh-Upload wird dafuer aus R2 gelesen, nie
 * gespeichert), danach die uebernommenen Zeilen mit Zustand.
 */
export default async function ImportLaufPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vorlage?: string }> }) {
  const { id } = await params;
  const { vorlage: vorlageParam } = await searchParams;
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt" || !darf(zugang, "import.ausfuehren")) {
    return (
      <main className="einst-leer">
        <EmptyState icon="upload-simple" titel="import." beschreibung="Der Import ist Prüfern und Admins vorbehalten." />
      </main>
    );
  }
  const lauf = await withDb((db) => ladeImportLauf(db, id));
  if (!lauf) notFound();
  const art = lauf.art as StromArt;
  const gleiche = await withDb((db) => ladeGleicheDatei(db, lauf.dateiHash, lauf.id));
  const datum = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  const statusLabel = (s: string) => IMPORT_LAUF_STATUS_LABEL[s as keyof typeof IMPORT_LAUF_STATUS_LABEL] ?? s;

  let zuordnung: { spalten: SpalteAnzeige[]; vorschlag: Record<string, string>; werte: Record<string, Record<string, string>>; optionen: CodeOptionen } | null = null;
  const vorlagen = lauf.status === "angelegt" ? await withDb((db) => ladeImportVorlagen(db)) : [];
  const aktiveVorlage = vorlagen.find((v) => v.id === vorlageParam) ?? null;
  let rohFehlt = false;
  if (lauf.status === "angelegt") {
    const bucket = await getBelegeBucket();
    const roh = await bucket.get(importRohKey(await getEnvironment(), lauf.id, lauf.dateiname));
    if (!roh) rohFehlt = true;
    else {
      const tabelle: ImportTabelle = parseImportDatei(await new Response(roh.body).arrayBuffer(), lauf.dateiname);
      const kopfVorschlag = vorschlagZuordnung(art, tabelle.spalten);
      const [materialarten, produkte, sektoren] = await Promise.all([listMaterialarten(), listOutputProdukte(), ladeSektoren()]);
      const optionen: CodeOptionen = {
        materialart: materialarten.map((m) => ({ code: m.code, label: m.label })),
        produkt: produkte.map((p) => ({ code: p.code, label: p.label })),
        sektor: sektoren.filter((s) => s.aktiv).map((s) => ({ code: s.code, label: s.label })),
        beleg_typ: BELEG_TYPEN.map((t) => ({ code: t, label: BELEG_LABEL[t] })),
        menge_einheit: MENGE_EINHEITEN.map((e) => ({ code: e, label: e })),
      };
      const spalten: SpalteAnzeige[] = tabelle.spalten.map((name, i) => {
        // Erkannte Personen-Spalten: keine Werte an den Browser — nicht einmal als Beispiel.
        if (kopfVorschlag[name] === PERSON) return { name, beispiele: [], werte: [] };
        const werte = spaltenWerte(tabelle.zeilen, i);
        return { name, beispiele: werte.slice(0, 3).map((w) => w.wert), werte };
      });
      // Werte-Vorschlag fuer JEDE Spalte, die ein Code-Zielfeld bekommen koennte (Vorschlag oder Vorlage).
      const kandidaten = aktiveVorlage ? vorlageAnwenden(aktiveVorlage, tabelle.spalten, kopfVorschlag, {}) : { spalten: kopfVorschlag, werte: {} };
      const werteBasis: Record<string, Record<string, string>> = {};
      for (const sp of spalten) {
        const def = zielfeld(kandidaten.spalten[sp.name] ?? "");
        if (def?.typ === "code" && def.werte) werteBasis[def.key] = werteVorschlag(sp.werte.map((w) => w.wert), optionen[def.werte]);
      }
      const angewendet = aktiveVorlage ? vorlageAnwenden(aktiveVorlage, tabelle.spalten, kopfVorschlag, werteBasis) : { spalten: kopfVorschlag, werte: werteBasis };
      zuordnung = { spalten, vorschlag: angewendet.spalten, werte: angewendet.werte, optionen };
    }
  }
  const alleZeilen = lauf.status === "angelegt" ? [] : await withDb((db) => ladeImportZeilen(db, lauf.id));
  const zeilen = alleZeilen.slice(0, ZEILEN_ANZEIGE);
  const gruppen = akteurGruppenAnzeige(alleZeilen);

  return (
    <main className="einst imp">
      <div className="einst-inhalt">
        <header className="einst-kopf">
          <p className="c">
            <Link href="/import">import.</Link> · Lauf
          </p>
          <h2>{lauf.dateiname}</h2>
          <p className="c">
            <span className="pill pill--status pill--muted">{statusLabel(lauf.status)}</span>{" "}
            {IMPORT_ART_LABEL[art] ?? lauf.art} · Belegtyp {BELEG_LABEL[lauf.belegTyp as keyof typeof BELEG_LABEL] ?? lauf.belegTyp} ·{" "}
            {lauf.zaehler?.zeilen ?? "—"} Zeilen, {lauf.zaehler?.spalten ?? "—"} Spalten
            {lauf.zaehler?.fehler != null ? ` · ${lauf.zaehler.offen ?? 0} offen, ${lauf.zaehler.fehler} mit Fehler` : ""}
            {lauf.zaehler?.personen_spalten != null ? ` · ${lauf.zaehler.personen_spalten} Personen-Spalte(n) nicht übernommen` : ""} · angelegt{" "}
            {datum.format(lauf.createdAt)}
            {lauf.erstellerEmail ? ` von ${lauf.erstellerEmail}` : ""}
          </p>
        </header>
        {gleiche.length > 0 && (
          <div className="hinweis-box">
            <i className="ph ph-warning" aria-hidden />
            <div>
              Dieselbe Datei (gleicher SHA-256) wurde schon hochgeladen:{" "}
              {gleiche.map((g, i) => (
                <span key={g.id}>
                  {i > 0 && ", "}
                  <Link href={`/import/${g.id}`}>{g.dateiname}</Link> ({statusLabel(g.status)}, {datum.format(g.createdAt)})
                </span>
              ))}
              . Ein zweiter Lauf legt die Ströme erneut an.
            </div>
          </div>
        )}
        {rohFehlt && (
          <div className="hinweis-box">
            <i className="ph ph-warning" aria-hidden />
            <div>Der Roh-Upload liegt nicht mehr vor (nach 24 h gelöscht). Bitte die Datei neu hochladen.</div>
          </div>
        )}
        {zuordnung && (
          <ZuordnungTabelle
            key={aktiveVorlage?.id ?? "kopf"}
            vorlagen={vorlagen.map((v) => ({ id: v.id, name: v.name, quelle: v.quelle }))}
            aktiveVorlage={aktiveVorlage?.id ?? null}
            laufId={lauf.id}
            spalten={zuordnung.spalten}
            zielfelder={zielfelderFuer(art)}
            vorschlag={zuordnung.vorschlag}
            werteVorschlag={zuordnung.werte}
            optionen={zuordnung.optionen}
          />
        )}
        {(lauf.status === "zugeordnet" || lauf.status === "aufgeloest") && <AkteureAufloesen laufId={lauf.id} status={lauf.status} gruppen={gruppen} />}
        {lauf.status === "aufgeloest" && gruppen.some((g) => g.ergebnis === "neu") && <AdressenAufloesen laufId={lauf.id} stand={adressStand(alleZeilen)} />}
        {lauf.status !== "angelegt" && (
          <section>
            <header className="einst-kopf">
              <h3>zeilen.</h3>
              <p className="c">
                {zeilen.length < alleZeilen.length ? `Die ersten ${zeilen.length} von ${alleZeilen.length} Zeilen. ` : ""}
                Der Probelauf folgt in diesem PR.
              </p>
            </header>
            <table className="einst-tabelle imp-tabelle">
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Akteur</th>
                  <th>{art === "biomasse" ? "Materialart" : "Produkt"}</th>
                  <th>Menge</th>
                  <th>Zeitraum</th>
                  <th>Zustand</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.id}>
                    <td className="kv--num">{z.zeilennummer}</td>
                    <td>
                      {z.felder.akteur_name ?? "—"}
                      {z.felder.akteur_sitz_plz || z.felder.akteur_sitz_ort ? (
                        <span className="c"> · {[z.felder.akteur_sitz_plz, z.felder.akteur_sitz_ort].filter(Boolean).join(" ")}</span>
                      ) : null}
                      {z.felder.akteur_id && <span className="pill pill--muted"> vorhanden</span>}
                      {z.felder.akteur_neu === "1" && <span className="pill pill--muted"> neu{z.felder.akteur_sitz_lat ? " · Pin" : z.felder.akteur_sitz_offen ? " · Sitz offen" : ""}</span>}
                    </td>
                    <td>{art === "biomasse" ? z.felder.materialart_code || "—" : z.felder.produkt_code || "—"}</td>
                    <td className="kv--num">{art === "biomasse" ? z.felder.menge_roh_fm : `${z.felder.menge_wert ?? ""} ${z.felder.menge_einheit ?? ""}`}</td>
                    <td>
                      {z.felder.zeitraum_von ?? "—"} – {z.felder.zeitraum_bis ?? "—"}
                    </td>
                    <td>
                      <span className="pill pill--status pill--muted">{z.status}</span>
                      {z.fehlergrund && <span className="c"> {z.fehlergrund}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
