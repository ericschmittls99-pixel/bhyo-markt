import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";

import { HeaderBar } from "@/components/shell/HeaderBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { ZugangSperre } from "@/components/shell/ZugangSperre";
import { adminKontakt, aktuellerZugang } from "@/lib/rechte/wache";
import { listRegionen } from "@/lib/register";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";

// Phosphor-Icons als selbst gebundelte Icon-Fonts (kein CDN zur Laufzeit).
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/bold";
import "@phosphor-icons/web/fill";
import "./globals.css";

// Geist (bhyo_2.0 v3): EINE Familie fuer alles, beim Build self-hosted.
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata = {
  title: "bhyogenics Tool",
  description: "Internes Marktdokumentations- und Analysewerkzeug",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Bedienzustand (Sidebar, Akkordeons, Theme) serverseitig aus dem Cookie —
  // die Client-Komponenten starten damit ohne Aufklapp-Flackern (Ansage 5).
  const ui = parseUiState((await cookies()).get(UI_COOKIE)?.value);
  const theme = ui.theme === "dark" ? "dark" : "light";

  // F8/E30: Der Zugang wird HIER entschieden, einmal fuer die ganze
  // Anwendung — nicht je Seite. Eine unbekannte oder deaktivierte Adresse
  // sieht statt der Oberflaeche die Zugangsseite; die Wache in den Actions
  // und Routen bleibt trotzdem bestehen, denn die Oberflaeche ist kein
  // Schutz (wer die Server-Action direkt aufruft, umgeht sie).
  //
  // Bewusst OHNE .catch(): Ist die Datenbank nicht erreichbar, gibt es keine
  // Zugangsentscheidung — dann muss ein Fehler sichtbar werden. Die Alternative
  // waere, einen Infrastrukturausfall als "kein Zugang eingerichtet" auszugeben
  // und die Person zum Admin zu schicken, obwohl ihr Konto in Ordnung ist.
  const zugang = await aktuellerZugang();

  if (zugang.art === "unbekannt" || zugang.art === "deaktiviert") {
    const kontakt = await adminKontakt().catch(() => null);
    return (
      <html lang="de" data-theme={theme} className={geist.variable}>
        <body>
          <div className="shell shell--gesperrt">
            <ZugangSperre grund={zugang.art} email={zugang.email} adminKontakt={kontakt} />
          </div>
        </body>
      </html>
    );
  }

  const email = zugang.art === "erlaubt" ? zugang.email : null;
  // Fokusregionen fuer das planer.-Akkordeon; ohne DB bleibt die Liste leer.
  const regionen = await listRegionen().catch(() => []);

  return (
    <html lang="de" data-theme={theme} className={geist.variable}>
      <body>
        <div className="shell">
          <Suspense fallback={null}>
            <Sidebar regionen={regionen} initial={ui} />
          </Suspense>
          <div className="shell-main">
            <Suspense fallback={null}>
              <HeaderBar
                email={email}
                rolle={zugang.art === "erlaubt" ? zugang.rolle : null}
                initialTheme={theme}
              />
            </Suspense>
            <div className="shell-content">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
