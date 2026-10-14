/**
 * E77 R7: reine Regeln rund um Profil und Profilbild — ohne DOM, ohne
 * Datenbank, deshalb im Browser (Verkleinern) und auf dem Server (Pruefen)
 * dieselbe Quelle. Der Browser verkleinert quadratisch auf PROFILBILD_KANTE;
 * der Server prueft nur noch Typ (an den Bytes, nicht am Dateinamen) und
 * Groesse, denn er kann im Worker kein Bild dekodieren.
 */

export const PROFILBILD_KANTE = 256;
/** Hoechstgroesse NACH der Verkleinerung im Browser; der Server weist Groesseres ab. */
export const PROFILBILD_MAX_BYTES = 1024 * 1024;
export const PROFILBILD_TYPEN = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProfilbildTyp = (typeof PROFILBILD_TYPEN)[number];
/** Hoechstlaenge des Anzeigenamens (Spalte benutzer.name ist text, die Grenze ist eine Anzeige-Grenze). */
export const ANZEIGENAME_MAX = 80;

/** Quadratischer Ausschnitt in Quellpixeln: linke obere Ecke und Kantenlaenge. */
export interface Ausschnitt {
  x: number;
  y: number;
  kante: number;
}

/** Zoom des Zuschnitts: 1× zeigt die ganze kuerzere Seite, 3× ein Drittel davon. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
/** Schrittweite der Tasten + und − (der Regler ist feiner). */
export const ZOOM_SCHRITT = 0.1;

function klemme(wert: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, wert));
}

export function klemmeZoom(zoom: number): number {
  return klemme(Number.isFinite(zoom) ? zoom : ZOOM_MIN, ZOOM_MIN, ZOOM_MAX);
}

/**
 * Zuschnitt (E77 R7, Eric 14.10.2026): Mitte des Ausschnitts in Quellpixeln und
 * Zoom ergeben das Quellquadrat. Die Kante ist die kuerzere Seite durch den
 * Zoom; der Ausschnitt liegt immer ganz im Bild — die Mitte wird so weit
 * verschoben, dass kein Rand leer bleibt. Volle Praezision, keine Rundung:
 * drawImage nimmt Bruchpixel, gerundet wird erst durch das Zeichnen.
 */
export function zuschnittAusschnitt(breite: number, hoehe: number, zoom: number, mitteX: number, mitteY: number): Ausschnitt {
  const kante = Math.max(1, Math.min(breite, hoehe)) / klemmeZoom(zoom);
  return {
    x: klemme(mitteX - kante / 2, 0, Math.max(0, breite - kante)),
    y: klemme(mitteY - kante / 2, 0, Math.max(0, hoehe - kante)),
    kante,
  };
}

/** Mitte so einklemmen, dass der Ausschnitt bei diesem Zoom ganz im Bild liegt (fuer Ziehen und Tasten). */
export function klemmeMitte(breite: number, hoehe: number, zoom: number, mitteX: number, mitteY: number): { x: number; y: number } {
  const { x, y, kante } = zuschnittAusschnitt(breite, hoehe, zoom, mitteX, mitteY);
  return { x: x + kante / 2, y: y + kante / 2 };
}

/** Groesster mittiger quadratischer Ausschnitt eines Bildes (Breite × Hoehe) — Zuschnitt ohne Zoom und Verschiebung. */
export function quadratAusschnitt(breite: number, hoehe: number): Ausschnitt {
  return zuschnittAusschnitt(breite, hoehe, ZOOM_MIN, breite / 2, hoehe / 2);
}

/**
 * Bildtyp aus den ersten Bytes (Magic Numbers) — der Dateiname und der vom
 * Browser gemeldete MIME-Typ sind Behauptungen, die Bytes nicht.
 */
export function bildTypAusBytes(bytes: Uint8Array): ProfilbildTyp | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

export function endungFuerTyp(typ: ProfilbildTyp): "jpg" | "png" | "webp" {
  return typ === "image/jpeg" ? "jpg" : typ === "image/png" ? "png" : "webp";
}

/** Serverseitige Pruefung einer hochgeladenen Datei: Typ aus den Bytes, Groesse. */
export function pruefeProfilbild(bytes: Uint8Array): { typ: ProfilbildTyp } | { fehler: string } {
  if (bytes.length === 0) return { fehler: "Keine Bilddatei übermittelt." };
  if (bytes.length > PROFILBILD_MAX_BYTES) return { fehler: "Das Bild ist größer als 1 MB. Bitte ein kleineres Bild wählen." };
  const typ = bildTypAusBytes(bytes);
  if (!typ) return { fehler: "Nur JPG, PNG oder WebP sind erlaubt." };
  return { typ };
}

/**
 * Anzeigename: Leerraum zusammengezogen, leer = kein Name (NULL, dann gilt
 * die E-Mail), zu lang wird abgewiesen statt stillschweigend gekuerzt.
 */
export function pruefeAnzeigename(roh: string): { wert: string | null } | { fehler: string } {
  const wert = roh.replace(/\s+/g, " ").trim();
  if (wert.length > ANZEIGENAME_MAX) return { fehler: `Der Anzeigename darf höchstens ${ANZEIGENAME_MAX} Zeichen haben.` };
  return { wert: wert || null };
}

/** R2-Key eines Profilbilds: eigener Praefix je Umgebung und Nutzer, nie aus der URL ableitbar. */
export function profilbildKey(umgebung: string, benutzerId: string, kennung: string, typ: ProfilbildTyp): string {
  return `profil/${umgebung}/${benutzerId}/${kennung}.${endungFuerTyp(typ)}`;
}

/**
 * URL der Bild-Route mit Versionszaehler (bild_geaendert_am), damit ein neues
 * Bild sofort erscheint und ein altes gecacht bleiben darf. null = Initialen.
 */
export function profilbildUrl(benutzerId: string, version: Date | number | null | undefined): string | null {
  if (version === null || version === undefined) return null;
  const v = typeof version === "number" ? version : version.getTime();
  return `/api/profil/bild/${encodeURIComponent(benutzerId)}?v=${v}`;
}
