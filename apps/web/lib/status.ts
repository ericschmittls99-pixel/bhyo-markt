// Status-Modell fuer stroeme. (AP1i). Anzeige-Labels (normale Orthographie),
// Pillen-Texte (Kleinschreibung mit Schlusspunkt, V2) und die dokumentierte
// Uebergangsregel aus Entscheidung E8: vorwaerts Entwurf -> in Pruefung ->
// geprueft, rueckwaerts je eine Stufe; `verworfen` nur ueber den
// Verwerfen-Flow, zurueck aus `verworfen` in den Entwurf (Reaktivieren).

export const STATUS_LABEL: Record<string, string> = {
  entwurf: "Entwurf",
  in_pruefung: "in Prüfung",
  geprueft: "geprüft",
  verworfen: "verworfen",
};

/** Pillen-Text und Farbton (V2: active = Lime, running = Waldgruen). */
export const STATUS_PILL: Record<string, { text: string; tone: string }> = {
  entwurf: { text: "entwurf.", tone: "quiet" },
  in_pruefung: { text: "in prüfung.", tone: "active" },
  geprueft: { text: "geprüft.", tone: "running" },
  verworfen: { text: "verworfen.", tone: "inactive" },
};

/**
 * AP2.4 PR a (E62, D4): Uebergaenge der Aktion strom.status_setzen (ab
 * bearbeiter). „geprueft" steht hier bewusst NICHT — das ist die eigene
 * Aktion strom.pruefen (pruefer/admin), aus entwurf und in_pruefung.
 */
export const ERLAUBTE_UEBERGAENGE: Record<string, string[]> = {
  entwurf: ["in_pruefung"],
  in_pruefung: ["entwurf"],
  geprueft: ["in_pruefung"],
  verworfen: ["entwurf"],
};

/** Ausgangsstatus, aus denen ein Pruefer „geprueft" setzen darf (E62). */
export const PRUEF_AUSGANG: readonly string[] = ["entwurf", "in_pruefung"];

/** Beschriftung der Uebergaenge im Detail-Kopf (E62), Schluessel „von>nach". */
export const UEBERGANG_LABEL: Record<string, string> = {
  "entwurf>in_pruefung": "In Prüfung geben",
  "geprueft>in_pruefung": "In Prüfung geben",
  "in_pruefung>entwurf": "Zurückgeben",
  "verworfen>entwurf": "Reaktivieren",
};

