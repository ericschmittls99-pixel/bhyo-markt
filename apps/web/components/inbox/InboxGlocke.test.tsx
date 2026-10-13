/**
 * E77 R5: Render-Test des Pop-ups an der Glocke und der Kurzform — ohne Browser.
 * Der geschlossene Zustand (Knopf mit Zaehler, aria) und die Kurzform-Zeile
 * (Kurztitel · Kennung, Akteur, Zitat bei Aufgabe) sind statisch pruefbar; das
 * Laden beim Oeffnen (GET /api/inbox/kurz) belegt der Browser-Test auf der Preview.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/register",
}));
vi.mock("@/lib/inbox/actions", () => ({ inboxGelesen: async () => ({ ok: true }) }));

const { InboxGlocke } = await import("./InboxGlocke");
const { InboxKurztext } = await import("./InboxKurztext");

describe("InboxGlocke", () => {
  it("geschlossen: Knopf mit Pop-up-Semantik und Zaehler, kein Pop-up im Baum", () => {
    const html = renderToStaticMarkup(<InboxGlocke ungelesen={3} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Inbox, 3 ungelesen"');
    expect(html).toContain('<span class="hdr-badge">3</span>');
    expect(html).not.toContain("ib-pop");
    expect(renderToStaticMarkup(<InboxGlocke ungelesen={0} />)).not.toContain("hdr-badge");
  });
});

describe("InboxKurztext", () => {
  it("Kurztitel · Kennung, Buendel-Zaehler, Akteur und Zitat der Aufgabe in der Nebenzeile", () => {
    const html = renderToStaticMarkup(
      <InboxKurztext z={{ typ: "aufgabe", anzahl: 1, aufgabe: "Bitte aktualisieren", notiz: null, kurz: { titel: "Aufgabe", kennung: "B-2026-014", akteur: "Hof Meier" } }} />,
    );
    expect(html).toContain('<span class="ib-titel">Aufgabe</span>');
    expect(html).toContain('<span class="ib-kennung">B-2026-014</span>');
    expect(html).toContain('<span class="ib-neben">Hof Meier · „Bitte aktualisieren&quot;</span>');
    expect(html).not.toContain("ib-anzahl");
    const ohne = renderToStaticMarkup(<InboxKurztext z={{ typ: "mail_stoerung", anzahl: 2, aufgabe: null, notiz: null, kurz: { titel: "Tages-Mail gestört", kennung: null, akteur: null } }} />);
    expect(ohne).not.toContain("ib-kennung");
    expect(ohne).not.toContain("ib-neben");
    expect(ohne).toContain("2×");
  });
});
