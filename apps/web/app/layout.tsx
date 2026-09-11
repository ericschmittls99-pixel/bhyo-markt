import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";

import { HeaderBar } from "@/components/shell/HeaderBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { currentUserEmail } from "@/lib/db";
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

  const [email, regionen] = await Promise.all([
    currentUserEmail().catch(() => null),
    // Fokusregionen fuer das planer.-Akkordeon; ohne DB bleibt die Liste leer.
    listRegionen().catch(() => []),
  ]);

  return (
    <html lang="de" data-theme={theme} className={geist.variable}>
      <body>
        <div className="shell">
          <Suspense fallback={null}>
            <Sidebar regionen={regionen} initial={ui} />
          </Suspense>
          <div className="shell-main">
            <Suspense fallback={null}>
              <HeaderBar email={email} initialTheme={theme} />
            </Suspense>
            <div className="shell-content">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
