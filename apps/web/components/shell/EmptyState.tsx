import type { ReactNode } from "react";

/** Leerzustand laut V2-Mockup: Icon-Scheibe, Titel (lowercase + Punkt), Text, Aktionen. */
export function EmptyState({
  icon,
  titel,
  beschreibung,
  children,
}: {
  icon: string;
  titel: string;
  beschreibung?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="disc">
        <i className={`ph ph-${icon}`} aria-hidden />
      </span>
      <h2>{titel}</h2>
      {beschreibung && <p>{beschreibung}</p>}
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
