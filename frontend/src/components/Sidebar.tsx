import {
  BarChart3,
  Bot,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Compass,
  Cpu,
  FileClock,
  GitCompare,
  Layers3,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "../ui";

export type PageKey =
  | "workbench"
  | "diff"
  | "chat"
  | "agent"
  | "learning"
  | "knowledgeCards"
  | "projectGuide"
  | "learningReview"
  | "history"
  | "settings"
  | "activityGalaxy";

const navGroups: Array<{
  title: string;
  items: Array<{ key: PageKey; label: string; icon: LucideIcon }>;
}> = [
  {
    title: "分析主线",
    items: [
      { key: "workbench", label: "代码工作台", icon: Sparkles },
      { key: "diff", label: "代码对比", icon: GitCompare },
      { key: "history", label: "历史报告", icon: FileClock },
    ],
  },
  {
    title: "学习沉淀",
    items: [
      { key: "knowledgeCards", label: "知识卡片", icon: Layers3 },
      { key: "learning", label: "每日日志", icon: BookOpenText },
    ],
  },
  {
    title: "项目协作",
    items: [
      { key: "agent", label: "Agent 工作区", icon: Cpu },
      { key: "projectGuide", label: "项目导读", icon: Compass },
    ],
  },
  {
    title: "复盘展示",
    items: [
      { key: "chat", label: "AI 对话", icon: Bot },
      { key: "settings", label: "统计看板", icon: BarChart3 },
    ],
  },
];

export function Sidebar({
  active,
  collapsed,
  onChange,
  onToggle,
}: {
  active: PageKey;
  collapsed: boolean;
  onChange: (page: PageKey) => void;
  onToggle: () => void;
}) {
  return (
    <aside className={["glass-panel m-4 mr-0 flex shrink-0 flex-col rounded-md p-2", collapsed ? "w-16" : "w-44"].join(" ")}>
      <div className="mb-2.5 flex min-h-8 items-center gap-2">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-[#0d1930] text-[10px] font-black text-pine">CL</div>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black text-[#f8fbff]">CodeLens Pro</div>
            <div className="truncate text-[10px] font-bold text-[#9fb3ce]">分析 · 沉淀 · Agent</div>
          </div>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-2" aria-label="主导航">
        {navGroups.map((group) => (
          <div className="sidebar-nav-group" key={group.title}>
            {!collapsed ? <div className="sidebar-nav-group-title">{group.title}</div> : null}
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const selected = active === item.key;
                const button = (
                  <button
                    key={item.key}
                    title={item.label}
                    className={[
                      "flex h-8 items-center gap-2 rounded-md px-2 text-[12px] font-bold transition",
                      collapsed ? "justify-center px-0" : "",
                      selected ? "bg-[#102647] text-pine" : "text-[#b8c9e6] hover:bg-[#111a2e] hover:text-pine",
                    ].join(" ")}
                    onClick={() => onChange(item.key)}
                    type="button"
                  >
                    <Icon size={16} />
                    {!collapsed ? <span>{item.label}</span> : null}
                  </button>
                );

                return collapsed ? (
                  <Tooltip key={item.key} label={`${group.title} · ${item.label}`}>
                    {button}
                  </Tooltip>
                ) : button;
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line pt-2">
        <button
          className={collapsed ? "icon-button mx-auto" : "btn btn-secondary w-full"}
          onClick={onToggle}
          title={collapsed ? "展开导航" : "收起导航"}
          type="button"
        >
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          {!collapsed ? <span>收起导航</span> : null}
        </button>
        {!collapsed ? (
          <div className="mt-2 truncate text-[10px] leading-4 text-[#9fb3ce]">
            <strong>Local Prototype</strong>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
