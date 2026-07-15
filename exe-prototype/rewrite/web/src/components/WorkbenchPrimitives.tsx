import { Loader2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export type WorkbenchMetricItem = {
  label: string;
  value: ReactNode;
  tone?: string;
};

export function WorkbenchCommandBar({
  action,
  ariaLabel,
  children,
  className = "",
  description,
  icon,
  title
}: {
  action: ReactNode;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className={`workbench-commandbar-v1419 ${className}`.trim()} aria-label={ariaLabel}>
      <div className="workbench-command-context-v1419">
        <span>{icon}</span>
        <div><strong>{title}</strong><small>{description}</small></div>
      </div>
      <div className="workbench-command-controls-v1419">{children}</div>
      <div className="workbench-command-action-v1419">{action}</div>
    </section>
  );
}

export function WorkbenchMetricStrip({ items }: { items: WorkbenchMetricItem[] }) {
  const style = { "--workbench-metric-columns": items.length } as CSSProperties;
  return (
    <dl className={`workbench-metrics-v1419 is-${items.length}`} style={style}>
      {items.map((item) => (
        <div className={item.tone ? `tone-${item.tone}` : undefined} key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WorkbenchGenerationStrip({ detail, title }: { detail: string; title: string }) {
  return (
    <section className="workbench-generation-v1419" aria-live="polite">
      <Loader2 className="spin" size={16} />
      <div><strong>{title}</strong><small>{detail}</small></div>
    </section>
  );
}

export function WorkbenchEditorSurface({
  actions,
  ariaLabel,
  children,
  className = "",
  id,
  labelledBy,
  role,
  title
}: {
  actions?: ReactNode;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  id?: string;
  labelledBy?: string;
  role?: "region" | "tabpanel";
  title: ReactNode;
}) {
  return (
    <section className={`workbench-editor-surface-v1419 ${className}`.trim()} aria-label={ariaLabel} aria-labelledby={labelledBy} id={id} role={role}>
      <header className="workbench-editor-head-v1419">
        <div className="workbench-editor-title-v1419">{title}</div>
        {actions && <div className="workbench-editor-actions-v1419">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
