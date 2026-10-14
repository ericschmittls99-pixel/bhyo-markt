"use client";

/**
 * E77 R7: Reiter „Profil" — nur die eigenen Daten, fuer jede Rolle.
 * Anzeigename aenderbar (E-Mail fest, sie ist die Access-Identitaet),
 * Profilbild jpg/png/webp: erst der Zuschnitt (ProfilbildZuschnitt: ziehen,
 * zoomen, runde Vorschau), dann im Browser auf 256 px verkleinert (Canvas) und
 * hochgeladen; der Server prueft Typ an den Bytes und Groesse (<= 1 MB).
 * Darunter der Schalter der Tages-Mail.
 * Die tragende Pruefung sitzt in den Aktionen (profil.bearbeiten).
 */
import { useRef, useState, useTransition } from "react";

import { Avatar } from "@/components/Avatar";
import { ProfilbildZuschnitt } from "@/components/einstellungen/ProfilbildZuschnitt";
import { RoundupEinstellung } from "@/components/einstellungen/RoundupEinstellung";
import { anzeigenameSetzen, profilBildEntfernen, profilBildSetzen } from "@/lib/profil-actions";
import { ANZEIGENAME_MAX, type Ausschnitt, PROFILBILD_KANTE, PROFILBILD_MAX_BYTES, PROFILBILD_TYPEN, quadratAusschnitt } from "@/lib/profil-bild";
import { ROLLE_LABEL, type Rolle } from "@/lib/rechte";

export interface ProfilDaten {
  id: string;
  email: string;
  name: string | null;
  rolle: Rolle;
  bildUrl: string | null;
  roundup: boolean;
  testversand?: boolean;
}

const TYP_FEHLER = "Nur JPG, PNG oder WebP sind erlaubt.";

/**
 * Verkleinert eine Bilddatei im Browser auf ein Quadrat von PROFILBILD_KANTE
 * Pixeln — den uebergebenen Ausschnitt (Zuschnitt), sonst das mittige Quadrat.
 * WebP, wenn der Browser es schreibt, sonst PNG. Liefert die Datei fuer den
 * Upload oder einen Fehlertext.
 */
export async function verkleinereProfilbild(datei: File, ausschnitt?: Ausschnitt): Promise<File | { fehler: string }> {
  if (!(PROFILBILD_TYPEN as readonly string[]).includes(datei.type)) return { fehler: TYP_FEHLER };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(datei);
  } catch {
    return { fehler: "Das Bild lässt sich nicht lesen." };
  }
  const { x, y, kante } = ausschnitt ?? quadratAusschnitt(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PROFILBILD_KANTE;
  canvas.height = PROFILBILD_KANTE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { fehler: "Das Bild lässt sich nicht verkleinern." };
  ctx.drawImage(bitmap, x, y, kante, kante, 0, 0, PROFILBILD_KANTE, PROFILBILD_KANTE);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((aufloesen) => canvas.toBlob(aufloesen, "image/webp", 0.9));
  const ausgabe = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((aufloesen) => canvas.toBlob(aufloesen, "image/png"));
  if (!ausgabe) return { fehler: "Das Bild lässt sich nicht verkleinern." };
  if (ausgabe.size > PROFILBILD_MAX_BYTES) return { fehler: "Das Bild ist auch verkleinert größer als 1 MB." };
  return new File([ausgabe], ausgabe.type === "image/webp" ? "profil.webp" : "profil.png", { type: ausgabe.type });
}

