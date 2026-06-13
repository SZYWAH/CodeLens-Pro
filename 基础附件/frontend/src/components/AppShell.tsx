import type { ReactNode } from "react";
import { useState } from "react";
import { Sidebar, type PageKey } from "./Sidebar";

export function AppShell({
  active,
  onNavigate,
  children
}: {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
  children: ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="app-frame flex min-h-screen text-ink">
      <Sidebar
        active={active}
        collapsed={sidebarCollapsed}
        onChange={onNavigate}
        onToggle={() => setSidebarCollapsed((value) => !value)}
      />
      <main className="h-screen min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
