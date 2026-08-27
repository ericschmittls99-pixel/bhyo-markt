import type { ReactNode } from "react";

export const metadata = {
  title: "bhyo Markttool",
  description: "Internes Marktdokumentations- und Analysewerkzeug",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
