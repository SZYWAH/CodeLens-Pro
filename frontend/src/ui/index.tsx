import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "default" | "primary" | "ghost" | "danger";

export function Button({
  tone = "default",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button className={["ui-button", `ui-button-${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={["ui-icon-button", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </button>
  );
}

export function Surface({
  children,
  className = "",
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <motion.section
      className={["ui-surface", interactive ? "ui-surface-interactive" : "", className].filter(Boolean).join(" ")}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 0.8, 0.22, 1] }}
    >
      {children}
    </motion.section>
  );
}

export function Metric({
  label,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon?: ReactNode;
  tone?: "blue" | "cyan" | "amber" | "violet" | "rose";
}) {
  return (
    <div className={`ui-metric ui-metric-${tone}`}>
      <div className="ui-metric-icon">{icon}</div>
      <div className="ui-metric-label">{label}</div>
      <div className="ui-metric-value">{value}</div>
      {detail ? <div className="ui-metric-detail">{detail}</div> : null}
    </div>
  );
}

export function StatusIndicator({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <span className={["ui-status", ok ? "ui-status-ok" : "ui-status-warn"].join(" ")}>
      <span className="ui-status-dot" />
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </span>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={180}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="ui-tooltip" sideOffset={8}>
            {label}
            <TooltipPrimitive.Arrow className="ui-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export const Tabs = TabsPrimitive;
export const Dialog = DialogPrimitive;
export const DropdownMenu = DropdownMenuPrimitive;
