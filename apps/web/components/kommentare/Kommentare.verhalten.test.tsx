/**
 * AP6 (Eric 12.10.2026, Anwendung von §45 — keine neue Entscheidung): das
 * Kommentar-Formular im Browser-Verhalten, mit jsdom und Testing Library.
 * Erster Komponententest im Repo; die Umgebung gilt nur fuer diese Datei
 * (Docblock), alle anderen Tests laufen weiter in Node.
 *
 * Geprueft wird die Ursache des doppelten Anlegens von der Preview (PR b):
 *   1. Nach erfolgreichem Speichern ist das Feld leer.
 *   2. Waehrend des Speicherns ist der Knopf gesperrt — ein zweiter Klick
 *      loest keinen zweiten Aufruf aus. Beide Wege: direkt und ueber die
 *      Kontaktdaten-Warnung („Trotzdem speichern").
 *   3. Nach einem Fehlschlag bleibt der Text stehen (kein Datenverlust).
 * Die Action ist eine Attrappe mit aufschiebbarer Antwort, damit „pending"
 * beobachtbar ist. Rot-Nachweis: ohne das Leeren im Erfolgspfad faellt 1.
 *
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ergebnis = { ok: boolean; fehler?: string };
let antworten: ((e: Ergebnis) => void) | null = null;
const aufrufe: string[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/lib/kommentar-actions", () => ({
  kommentarErstellen: (_bezug: unknown, fd: FormData) => {
    aufrufe.push(String(fd.get("text")));
    return new Promise<Ergebnis>((r) => {
      antworten = r;
    });
  },
  kommentarBearbeiten: async () => ({ ok: true }),
  kommentarLoeschen: async () => ({ ok: true }),
}));

const { Kommentare } = await import("./Kommentare");
const { KONTAKTDATEN_WARNUNG } = await import("@/lib/kommentar-modell");

const ICH = "00000000-0000-4000-8000-000000000001";
const STROM = "00000000-0000-4000-8000-0000000000aa";

function formular() {
  render(<Kommentare bezug={{ art: "biomasse", id: STROM }} kommentare={[]} zugang={{ id: ICH, rolle: "bearbeiter" }} darfErstellen />);
  const feld = screen.getByLabelText("Neuer Kommentar") as HTMLTextAreaElement;
  const knopf = screen.getByRole("button", { name: "Kommentieren" }) as HTMLButtonElement;
  return { feld, knopf };
}

async function antworte(e: Ergebnis) {
  await waitFor(() => expect(antworten).not.toBeNull());
  await act(async () => {
    antworten!(e);
    antworten = null;
  });
}

beforeEach(() => {
  aufrufe.length = 0;
  antworten = null;
});
afterEach(cleanup);

describe("Kommentar-Formular (jsdom)", () => {
  it("1+2 direkt: Knopf waehrend des Speicherns gesperrt, zweiter Klick ohne Aufruf, danach Feld leer", async () => {
    const { feld, knopf } = formular();
    fireEvent.change(feld, { target: { value: "Hallo Welt" } });
    expect(knopf.disabled).toBe(false);
    fireEvent.click(knopf);
    await waitFor(() => expect(knopf.disabled).toBe(true));
    expect(aufrufe).toEqual(["Hallo Welt"]);
    fireEvent.click(knopf); // gesperrt: kein zweiter Aufruf (§45, doppeltes Anlegen)
    expect(aufrufe).toEqual(["Hallo Welt"]);
    await antworte({ ok: true });
    await waitFor(() => expect(feld.value).toBe(""));
    expect(knopf.disabled).toBe(false);
    expect(aufrufe).toHaveLength(1);
  });

  it("1+2 ueber die Kontaktdaten-Warnung: erst Warnung ohne Aufruf, Trotzdem-speichern sperrt beide Knoepfe, danach Feld leer", async () => {
    const { feld, knopf } = formular();
    fireEvent.change(feld, { target: { value: "Bitte an max@example.org schreiben" } });
    fireEvent.click(knopf);
    const warnung = await screen.findByRole("alert");
    expect(warnung.textContent).toContain(KONTAKTDATEN_WARNUNG);
    expect(aufrufe).toEqual([]);
    const trotzdem = screen.getByRole("button", { name: "Trotzdem speichern" }) as HTMLButtonElement;
    fireEvent.click(trotzdem);
    await waitFor(() => expect(knopf.disabled).toBe(true));
    // Die Warnung verschwindet mit dem Klick — ein zweites „Trotzdem speichern" gibt es nicht mehr,
    // und der Haupt-Knopf ist gesperrt: kein zweiter Aufruf.
    expect(screen.queryByRole("button", { name: "Trotzdem speichern" })).toBeNull();
    expect(aufrufe).toEqual(["Bitte an max@example.org schreiben"]);
    fireEvent.click(knopf);
    expect(aufrufe).toHaveLength(1);
    await antworte({ ok: true });
    await waitFor(() => expect(feld.value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(knopf.disabled).toBe(false);
  });

  it("3 Fehlschlag: Text bleibt stehen, Fehler sichtbar, Knopf wieder frei", async () => {
    const { feld, knopf } = formular();
    fireEvent.change(feld, { target: { value: "Bleibt stehen" } });
    fireEvent.click(knopf);
    await antworte({ ok: false, fehler: "Kein Recht für diese Aktion." });
    await waitFor(() => expect(knopf.disabled).toBe(false));
    expect(feld.value).toBe("Bleibt stehen");
    expect(screen.getByRole("alert").textContent).toContain("Kein Recht für diese Aktion.");
  });
});
