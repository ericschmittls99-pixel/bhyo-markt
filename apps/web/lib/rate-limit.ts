// Ratenbegrenzung fuer den Geocoding-Proxy (F0a): ein offener Proxy auf
// einen fremden Dienst waere auch hinter Access eine Einladung. Fixed
// Window je Schluessel, Isolate-lokal im Worker — bewusst best effort:
// mehrere Isolates zaehlen getrennt, was fuer 5-10 interne Nutzer und
// den Schutz des Fremd-Dienstes reicht. Zeit wird injiziert (testbar).

export function erstelleRateLimit(limit: number, fensterMs: number) {
  const fenster = new Map<string, { start: number; n: number }>();
  return function erlaubt(schluessel: string, jetztMs: number): boolean {
    const f = fenster.get(schluessel);
    if (!f || jetztMs - f.start >= fensterMs) {
      fenster.set(schluessel, { start: jetztMs, n: 1 });
      return true;
    }
    f.n += 1;
    return f.n <= limit;
  };
}
