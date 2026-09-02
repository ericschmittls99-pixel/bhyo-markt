import type { ReactNode } from "react";

import { currentUserEmail } from "@/lib/db";
import "./globals.css";

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
    <html lang="de">
      <body>
        <header className="app-header">
          <a className="brand" href="/register">
            <span className="dot" aria-hidden />
            bhyo Markttool
          </a>
          <span className="user">{email ?? "nicht angemeldet"}</span>
        </header>
        {children}
      </body>
    </html>
  );
}
