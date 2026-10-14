/**
 * E77 R7: Render-Test des Profil-Reiters und des Avatars — ohne Browser.
 *   1. Profil: E-Mail nur lesbar, Anzeigename als Eingabe mit Grenze 80, Rolle als Pille,
 *      Datei-Eingabe nur fuer jpg/png/webp; ohne Bild „Bild wählen" und kein „entfernen",
 *      mit Bild „Bild ersetzen" und „Bild entfernen"; der Schalter der Tages-Mail steht darunter.
 *   2. Avatar: ohne bildUrl nur Initialen; mit bildUrl ein <img> ueber den Initialen (Fallback bleibt).
 *   3. HeaderBar: Avatar aus demselben Baustein (Initialen aus dem Namen, nicht aus der E-Mail),
 *      Menuepunkt „Profil & Einstellungen" fuehrt nach /einstellungen.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/einstellungen", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/profil-actions", () => ({
  anzeigenameSetzen: async () => ({ ok: true }),
  profilBildSetzen: async () => ({ ok: true }),
  profilBildEntfernen: async () => ({ ok: true }),
}));
vi.mock("@/lib/benutzer-actions", () => ({ roundupSetzen: async () => ({ ok: true }) }));
vi.mock("@/lib/mail-actions", () => ({ testversandAnMich: async () => ({ ok: true }) }));
vi.mock("@/lib/ui-state", () => ({ updateUiCookie: () => {} }));
vi.mock("@/components/inbox/InboxGlocke", () => ({ InboxGlocke: () => <span data-glocke /> }));

const { ProfilEinstellung } = await import("./ProfilEinstellung");
const { Avatar } = await import("@/components/Avatar");
const { HeaderBar } = await import("@/components/shell/HeaderBar");

const ICH = { id: "00000000-0000-4000-8000-0000000000e1", email: "eric.schmitt@bhyo.de", name: "Eric Schmitt", rolle: "bearbeiter" as const, roundup: true };

describe("ProfilEinstellung", () => {
  it("ohne Bild: E-Mail fest, Name aenderbar (max 80), Rolle als Pille, nur Bildtypen, kein Entfernen, Tages-Mail darunter", () => {
    const html = renderToStaticMarkup(<ProfilEinstellung profil={{ ...ICH, bildUrl: null }} />);
    // renderToStaticMarkup schreibt readOnly/maxLength in Kamelschrift, value am Ende des Tags.
    expect(html).toContain('<input type="text" readOnly="" aria-readonly="true" value="eric.schmitt@bhyo.de"/>');
    expect(html).toContain('name="name"');
    expect(html).toContain('maxLength="80"');
    expect(html).toContain('value="Eric Schmitt"');
    expect(html).toContain('<span class="konf konf--rolle">bearbeiter.</span>');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("Bild wählen");
    expect(html).not.toContain("Bild entfernen");
    expect(html).not.toContain("av-bild");
    expect(html).toContain('id="roundup"');
    // Speichern erst, wenn sich der Name geaendert hat.
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
  });
  it("mit Bild: Bild ersetzen und entfernen, Avatar xl mit <img>", () => {
    const html = renderToStaticMarkup(<ProfilEinstellung profil={{ ...ICH, bildUrl: "/api/profil/bild/x?v=1" }} />);
    expect(html).toContain("Bild ersetzen");
    expect(html).toContain("Bild entfernen");
    expect(html).toContain('class="av av--xl av-c');
    expect(html).toContain('<img class="av-bild" src="/api/profil/bild/x?v=1" alt=""');
  });
});

describe("Avatar", () => {
  it("ohne Bild nur Initialen, mit Bild ein <img> ueber den Initialen", () => {
    const ohne = renderToStaticMarkup(<Avatar nutzer={{ id: "u", name: "Eric Schmitt", email: "e@bhyo.de" }} />);
    expect(ohne).toContain(">ES<");
    expect(ohne).not.toContain("<img");
    const mit = renderToStaticMarkup(<Avatar nutzer={{ id: "u", name: "Eric Schmitt", email: "e@bhyo.de", bildUrl: "/api/profil/bild/u?v=7" }} groesse="l" />);
    expect(mit).toContain("av--l");
    expect(mit).toContain(">ES<img");
    expect(mit).toContain('src="/api/profil/bild/u?v=7"');
  });
});

describe("HeaderBar", () => {
  it("Avatar aus dem gemeinsamen Baustein (Initialen aus dem Namen) und Link zu Profil & Einstellungen", () => {
    const html = renderToStaticMarkup(
      <HeaderBar nutzer={{ id: "u", name: "Eric Schmitt", email: "eric.schmitt@bhyo.de", bildUrl: null }} rolle="admin" initialTheme="light" ungelesen={0} />,
    );
    expect(html).toContain('class="av av--m av-c');
    expect(html).toContain(">ES<");
    // Geschlossen: das Menue ist nicht im Baum; der Knopf traegt die Semantik.
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("Profil &amp; Einstellungen");
  });
  it("nicht angemeldet: Platzhalter-Avatar ohne Namen", () => {
    const html = renderToStaticMarkup(<HeaderBar nutzer={null} rolle={null} initialTheme="light" />);
    expect(html).toContain('aria-label="Konto"');
    expect(html).toContain(">??<");
  });
});