export function ProfilEinstellung({ profil }: { profil: ProfilDaten }) {
  const [name, setName] = useState(profil.name ?? "");
  const [gespeichert, setGespeichert] = useState(profil.name ?? "");
  const [nameFehler, setNameFehler] = useState<string | null>(null);
  const [nameOk, setNameOk] = useState(false);
  const [nameLaeuft, starteName] = useTransition();
  const [bildUrl, setBildUrl] = useState(profil.bildUrl);
  const [bildFehler, setBildFehler] = useState<string | null>(null);
  const [bildLaeuft, starteBild] = useTransition();
  const [zuschnitt, setZuschnitt] = useState<File | null>(null);
  const dateiRef = useRef<HTMLInputElement>(null);

  const nutzer = { id: profil.id, name: gespeichert || null, email: profil.email, bildUrl };
  const nameGeaendert = name.trim() !== gespeichert.trim();

  // Datei gewaehlt: Typ sofort pruefen, dann der Zuschnitt — gespeichert wird erst nach „Übernehmen".
  function bildWaehlen(datei: File | undefined) {
    if (dateiRef.current) dateiRef.current.value = "";
    if (!datei) return;
    setBildFehler(null);
    if (!(PROFILBILD_TYPEN as readonly string[]).includes(datei.type)) {
      setBildFehler(TYP_FEHLER);
      return;
    }
    setZuschnitt(datei);
  }

  function bildUebernehmen(datei: File, ausschnitt: Ausschnitt) {
    setZuschnitt(null);
    starteBild(async () => {
      const klein = await verkleinereProfilbild(datei, ausschnitt);
      if (!(klein instanceof File)) {
        setBildFehler(klein.fehler);
        return;
      }
      const fd = new FormData();
      fd.set("bild", klein);
      const erg = await profilBildSetzen(fd);
      if (!erg.ok) setBildFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
      else setBildUrl(erg.bildUrl ?? null);
    });
  }

  return (
    <div className="einst-inhalt">
      <section className="profil" aria-labelledby="profil-titel">
        <header className="einst-kopf">
          <h2 id="profil-titel">profil.</h2>
          <p className="c">Nur deine eigenen Daten. Die E-Mail ist deine Anmeldung und bleibt fest.</p>
        </header>

        <div className="profil-bild">
          <Avatar nutzer={nutzer} groesse="xl" />
          <div className="profil-bild-aktionen">
            <input
              ref={dateiRef}
              type="file"
              accept={PROFILBILD_TYPEN.join(",")}
              className="profil-datei"
              aria-label="Profilbild wählen"
              onChange={(e) => bildWaehlen(e.target.files?.[0])}
              disabled={bildLaeuft}
            />
            <div className="profil-bild-knoepfe">
              <button type="button" className="btn btn--ghost btn--sm" disabled={bildLaeuft} onClick={() => dateiRef.current?.click()}>
                <i className="ph ph-image" aria-hidden />
                {bildUrl ? "Bild ersetzen" : "Bild wählen"}
              </button>
              {bildUrl && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={bildLaeuft}
                  onClick={() => {
                    setBildFehler(null);
                    starteBild(async () => {
                      const erg = await profilBildEntfernen();
                      if (!erg.ok) setBildFehler(erg.fehler ?? "Entfernen fehlgeschlagen.");
                      else setBildUrl(null);
                    });
                  }}
                >
                  <i className="ph ph-x" aria-hidden />
                  Bild entfernen
                </button>
              )}
            </div>
            <span className="c">JPG, PNG oder WebP. Du wählst den Ausschnitt; das Bild wird im Browser auf {PROFILBILD_KANTE} px verkleinert, höchstens 1 MB. Ohne Bild stehen deine Initialen.</span>
            {bildLaeuft && <span className="c" role="status">Wird gespeichert …</span>}
            {bildFehler && <p className="pf-fehler einst-fehler" role="alert">{bildFehler}</p>}
          </div>
        </div>

        <form
          className="profil-form"
          onSubmit={(e) => {
            e.preventDefault();
            setNameFehler(null);
            setNameOk(false);
            starteName(async () => {
              const erg = await anzeigenameSetzen(name);
              if (!erg.ok) {
                setNameFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
                return;
              }
              const neu = name.replace(/\s+/g, " ").trim();
              setName(neu);
              setGespeichert(neu);
              setNameOk(true);
            });
          }}
        >
          <label className="pf">
            <span>Anzeigename</span>
            <span className="pf-feld">
              <input
                type="text"
                name="name"
                value={name}
                maxLength={ANZEIGENAME_MAX}
                placeholder="Vorname Nachname"
                autoComplete="name"
                onChange={(e) => {
                  setName(e.target.value);
                  setNameOk(false);
                }}
              />
            </span>
          </label>
          <label className="pf">
            <span>E-Mail</span>
            <span className="pf-feld">
              <input type="text" value={profil.email} readOnly aria-readonly="true" />
            </span>
          </label>
          <div className="pf">
            <span>Rolle</span>
            <span className="profil-rolle">
              <span className="konf konf--rolle">{ROLLE_LABEL[profil.rolle]}</span>
              <span className="c">Die Rolle vergeben Admins.</span>
            </span>
          </div>
          <div className="profil-form-fuss">
            <button type="submit" className="btn btn--primary btn--sm" disabled={nameLaeuft || !nameGeaendert}>
              <i className="ph ph-check" aria-hidden />
              Speichern
            </button>
            {nameOk && <span className="c" role="status">Gespeichert.</span>}
            {nameFehler && <p className="pf-fehler einst-fehler" role="alert">{nameFehler}</p>}
          </div>
        </form>
      </section>

      <RoundupEinstellung an={profil.roundup} testversand={profil.testversand} />
      {zuschnitt && <ProfilbildZuschnitt datei={zuschnitt} onUebernehmen={(a) => bildUebernehmen(zuschnitt, a)} onAbbrechen={() => setZuschnitt(null)} />}
    </div>
  );
}
