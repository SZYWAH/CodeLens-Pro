import { Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { EditorPanel } from "../components/EditorPanel";
import { MetricsPanel } from "../components/MetricsPanel";
import { ReportViewer } from "../components/ReportViewer";
import { SelectField } from "../components/SelectField";
import { WorkspaceSplit } from "../components/WorkspaceSplit";
import { api } from "../lib/api";
import { streamPost } from "../lib/stream";
import type { LearningCardCandidate, LearningCardItem, SettingsResponse, StaticMetrics } from "../types";

const sampleCode = `def memoize(func):
    cache = {}
    def wrapper(*args):
        if args not in cache:
            cache[args] = func(*args)
        return cache[args]
    return wrapper

@memoize
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)`;

export function WorkbenchPage({
  settings,
  code,
  setCode,
  report,
  setReport,
  reportId,
  setReportId,
  externalLanguageLabel,
  contextChatSessionId,
  setContextChatSessionId,
  onActivityChanged,
  onOpenLearningCard
}: {
  settings: SettingsResponse | null;
  code: string;
  setCode: (value: string) => void;
  report: string;
  setReport: Dispatch<SetStateAction<string>>;
  reportId: string | null;
  setReportId: Dispatch<SetStateAction<string | null>>;
  externalLanguageLabel?: string | null;
  contextChatSessionId: string | null;
  setContextChatSessionId: Dispatch<SetStateAction<string | null>>;
  onActivityChanged?: () => void;
  onOpenLearningCard?: (card: LearningCardItem) => void;
}) {
  const [languageLabel, setLanguageLabel] = useState(settings?.default_language_label ?? "Python");
  const [modeGroup, setModeGroup] = useState<"function" | "script">("function");
  const [mode, setMode] = useState("func_comment");
  const [model, setModel] = useState(settings?.default_model_label ?? "DeepSeek-V4-Flash");
  const [metrics, setMetrics] = useState<StaticMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generateLearningCards, setGenerateLearningCards] = useState(false);
  const [learningCardCandidates, setLearningCardCandidates] = useState<LearningCardCandidate[]>([]);
  const [savedLearningCards, setSavedLearningCards] = useState<LearningCardItem[]>([]);
  const [learningCardNotice, setLearningCardNotice] = useState("");

  const languages = settings?.languages ?? { Python: "python" };
  const modes = settings?.report_modes?.[modeGroup] ?? [];
  const models = settings?.models ?? { "DeepSeek-V4-Flash": "deepseek-v4-flash" };
  const languageCode = languages[languageLabel] ?? "python";

  useEffect(() => {
    if (externalLanguageLabel && languages[externalLanguageLabel]) {
      setLanguageLabel(externalLanguageLabel);
    }
  }, [externalLanguageLabel, languages]);

  async function analyze() {
    setMetrics(await api.staticAnalyze(code, languageCode));
  }

  async function loadSavedLearningCards(nextReportId = reportId) {
    if (!nextReportId) {
      setSavedLearningCards([]);
      return;
    }
    setSavedLearningCards(await api.reportLearningCards(nextReportId));
  }

  useEffect(() => {
    void loadSavedLearningCards(reportId);
  }, [reportId]);

  async function generate() {
    setLoading(true);
    setError("");
    setReport("");
    setReportId(null);
    setContextChatSessionId(null);
    setLearningCardCandidates([]);
    setSavedLearningCards([]);
    setLearningCardNotice("");

    try {
      await analyze();
      await streamPost(
        "/api/reports/stream",
        {
          code,
          mode,
          language_code: languageCode,
          language_label: languageLabel,
          model,
          generate_learning_card_candidates: generateLearningCards
        },
        {
          onDelta: (text) => {
            setReport((previous) => previous + text);
          },
          onDone: (data) => {
            const nextReportId = String(data.id ?? "") || null;
            setReportId(nextReportId);
            if (nextReportId) void loadSavedLearningCards(nextReportId);
            const candidates = Array.isArray(data.learning_card_candidates) ? data.learning_card_candidates as LearningCardCandidate[] : [];
            setLearningCardCandidates(candidates);
            if (data.learning_card_candidate_error) {
              setLearningCardNotice("报告已生成，但知识卡片候选生成失败。可以稍后到知识卡片页从历史报告智能提炼。");
            } else if (generateLearningCards) {
              setLearningCardNotice(candidates.length ? `发现 ${candidates.length} 个知识卡片候选。` : "报告已生成，但这次没有发现明确的知识卡片候选。");
            }
            onActivityChanged?.();
            setLoading(false);
          },
          onError: (message) => {
            setError(message);
            setLoading(false);
          }
        }
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "生成失败");
      setLoading(false);
    }
  }

  const inputPanel = (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="control-row grid grid-cols-2 gap-2">
            <SelectField
              ariaLabel="选择语言"
              value={languageLabel}
              onChange={setLanguageLabel}
              options={Object.keys(languages).map((item) => ({ label: item, value: item }))}
            />
            <SelectField
              ariaLabel="选择分析类型"
              value={modeGroup}
              onChange={(value) => {
                const next = value as "function" | "script";
                setModeGroup(next);
                setMode((settings?.report_modes?.[next] ?? [])[0]?.id ?? "");
              }}
              options={[
                { label: "函数分析", value: "function" },
                { label: "脚本分析", value: "script" }
              ]}
            />
            <SelectField
              ariaLabel="选择分析模式"
              value={mode}
              onChange={setMode}
              options={modes.map((item) => ({ label: item.label, value: item.id }))}
            />
            <SelectField
              ariaLabel="选择模型"
              value={model}
              onChange={setModel}
              options={Object.keys(models).map((item) => ({ label: item, value: item }))}
            />
      </div>
      <div className="min-h-[440px] flex-1 xl:min-h-0">
        <EditorPanel value={code} language={languageCode} onChange={setCode} />
      </div>
      <MetricsPanel metrics={metrics} />
      <label className="workbench-learning-toggle">
        <input
          checked={generateLearningCards}
          onChange={(event) => setGenerateLearningCards(event.target.checked)}
          type="checkbox"
        />
        <span><Sparkles size={14} /> 同步生成知识卡片候选</span>
      </label>
      <div className="flex gap-2">
        <button className="btn btn-secondary" onClick={() => setCode(sampleCode)} type="button">
          <RotateCcw size={16} />
          载入样例
        </button>
        <button className="btn btn-secondary" onClick={analyze} type="button">
          静态分析
        </button>
        <button className="btn btn-primary" disabled={loading || !code.trim()} onClick={generate} type="button">
          <Play size={16} />
          生成报告
        </button>
      </div>
    </section>
  );

  const reportPanel = (
    <ReportViewer
      title="当前报告"
      content={report}
      loading={loading}
      error={error}
      learningCards={{
        candidates: learningCardCandidates,
        savedCards: savedLearningCards,
        notice: learningCardNotice,
        onOpenCard: onOpenLearningCard,
        onDismiss: () => setLearningCardCandidates([]),
        onSaved: (created, skipped, cards) => {
          setLearningCardNotice(`已保存 ${created} 张知识卡片，跳过 ${skipped} 张重复卡片。`);
          if (cards.length) {
            setSavedLearningCards((current) => {
              const seen = new Set(current.map((card) => card.id));
              return [...cards.filter((card) => !seen.has(card.id)), ...current];
            });
          }
          void loadSavedLearningCards();
          onActivityChanged?.();
        }
      }}
      contextChat={{
        settings,
        reportId,
        codeContext: code,
        reportContext: report,
        sessionId: contextChatSessionId,
        onSessionIdChange: setContextChatSessionId,
        onSessionSaved: () => onActivityChanged?.()
      }}
      onClear={() => {
        setReport("");
        setReportId(null);
        setContextChatSessionId(null);
        setLearningCardCandidates([]);
        setSavedLearningCards([]);
        setLearningCardNotice("");
      }}
    />
  );

  return (
    <WorkspaceSplit
      defaultPercent={56}
      minPercent={18}
      maxPercent={56}
      leftMin="400px"
      rightMin="460px"
      storageKey="codelens.workbench.splitPercent"
      left={inputPanel}
      right={reportPanel}
    />
  );
}
