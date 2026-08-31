import { pgEnum } from "drizzle-orm/pg-core";

// Die drei bestaetigten Enums aus docs/ap0-schema-entscheidungen.md. Werte in
// snake_case ohne Umlaute; deutsche Anzeige-Labels leben ausschliesslich im
// Frontend. Reihenfolge ist verbindlich (Postgres-Enums sind nicht umsortierbar).

/** Einheitlicher Datensatz-Status fuer Biomassestrom, Output-Bedarf, Akteur, Interesse. */
export const datensatzStatus = pgEnum("datensatz_status", [
  "entwurf",
  "in_pruefung",
  "geprueft",
  "verworfen",
]);

/** Belegtyp mit steigender Verbindlichkeit. */
export const belegTyp = pgEnum("beleg_typ", [
  "dokument_link",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
]);

/** Kommunale Bereitschaftsstufe (Feld an der Region). */
export const bereitschaftStufe = pgEnum("bereitschaft_stufe", [
  "kein_kontakt",
  "erstgespraech",
  "positives_signal",
  "absichtserklaerung",
]);
