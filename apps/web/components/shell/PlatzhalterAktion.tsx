"use client";

import { useRef, useState } from "react";

/**
 * Button, dessen Funktion laut Mockup erst spaeter kommt: zeigt beim Klick den
 * im Mockup vorgesehenen Hinweis-Toast statt einer echten Aktion.
 */
export function PlatzhalterAktion({
  label,
  icon,
  toast,
}: {
  label: string;
  icon?: string;
  toast: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function klick() {
    setMsg(toast);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4000);
  }

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={klick}>
        {icon && <i className={`ph ph-${icon}`} aria-hidden />}
        {label}
      </button>
      {msg && (
        <div className="toast" role="status">
          <i className="ph ph-info" aria-hidden />
          {msg}
        </div>
      )}
    </>
  );
}
