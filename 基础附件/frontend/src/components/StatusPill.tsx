export function StatusPill({
  ok,
  label,
  subtle
}: {
  ok: boolean;
  label: string;
  subtle?: boolean;
}) {
  return (
    <span
      className={[
        "status-pill",
        ok ? "status-pill-ok" : subtle ? "status-pill-subtle" : "status-pill-error"
      ].join(" ")}
    >
      {label}
    </span>
  );
}
