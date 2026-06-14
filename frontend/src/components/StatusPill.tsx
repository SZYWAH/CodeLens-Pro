export function StatusPill({
  ok,
  label,
  title,
  subtle
}: {
  ok: boolean;
  label: string;
  title?: string;
  subtle?: boolean;
}) {
  return (
    <span
      className={[
        "status-pill",
        ok ? "status-pill-ok" : subtle ? "status-pill-subtle" : "status-pill-error"
      ].join(" ")}
      title={title}
    >
      {label}
    </span>
  );
}
