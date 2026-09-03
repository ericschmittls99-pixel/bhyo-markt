"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [string, string][] = [
  ["/register", "Register"],
  ["/karte", "Karte"],
  ["/auswertung", "Auswertung"],
  ["/bewertung", "Bewertung"],
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="app-nav">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={path.startsWith(href) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
