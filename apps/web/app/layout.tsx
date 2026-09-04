import type { ReactNode } from "react";
import { Inter, Manrope } from "next/font/google";

import { NavLinks } from "@/components/NavLinks";
import { currentUserEmail } from "@/lib/db";
import "./globals.css";

// Fonts werden beim Build self-hosted (kein externer Request zur Laufzeit –
// wichtig fuer Cloudflare Workers und CSP). Nutzung ausschliesslich ueber die
// CSS-Variablen --font-display / --font-text in globals.css.
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-text",
  display: "swap",
});

export const metadata = {
  title: "bhyo Markttool",
  description: "Internes Marktdokumentations- und Analysewerkzeug",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const email = await currentUserEmail().catch(() => null);

  return (
    <html lang="de" className={`${manrope.variable} ${inter.variable}`}>
      <body>
        <header className="app-header">
          <a className="brand" href="/register">
            <span className="dot" aria-hidden />
            bhyo Markttool
          </a>
          <NavLinks />
          <span className="user">{email ?? "nicht angemeldet"}</span>
        </header>
        {children}
      </body>
    </html>
  );
}
