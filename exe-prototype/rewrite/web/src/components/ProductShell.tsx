import { CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

export type ProductNavItem = {
  key: string;
  label: string;
  description?: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void | Promise<void>;
};

export type ProductNavGroup = {
  title: string;
  items: ProductNavItem[];
};

export type ProductGlobalCommand = {
  key: string;
  label: string;
  description?: string;
  group: string;
  icon: ReactNode;
  keywords?: string[];
  active?: boolean;
  onClick: () => void | Promise<void>;
};

export function ProductShell({
  statusText,
  activeTitle,
  activeSubtitle,
  navGroups,
  globalCommands = [],
  databaseOk,
  llmConfigured,
  version,
  message,
  error,
  onRefresh,
  children
}: {
  statusText: string;
  activeTitle: string;
  activeSubtitle: string;
  navGroups: ProductNavGroup[];
  globalCommands?: ProductGlobalCommand[];
  databaseOk: boolean;
  llmConfigured: boolean;
  version: string;
  message?: string | null;
  error?: string | null;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const displayVersion = version.startsWith("v") ? version : `v${version}`;
  const activeGroupIndex = Math.max(0, navGroups.findIndex((group) => group.items.some((item) => item.active)));
  const activeGroup = navGroups[activeGroupIndex] || navGroups[0];
  const activeItem = activeGroup?.items.find((item) => item.active);
  const commandItems = useMemo(
    () => [
      ...navGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title, keywords: [item.label, item.description || "", group.title] }))),
      ...globalCommands
    ],
    [globalCommands, navGroups]
  );
  const commandResults = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandItems.slice(0, 8);
    return commandItems
      .filter((item) => [item.label, item.description || "", item.group, ...(item.keywords || [])].some((value) => value.toLowerCase().includes(query)))
      .slice(0, 14);
  }, [commandItems, commandQuery]);
  const groupedCommandResults = useMemo(() => {
    const groups: Array<{ title: string; items: typeof commandResults }> = [];
    for (const item of commandResults) {
      let group = groups.find((entry) => entry.title === item.group);
      if (!group) {
        group = { title: item.group, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, [commandResults]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        commandInputRef.current?.focus();
        commandInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    if (selectedCommandIndex >= commandResults.length) {
      setSelectedCommandIndex(Math.max(0, commandResults.length - 1));
    }
  }, [commandResults.length, selectedCommandIndex]);

  function runCommand(item: (typeof commandItems)[number]) {
    item.onClick();
    setCommandQuery("");
    setCommandOpen(false);
    setSelectedCommandIndex(0);
  }

  return (
    <main className={collapsed ? "product-shell is-collapsed" : "product-shell"}>
      <aside className="product-sidebar">
        <section className="product-brand">
          <div className="product-brand-mark">CL</div>
          {!collapsed && (
            <div>
              <h1>CodeLens Pro Next</h1>
              <p>{statusText}</p>
            </div>
          )}
          <button className="sidebar-toggle" type="button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "展开侧边栏" : "收起侧边栏"}>
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </section>

        <nav className="product-nav">
          {navGroups.map((group) => (
            <section className="product-nav-group" key={group.title}>
              {!collapsed && <span>{group.title}</span>}
              {group.items.map((item) => (
                <button className={item.active ? "product-nav-item active" : "product-nav-item"} key={item.key} onClick={item.onClick} title={collapsed ? item.label : item.description || item.label}>
                  {item.icon}
                  {!collapsed && (
                    <strong>
                      {item.label}
                      {item.description && <small>{item.description}</small>}
                    </strong>
                  )}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <section className="product-status-dock">
          <StatusBadge ok={databaseOk} text={databaseOk ? "SQLite 正常" : "数据库异常"} />
          <StatusBadge ok={llmConfigured} text={llmConfigured ? "LLM 已配置" : "本地分析"} />
          <StatusBadge ok text={displayVersion} />
        </section>
      </aside>

      <section className="product-main">
        <header className="product-topbar">
          <div>
            <span className="product-eyebrow">本地桌面工具</span>
            <h2>{activeTitle}</h2>
            <p>{activeSubtitle}</p>
          </div>
          <div className="product-command-search-next">
            <Search size={17} />
            <input
              ref={commandInputRef}
              value={commandQuery}
              onChange={(event) => {
                setCommandQuery(event.target.value);
                setCommandOpen(true);
              }}
              onFocus={() => setCommandOpen(true)}
              onBlur={() => window.setTimeout(() => setCommandOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCommandOpen(true);
                  setSelectedCommandIndex((value) => Math.min(commandResults.length - 1, value + 1));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedCommandIndex((value) => Math.max(0, value - 1));
                }
                if (event.key === "Enter" && commandResults[selectedCommandIndex]) {
                  event.preventDefault();
                  runCommand(commandResults[selectedCommandIndex]);
                }
                if (event.key === "Escape") {
                  setCommandOpen(false);
                  setCommandQuery("");
                }
              }}
              placeholder="搜索页面、报告、问题、卡片..."
            />
            <kbd>Ctrl K</kbd>
            {commandQuery && (
              <button type="button" onClick={() => { setCommandQuery(""); setCommandOpen(false); }} title="清空搜索">
                <X size={15} />
              </button>
            )}
            {commandOpen && (
              <div className="product-command-menu-next">
                <span>快速跳转</span>
                {groupedCommandResults.map((group) => {
                  let offset = 0;
                  for (const entry of groupedCommandResults) {
                    if (entry.title === group.title) break;
                    offset += entry.items.length;
                  }
                  return (
                    <section className="product-command-group-next" key={group.title}>
                      <strong>{group.title}</strong>
                      {group.items.map((item, index) => {
                        const commandIndex = offset + index;
                        return (
                          <button
                            className={`${item.active ? "active entity" : "entity"} ${commandIndex === selectedCommandIndex ? "selected" : ""}`}
                            key={item.key}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setSelectedCommandIndex(commandIndex)}
                            onClick={() => runCommand(item)}
                            type="button"
                          >
                            {item.icon}
                            <span>
                              <em>{item.label}</em>
                              <small>{item.description || "打开页面"}</small>
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  );
                })}
                {commandResults.length === 0 && <p>没有匹配的页面入口。</p>}
                {commandResults.length > 0 && <footer>↑↓ 选择 / Enter 打开 / Esc 关闭</footer>}
              </div>
            )}
          </div>
          <div className="product-topbar-actions">
            <div className="product-topbar-state">
              <StatusBadge ok={databaseOk} text={databaseOk ? "SQLite 正常" : "数据库异常"} />
              <StatusBadge ok={llmConfigured} text={llmConfigured ? "LLM 增强" : "本地规则"} />
              <StatusBadge ok text={displayVersion} />
            </div>
            <button className="icon-button refresh-button" onClick={onRefresh} title="刷新当前数据">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        <section className="product-command-strip-next">
          <div className="product-stage-summary-next">
            <span>当前阶段</span>
            <strong>{activeGroup?.title || "工作主线"}</strong>
            <small>{activeItem?.label || activeTitle}</small>
          </div>
          <div className="product-stage-list-next">
            {navGroups.map((group, index) => (
              <button
                className={index === activeGroupIndex ? "active" : index < activeGroupIndex ? "done" : ""}
                type="button"
                key={group.title}
                onClick={group.items[0]?.onClick}
              >
                <span>{index + 1}</span>
                <strong>{group.title}</strong>
                <small>{group.items.length} 个入口</small>
              </button>
            ))}
          </div>
          <div className="product-quick-entry-next">
            <span>阶段入口</span>
            <div>
              {(activeGroup?.items || []).map((item) => (
                <button className={item.active ? "active" : ""} key={item.key} type="button" onClick={item.onClick}>
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {message && <div className="notice success"><CheckCircle2 size={18} />{message}</div>}
        {error && <div className="notice error"><TriangleAlert size={18} />{error}</div>}

        <div className="product-page">{children}</div>
      </section>
    </main>
  );
}

function StatusBadge({ ok, text }: { ok: boolean; text: string }) {
  return <span className={ok ? "product-status ok" : "product-status muted"}>{text}</span>;
}
