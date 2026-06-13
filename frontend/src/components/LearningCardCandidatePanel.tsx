import { Check, Loader2, Save, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import type { LearningCardCandidate } from "../types";

type EditableCandidate = LearningCardCandidate & {
  local_id: string;
  selected: boolean;
};

export function LearningCardCandidatePanel({
  candidates,
  title = "知识卡片候选",
  description = "选择真正值得沉淀的知识点，保存后会进入知识卡片页。",
  emptyText = "暂无可保存的知识卡片候选。",
  compactByDefault = false,
  onSaved,
  onDismiss,
}: {
  candidates: LearningCardCandidate[];
  title?: string;
  description?: string;
  emptyText?: string;
  compactByDefault?: boolean;
  onSaved?: (created: number, skipped: number) => void;
  onDismiss?: () => void;
}) {
  const [items, setItems] = useState<EditableCandidate[]>(() =>
    candidates.map((candidate, index) => ({
      ...candidate,
      local_id: `${candidate.source_id ?? "candidate"}-${index}-${candidate.title}`,
      selected: true,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(!compactByDefault);
  const selectedCount = useMemo(() => items.filter((item) => item.selected).length, [items]);

  function updateItem(index: number, patch: Partial<EditableCandidate>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function setAll(selected: boolean) {
    setItems((current) => current.map((item) => ({ ...item, selected })));
  }

  async function saveSelected() {
    const selected = items
      .filter((item) => item.selected)
      .map(({ local_id: _localId, selected: _selected, ...candidate }) => ({
        ...candidate,
        tags: normalizeTagInput(candidate.tags),
      }));
    if (!selected.length) {
      setMessage("当前没有选择要保存的知识卡片。");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api.createLearningCardsBulk(selected);
      setMessage(`已保存 ${result.created} 张知识卡片，跳过 ${result.skipped} 张重复卡片。`);
      setItems((current) =>
        current.map((item) => {
          const saved = selected.some((candidate) => candidate.title === item.title && candidate.source_id === item.source_id);
          return saved ? { ...item, selected: false } : item;
        })
      );
      onSaved?.(result.created, result.skipped);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存知识卡片失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={["learning-card-candidate-panel", expanded ? "learning-card-candidate-panel-expanded" : "learning-card-candidate-panel-compact"].join(" ")}>
      <div className="learning-card-candidate-head">
        <div>
          <span><Sparkles size={14} /> Candidate Cards</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setExpanded((value) => !value)} type="button">
          {expanded ? "收起候选" : `展开 ${items.length} 张候选`}
        </button>
        {onDismiss ? (
          <button className="icon-button" onClick={onDismiss} type="button" title="关闭候选卡片">
            <X size={16} />
          </button>
        ) : null}
      </div>

      {items.length && !expanded ? (
        <div className="learning-card-candidate-summary">
          {items.slice(0, 4).map((item) => <span key={item.local_id}>{item.title}</span>)}
          {items.length > 4 ? <span>+{items.length - 4}</span> : null}
        </div>
      ) : null}

      {items.length && expanded ? (
        <>
          <div className="learning-card-candidate-toolbar">
            <span>已选择 {selectedCount} / {items.length}</span>
            <button onClick={() => setAll(true)} type="button">全选</button>
            <button onClick={() => setAll(false)} type="button">全不选</button>
            <button className="btn btn-primary" onClick={saveSelected} disabled={saving || !selectedCount} type="button">
              {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
              保存选中
            </button>
          </div>

          <div className="learning-card-candidate-list">
            {items.map((item, index) => (
              <article key={item.local_id} className={item.selected ? "learning-card-candidate selected" : "learning-card-candidate"}>
                <label className="learning-card-candidate-check">
                  <input
                    checked={item.selected}
                    onChange={(event) => updateItem(index, { selected: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{item.selected ? <Check size={13} /> : null}</span>
                </label>
                <div className="learning-card-candidate-body">
                  <div className="learning-card-candidate-grid">
                    <input
                      value={item.title}
                      onChange={(event) => updateItem(index, { title: event.target.value })}
                      placeholder="知识点标题"
                    />
                    <input
                      value={item.difficulty}
                      onChange={(event) => updateItem(index, { difficulty: event.target.value })}
                      placeholder="难度"
                    />
                  </div>
                  <textarea
                    value={item.explanation}
                    onChange={(event) => updateItem(index, { explanation: event.target.value })}
                    placeholder="一句话解释这个知识点"
                  />
                  <input
                    value={item.tags.join("、")}
                    onChange={(event) => updateItem(index, { tags: normalizeTagInput(event.target.value) })}
                    placeholder="标签，用顿号或逗号分隔"
                  />
                  {item.source_reason ? <p>{item.source_reason}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : !items.length ? (
        <div className="learning-card-candidate-empty">{emptyText}</div>
      ) : null}

      {message ? <div className="learning-notice">{message}</div> : null}
      {error ? <div className="chat-panel-error">{error}</div> : null}
    </section>
  );
}

function normalizeTagInput(value: string[] | string) {
  const source = Array.isArray(value) ? value : value.split(/[、,\s]+/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const tag = String(raw || "").trim().replace(/^#/, "");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag.slice(0, 32));
    if (result.length >= 8) break;
  }
  return result;
}
