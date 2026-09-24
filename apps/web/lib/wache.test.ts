/**
 * F8/E30: Rechtetests, die die AKTIONEN AUFRUFEN — nicht die Oberfläche.
 *
 * Das ist der Kern der Sache: Die Oberfläche blendet Knöpfe aus, aber eine
 * Server-Action ist ein HTTP-Endpunkt. Wer sie direkt aufruft, sieht die
 * Oberfläche nie. Ein Test, der nur prüft, ob ein Knopf fehlt, prüft die
 * Bequemlichkeit — nicht den Schutz.
 *
 * Gemockt wird deshalb nur das, was Infrastruktur ist (Header, Datenbank,
 * Cache-Invalidierung). Die geprüfte Logik — Wache, Rollen, Actions — läuft
 * echt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Rolle } from "./rollen";

/** Von Test zu Test umgestellt: Wer ist angemeldet, und was steht in `benutzer`? */
let angemeldet: string | null = null;
let eintrag: { rolle: Rolle; aktiv: boolean; name: string | null } | null = null;
/** Was die Admin-Suche (adminKontakt) findet — unabhaengig vom Angemeldeten. */
let aktiverAdmin: { email: string } | null = null;
/** Zählt DB-Zugriffe jenseits der Rollenabfrage — muss bei Abweisung 0 bleiben. */
let schreibversuche = 0;

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => angemeldet,
  // Die Wache liest über withDb; wir liefern den benutzer-Eintrag zurück und
  // zählen jeden weiteren Aufruf als Schreibversuch.
  withDb: async (fn: (db: unknown) => unknown) => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            // Rollenabfrage der Wache.
            limit: async () => (eintrag ? [eintrag] : []),
            // adminKontakt: sortiert und nimmt den ersten aktiven Admin.
            orderBy: () => ({
              limit: async () => (aktiverAdmin ? [aktiverAdmin] : []),
            }),
          }),
        }),
      }),
      transaction: async () => {
        schreibversuche += 1;
        throw new Error("Darf bei fehlendem Recht nie erreicht werden.");
      },
      insert: () => {
        schreibversuche += 1;
        throw new Error("Darf bei fehlendem Recht nie erreicht werden.");
      },
    };
    return fn(db);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { statusSetzen, stromVerwerfen } = await import("./stroeme-actions");
const { verlangeVerwaltungsrecht, verlangeSchreibrecht, KeinRecht, adminKontakt } =
  await import("./wache");

function alsBenutzer(email: string, rolle: Rolle, aktiv = true) {
  angemeldet = email;
  eintrag = { rolle, aktiv, name: null };
}

beforeEach(() => {
  angemeldet = null;
  eintrag = null;
  aktiverAdmin = null;
  schreibversuche = 0;
});

describe("Betrachter ruft eine Schreib-Action direkt auf", () => {
  it("statusSetzen wird abgewiesen, ohne die Datenbank zu berühren", async () => {
    alsBenutzer("betrachter@bhyo.de", "betrachter");
    const ergebnis = await statusSetzen("biomasse", "irgendeine-id", "geprueft");
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toBe("Für diese Aktion fehlt das Schreibrecht.");
    // Die Abweisung muss VOR der Wirkung greifen, nicht danach.
    expect(schreibversuche).toBe(0);
  });

  it("stromVerwerfen wird abgewiesen", async () => {
    alsBenutzer("betrachter@bhyo.de", "betrachter");
    const ergebnis = await stromVerwerfen("output", "irgendeine-id");
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toBe("Für diese Aktion fehlt das Schreibrecht.");
    expect(schreibversuche).toBe(0);
  });
});

describe("Bearbeiter ruft eine Admin-Aktion auf", () => {
  it("wird abgewiesen", async () => {
    alsBenutzer("bearbeiter@bhyo.de", "bearbeiter");
    await expect(verlangeVerwaltungsrecht()).rejects.toThrow(KeinRecht);
  });

  it("darf aber schreiben", async () => {
    alsBenutzer("bearbeiter@bhyo.de", "bearbeiter");
    await expect(verlangeSchreibrecht()).resolves.toMatchObject({
      rolle: "bearbeiter",
    });
  });
});

describe("Admin", () => {
  it("darf schreiben und verwalten", async () => {
    alsBenutzer("admin@bhyo.de", "admin");
    await expect(verlangeSchreibrecht()).resolves.toMatchObject({ rolle: "admin" });
    await expect(verlangeVerwaltungsrecht()).resolves.toMatchObject({ rolle: "admin" });
  });
});

describe("Fail closed", () => {
  it("unbekannte Adresse darf nicht schreiben — auch nicht lesen", async () => {
    angemeldet = "neu@bhyo.de";
    eintrag = null;
    const ergebnis = await statusSetzen("biomasse", "id", "geprueft");
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toBe("Für diese Adresse ist noch kein Zugang eingerichtet.");
    expect(schreibversuche).toBe(0);
  });

  it("deaktivierte Adresse bekommt den eigenen Wortlaut", async () => {
    alsBenutzer("alt@bhyo.de", "bearbeiter", false);
    const ergebnis = await statusSetzen("biomasse", "id", "geprueft");
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toBe("Der Zugang wurde deaktiviert.");
    expect(schreibversuche).toBe(0);
  });

  it("ohne Anmeldung gibt es kein Schreibrecht", async () => {
    angemeldet = null;
    const ergebnis = await statusSetzen("biomasse", "id", "geprueft");
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toBe("Nicht authentifiziert.");
    expect(schreibversuche).toBe(0);
  });

  it("Großschreibung in der Access-Adresse sperrt niemanden aus", async () => {
    // Access liefert die Adresse nicht garantiert klein; die Wache normalisiert.
    angemeldet = "Bearbeiter@BHYO.de";
    eintrag = { rolle: "bearbeiter", aktiv: true, name: null };
    await expect(verlangeSchreibrecht()).resolves.toMatchObject({
      email: "bearbeiter@bhyo.de",
    });
  });
});

describe("Kontaktadresse der Zugangsseite", () => {
  it("nennt den aktiven Admin aus der Datenbank, nicht eine feste Adresse", async () => {
    aktiverAdmin = { email: "wer.auch.immer@bhyo.de" };
    await expect(adminKontakt()).resolves.toBe("wer.auch.immer@bhyo.de");
  });

  it("gibt null zurück, wenn es keinen aktiven Admin gibt", async () => {
    // Die Seite zeigt dann einen neutralen Hinweis statt einer leeren Zeile.
    aktiverAdmin = null;
    await expect(adminKontakt()).resolves.toBeNull();
  });
});
