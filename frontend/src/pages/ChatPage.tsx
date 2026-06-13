import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CalendarPopover } from "../components/CalendarPopover";
import { ChatPanel } from "../components/ChatPanel";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import type { ChatSessionListItem, SettingsResponse } from "../types";

type ChatFilter = "all" | "report" | "general";

export function ChatPage({
  settings,
  selectedSessionId,
  onSelectedSessionIdChange,
  onActivityChanged,
}: {
  settings: SettingsResponse | null;
  selectedSessionId: string | null;
  onSelectedSessionIdChange: (sessionId: string | null) => void;
  onActivityChanged?: () => void;
}) {
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      const next = await api.listChatSessions({
        query: query || undefined,
        context_type: filter === "all" ? undefined : filter,
        date_from: selectedDate || undefined,
        date_to: selectedDate || undefined,
      });
      setSessions(next.filter((item) => item.context_type !== "agent"));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "对话列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function removeSession(id: string) {
    await api.deleteChatSession(id);
    if (selectedSessionId === id) onSelectedSessionIdChange(null);
    await loadSessions();
  }

  useEffect(() => {
    void loadSessions();
  }, [filter, selectedDate]);

  return (
    <div className={["page-scroll chat-page-layout", historyOpen ? "chat-page-layout-open" : "chat-page-layout-closed"].join(" ")}>
      <section className={["tool-panel chat-history-sidebar", historyOpen ? "" : "chat-history-sidebar-collapsed"].filter(Boolean).join(" ")}>
        {historyOpen ? (
          <div className="border-b border-line p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-pine">Chat History</div>
                <h2 className="mt-0.5 truncate text-sm font-black text-[#f8fbff]">AI 对话</h2>
              </div>
              <button className="icon-button border border-line" onClick={() => setHistoryOpen(false)} title="收起历史边栏" type="button" aria-expanded={historyOpen}>
                <PanelLeftClose size={16} />
              </button>
            </div>
            <div className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="search-field-icon absolute left-2 top-2.5 text-[#b8c9e6]" size={15} />
                <input
                  className="control-field search-field-input h-9 w-full"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void loadSessions()}
                  placeholder="搜索聊天"
                  value={query}
                />
              </div>
              <button className="icon-button border border-line" onClick={loadSessions} title="刷新" type="button">
                <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
              </button>
            </div>
            <button className="btn btn-primary h-9 w-full" onClick={() => onSelectedSessionIdChange(null)} type="button">
              <MessageSquarePlus size={15} />
              新建聊天
            </button>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-md border border-line bg-[#070b14] p-1">
              {[
                ["all", "全部对话"],
                ["report", "报告对话"],
                ["general", "普通对话"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={[
                    "h-8 rounded text-xs font-black transition",
                    filter === key ? "bg-[#2563eb] text-white" : "text-[#c5d7f2] hover:bg-[#111a2e] hover:text-pine",
                  ].join(" ")}
                  onClick={() => setFilter(key as ChatFilter)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="chat-date-filter-row">
              <CalendarPopover
                value={selectedDate}
                onChange={setSelectedDate}
                label={selectedDate ? `选择日期：${selectedDate.slice(5)}` : "全部日期"}
              />
            </div>
            {error ? <div className="mt-2 text-xs text-coral">{error}</div> : null}
          </div>
        ) : (
          <div className="chat-history-rail">
            <button className="icon-button border border-line" onClick={() => setHistoryOpen(true)} title="展开历史边栏" type="button" aria-expanded={historyOpen}>
              <PanelLeftOpen size={17} />
            </button>
            <div className="chat-history-rail-label">历史</div>
          </div>
        )}

        {historyOpen ? (
          <div className="history-list-scroll">
            {sessions.map((item) => (
              <div
                key={item.id}
                className={[
                  "history-card-shell group",
                  selectedSessionId === item.id ? "history-card-active" : "history-card-idle",
                ].join(" ")}
              >
                <button className="history-card-main" onClick={() => onSelectedSessionIdChange(item.id)} type="button">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="history-card-title">{item.title}</div>
                      <div className="history-card-meta">
                        <span>{formatTime(item.updated_at)}</span>
                        <span className="chat-session-badge">{chatSessionBadge(item)}</span>
                      </div>
                    </div>
                  </div>
                </button>
                <button className="history-card-delete icon-button m-2 h-8 w-8 opacity-0 group-hover:opacity-100" onClick={() => removeSession(item.id)} title="删除聊天" type="button">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!sessions.length ? <div className="p-4 text-sm text-[#b8c9e6]">暂无聊天记录</div> : null}
          </div>
        ) : null}
      </section>

      <ChatPanel
        key={selectedSessionId ?? "new-chat"}
        className="min-h-[520px] xl:min-h-0"
        settings={settings}
        mode="general"
        sessionId={selectedSessionId}
        onSessionIdChange={onSelectedSessionIdChange}
        onSessionSaved={() => {
          void loadSessions();
          onActivityChanged?.();
        }}
      />
    </div>
  );
}

function chatSessionBadge(item: ChatSessionListItem) {
  if (item.context_type === "report") return "报告对话";
  return "普通对话";
}
