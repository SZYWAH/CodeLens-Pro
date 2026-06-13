import {
  BarChart3,
  Bot,
  FileClock,
  GitCompare,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  type LucideIcon
} from "lucide-react";

export type PageKey = "workbench" | "diff" | "chat" | "history" | "settings";

const items: Array<{ key: PageKey; label: string; icon: LucideIcon }> = [
  { key: "workbench", label: "工作台", icon: Sparkles },
  { key: "diff", label: "代码对比", icon: GitCompare },
  { key: "chat", label: "AI 对话", icon: Bot },
  { key: "history", label: "历史报告", icon: FileClock },
  { key: "settings", label: "统计", icon: BarChart3 }
];

export function Sidebar({
  active,
  collapsed,
  onChange,
  onToggle
}: {
  active: PageKey;
  collapsed: boolean;
  onChange: (page: PageKey) => void;
  onToggle: () => void;
}) {
  return (
    <aside
      className={[
        "glass-panel m-3 mr-0 flex h-[calc(100vh-24px)] shrink-0 flex-col rounded-lg py-4 transition-[width,padding] duration-200",
        collapsed ? "w-[68px] px-2" : "w-[232px] px-3"
      ].join(" ")}
    >
      <div className={collapsed ? "mb-5 px-1" : "mb-5 px-2"}>
        <div className={collapsed ? "flex items-center justify-center" : "flex items-center gap-2"}>
          <div className="h-7 w-1.5 rounded-full bg-pine" />
          {!collapsed ? <div className="high-contrast-title text-[1.18rem] font-black tracking-normal">CodeLens Pro</div> : null}
        </div>
        {!collapsed ? (
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#b8c9e6]">Local analysis lab</div>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <button
              key={item.key}
              title={item.label}
              className={[
                "flex h-10 items-center rounded-md text-sm font-semibold transition",
                collapsed ? "justify-center px-0" : "gap-2 px-3",
                selected
                  ? "bg-[#132a4c] text-[#f8fbff] shadow-sm"
                  : "text-[#c5d7f2] hover:bg-[#111a2e] hover:text-pine"
              ].join(" ")}
              onClick={() => onChange(item.key)}
              type="button"
            >
              <Icon size={17} />
              {!collapsed ? <span>{item.label}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className={collapsed ? "border-t border-line px-1 pt-3" : "border-t border-line px-2 pt-3"}>
        <button
          className={collapsed ? "icon-button mx-auto" : "btn btn-secondary w-full"}
          onClick={onToggle}
          title={collapsed ? "展开边栏" : "收起边栏"}
          type="button"
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          {!collapsed ? <span>收起边栏</span> : null}
        </button>
        {!collapsed ? (
          <div className="mt-3">
            <div className="text-xs font-semibold text-[#d7e6ff]">FastAPI · React · MySQL</div>
            <div className="mt-1 text-xs leading-5 text-[#b8c9e6]">准产品本地演示版</div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
