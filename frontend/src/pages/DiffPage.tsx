import { GitCompare, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { EditorPanel } from "../components/EditorPanel";
import { ReportViewer } from "../components/ReportViewer";
import { SelectField } from "../components/SelectField";
import { WorkspaceSplit } from "../components/WorkspaceSplit";
import { api } from "../lib/api";
import { streamPost } from "../lib/stream";
import type { LearningCardCandidate, LearningCardItem, ReportDetail, SettingsResponse } from "../types";

const leftSample = `def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)`;

const rightSample = `def fib_memo(n, memo=None):
    if memo is None:
        memo = {}
    if n in memo:
        return memo[n]
    if n <= 1:
        return n
    memo[n] = fib_memo(n - 1, memo) + fib_memo(n - 2, memo)
    return memo[n]`;

export function DiffPage({
  settings,
  restoreReport,
  onActivityChanged,
  onOpenLearningCard
}: {
  settings: SettingsResponse | null;
  restoreReport?: ReportDetail | null;
  onActivityChanged?: () => void;
  onOpenLearningCard?: (card: LearningCardItem) => void;
}) {
  const [codeA, setCodeA] = useState(leftSample);
  const [codeB, setCodeB] = useState(rightSample);
  const [languageLabel, setLanguageLabel] = useState(settings?.default_language_label ?? "Python");
  const [mode, setMode] = useState("diff_overview");
  const [model, setModel] = useState(settings?.default_model_label ?? "DeepSeek-V4-Flash");
  const [report, setReport] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [contextChatSessionId, setContextChatSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generateLearningCards, setGenerateLearningCards] = useState(false);
  const [learningCardCandidates, setLearningCardCandidates] = useState<LearningCardCandidate[]>([]);
  const [savedLearningCards, setSavedLearningCards] = useState<LearningCardItem[]>([]);
  const [learningCardNotice, setLearningCardNotice] = useState("");

  const languages = settings?.languages ?? { Python: "python" };
  const languageCode = languages[languageLabel] ?? "python";
  const modes = settings?.report_modes?.diff ?? [];
  const models = settings?.models ?? { "DeepSeek-V4-Flash": "deepseek-v4-flash" };
  const codeContext = `版本 A：\n${codeA}\n\n版本 B：\n${codeB}`;

  useEffect(() => {
    if (!restoreReport || restoreReport.report_type !== "diff") return;

    setCodeA(restoreReport.code_a ?? "");
    setCodeB(restoreReport.code_b ?? "");
    setLanguageLabel(restoreReport.language_label);
    setMode(restoreReport.mode);
    setModel(Object.entries(models).find(([, value]) => value === restoreReport.model)?.[0] ?? restoreReport.model);
    setReport(restoreReport.content);
    setReportId(restoreReport.id);
    setContextChatSessionId(restoreReport.chat_session_id ?? null);
    setError("");
  }, [restoreReport?.id]);

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
      await streamPost(
        "/api/diff/stream",
        {
          code_a: codeA,
          code_b: codeB,
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
              setLearningCardNotice("对比报告已生成，但知识卡片候选生成失败。可以稍后到知识卡片页从历史报告智能提炼。");
            } else if (generateLearningCards) {
              setLearningCardNotice(candidates.length ? `发现 ${candidates.length} 个知识卡片候选。` : "对比报告已生成，但这次没有发现明确的知识卡片候选。");
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
      setError(exc instanceof Error ? exc.message : "对比失败");
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
            ariaLabel="选择对比模式"
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
          <button className="btn btn-primary" disabled={loading || !codeA.trim() || !codeB.trim()} onClick={generate} type="button">
            <GitCompare size={16} />
            生成对比
          </button>
      </div>
      <div className="grid min-h-[440px] flex-1 grid-cols-1 gap-3 2xl:grid-cols-2 xl:min-h-0">
        <EditorPanel value={codeA} language={languageCode} onChange={setCodeA} />
        <EditorPanel value={codeB} language={languageCode} onChange={setCodeB} />
      </div>
      <label className="workbench-learning-toggle">
        <input
          checked={generateLearningCards}
          onChange={(event) => setGenerateLearningCards(event.target.checked)}
          type="checkbox"
        />
        <span><Sparkles size={14} /> 同步生成知识卡片候选</span>
      </label>
    </section>
  );

  const reportPanel = (
    <ReportViewer
      title="对比报告"
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
        codeContext,
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
      defaultPercent={64}
      minPercent={24}
      maxPercent={64}
      leftMin="480px"
      rightMin="430px"
      storageKey="codelens.diff.splitPercent"
      left={inputPanel}
      right={reportPanel}
    />
  );
}
