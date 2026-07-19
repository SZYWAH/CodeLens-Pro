import { CheckCircle2, ChevronLeft, ChevronRight, Menu, Moon, RefreshCw, Search, Sun, TriangleAlert, X } from "lucide-react";
import { createContext, ReactNode, useContext, useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";

const ProductToolbarTargetContext = createContext<HTMLDivElement | null>(null);

export function ProductToolbar({ children }: { children: ReactNode }) {
  const target = useContext(ProductToolbarTargetContext);
  return target ? createPortal(children, target) : null;
}

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
  onDismissMessage,
  onDismissError,
  onRefresh,
  theme,
  onToggleTheme,
  mainContentRef,
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
  onDismissMessage?: () => void;
  onDismissError?: () => void;
  onRefresh: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  mainContentRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("codelens.shell.expanded") !== "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const commandListboxId = useId();
  const displayVersion = version.startsWith("v") ? version : `v${version}`;
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
    if (!commandOpen) return;
    const frame = window.requestAnimationFrame(() => {
      commandInputRef.current?.focus();
      commandInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [commandOpen]);

  useEffect(() => {
    window.localStorage.setItem("codelens.shell.expanded", String(!collapsed));
  }, [collapsed]);

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

  function runNavItem(item: ProductNavItem) {
    item.onClick();
    setMobileOpen(false);
  }

  const shellClassName = [
    "product-shell",
    collapsed ? "is-collapsed" : "is-expanded",
    mobileOpen ? "is-mobile-open" : ""
  ].filter(Boolean).join(" ");
  const showLabels = !collapsed || mobileOpen;
  const runtimeLabel = databaseOk ? "本地就绪" : "数据库异常";
  const runtimeDetail = `${llmConfigured ? "LLM 增强" : "本地规则"} · ${displayVersion}`;

  return (
    <main className={shellClassName}>
      <div className="product-shell-entry-transition" aria-hidden="true" />
      <aside className="product-sidebar">
        <section className="product-brand">
          <div className="product-brand-mark" title="CodeLens Pro Next">CL</div>
          {showLabels && (
            <div>
              <h1>CodeLens Pro Next</h1>
              <p>本地代码审查</p>
            </div>
          )}
          <button className="sidebar-toggle" type="button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "展开侧边栏" : "收起侧边栏"}>
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
          <button className="product-mobile-close" type="button" onClick={() => setMobileOpen(false)} title="关闭导航">
            <X size={17} />
          </button>
        </section>

        <nav className="product-nav">
          {navGroups.map((group) => (
            <section className="product-nav-group" key={group.title}>
              {showLabels && <span>{group.title}</span>}
              {group.items.map((item) => (
                <button
                  aria-current={item.active ? "page" : undefined}
                  className={item.active ? "product-nav-item active" : "product-nav-item"}
                  key={item.key}
                  onClick={() => runNavItem(item)}
                  title={item.description ? `${item.label}：${item.description}` : item.label}
                  type="button"
                >
                  {item.icon}
                  {showLabels && <strong>{item.label}</strong>}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <section className="product-runtime" title={`${statusText} · ${runtimeDetail}`}>
          <span className={databaseOk ? "product-runtime-dot ok" : "product-runtime-dot warning"} />
          {showLabels && (
            <div>
              <strong>{runtimeLabel}</strong>
              <small>{runtimeDetail}</small>
            </div>
          )}
        </section>
      </aside>
      <button className="product-sidebar-scrim" type="button" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />

      <section className="product-main" ref={mainContentRef} tabIndex={-1}>
        <header className="product-topbar">
          <button className="product-mobile-menu" type="button" onClick={() => setMobileOpen(true)} title="打开导航">
            <Menu size={18} />
          </button>
          <div className="product-page-heading">
            <h2>{activeTitle}</h2>
            <p>{activeSubtitle}</p>
          </div>
          <div className={`product-command-search-next ${commandOpen ? "is-open" : ""}`}>
            <button
              className="product-command-search-trigger-next"
              type="button"
              onClick={() => commandInputRef.current?.focus()}
              title="搜索页面和内容"
              aria-label="搜索页面和内容"
            >
              <Search size={17} />
            </button>
            <input
              ref={commandInputRef}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commandOpen}
              aria-controls={commandListboxId}
              aria-activedescendant={commandOpen && commandResults[selectedCommandIndex]
                ? `${commandListboxId}-option-${selectedCommandIndex}`
                : undefined}
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
                  if (commandResults.length) setSelectedCommandIndex((value) => (value + 1) % commandResults.length);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCommandOpen(true);
                  if (commandResults.length) setSelectedCommandIndex((value) => (value - 1 + commandResults.length) % commandResults.length);
                }
                if (event.key === "Enter" && commandResults[selectedCommandIndex]) {
                  event.preventDefault();
                  runCommand(commandResults[selectedCommandIndex]);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCommandOpen(false);
                  setCommandQuery("");
                  setSelectedCommandIndex(0);
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
                <div aria-label="快速跳转" id={commandListboxId} role="listbox">
                  {groupedCommandResults.map((group) => {
                    let offset = 0;
                    for (const entry of groupedCommandResults) {
                      if (entry.title === group.title) break;
                      offset += entry.items.length;
                    }
                    return (
                      <section
                        aria-labelledby={`${commandListboxId}-group-${offset}`}
                        className="product-command-group-next"
                        key={group.title}
                        role="group"
                      >
                        <strong id={`${commandListboxId}-group-${offset}`}>{group.title}</strong>
                        {group.items.map((item, index) => {
                          const commandIndex = offset + index;
                          return (
                            <button
                              aria-selected={commandIndex === selectedCommandIndex}
                              className={`${item.active ? "active entity" : "entity"} ${commandIndex === selectedCommandIndex ? "selected" : ""}`}
                              id={`${commandListboxId}-option-${commandIndex}`}
                              key={item.key}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setSelectedCommandIndex(commandIndex)}
                              onClick={() => runCommand(item)}
                              role="option"
                              tabIndex={-1}
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
                </div>
                {commandResults.length === 0 && <p aria-live="polite">没有匹配结果</p>}
                {commandResults.length > 0 && <footer>↑↓ 选择 / Enter 打开 / Esc 关闭</footer>}
              </div>
            )}
          </div>
          <div className="product-page-toolbar-next" ref={setToolbarTarget} />
          <div className="product-topbar-actions">
            <button
              className="icon-button theme-toggle-button"
              onClick={onToggleTheme}
              title={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
              aria-label={theme === "dark" ? "切换到亮色主题" : "切换到暗色主题"}
              type="button"
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="icon-button refresh-button" onClick={onRefresh} title="刷新当前数据" type="button">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {(message || error) && typeof document !== "undefined" && createPortal(
          <div className="product-notices" aria-live="polite">
            {message && (
              <div className="notice success" role="status">
                <CheckCircle2 size={18} />
                <span>{message}</span>
                {onDismissMessage && <button aria-label="关闭成功提示" onClick={onDismissMessage} title="关闭提示" type="button"><X size={15} /></button>}
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                <TriangleAlert size={18} />
                <span>{error}</span>
                {onDismissError && <button aria-label="关闭错误提示" onClick={onDismissError} title="关闭提示" type="button"><X size={15} /></button>}
              </div>
            )}
          </div>,
          document.body
        )}

        <ProductToolbarTargetContext.Provider value={toolbarTarget}>
          <div className="product-page">{children}</div>
        </ProductToolbarTargetContext.Provider>
      </section>
    </main>
  );
}
