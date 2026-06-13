import { GitCompare } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { EditorPanel } from "../components/EditorPanel";
import { ReportViewer } from "../components/ReportViewer";
import { SelectField } from "../components/SelectField";
import { WorkspaceSplit } from "../components/WorkspaceSplit";
import { streamPost } from "../lib/stream";
import type { ReportDetail, SettingsResponse } from "../types";

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
  setCurrentReport,
  restoreReport
}: {
  settings: SettingsResponse | null;
  setCurrentReport: Dispatch<SetStateAction<string>>;
  restoreReport?: ReportDetail | null;
}) {
  const [codeA, setCodeA] = useState(leftSample);
  const [codeB, setCodeB] = useState(rightSample);
  const [languageLabel, setLanguageLabel] = useState(settings?.default_language_label ?? "Python");
  const [mode, setMode] = useState("diff_overview");
  const [model, setModel] = useState(settings?.default_model_label ?? "dsV4flash");
  const [report, setReport] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [contextChatSessionId, setContextChatSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const languages = settings?.languages ?? { Python: "python" };
  const languageCode = languages[languageLabel] ?? "python";
  const modes = settings?.report_modes?.diff ?? [];
  const models = settings?.models ?? { dsV4flash: "deepseek-v4-flash" };
  const codeContext = `版本 A：\n${codeA}\n\n版本 B：\n${codeB}`;

  useEffect(() => {
    if (!restoreReport || restoreReport.report_type !== "diff") return;

    setCodeA(restoreReport.code_a ?? "");
    setCodeB(restoreReport.code_b ?? "");
    setLanguageLabel(restoreReport.language_label);
    setMode(restoreReport.mode);
    setModel(Object.entries(models).find(([, value]) => value === restoreReport.model)?.[0] ?? restoreReport.model);
    setReport(restoreReport.content);
    setCurrentReport(restoreReport.content);
    setReportId(restoreReport.id);
    setContextChatSessionId(restoreReport.chat_session_id ?? null);
    setError("");
  }, [restoreReport?.id]);

  async function generate() {
    setLoading(true);
    setError("");
    setReport("");
    setCurrentReport("");
    setReportId(null);
    setContextChatSessionId(null);

    try {
      await streamPost(
        "/api/diff/stream",
        {
          code_a: codeA,
          code_b: codeB,
          mode,
          language_code: languageCode,
          language_label: languageLabel,
          model
        },
        {
          onDelta: (text) => {
            setReport((previous) => previous + text);
            setCurrentReport((previous) => previous + text);
          },
          onDone: (data) => {
            setReportId(String(data.id ?? "") || null);
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
      </section>
  );

  const reportPanel = (
      <ReportViewer
        title="对比报告"
        content={report}
        loading={loading}
        error={error}
        contextChat={{
          settings,
          reportId,
          codeContext,
          reportContext: report,
          sessionId: contextChatSessionId,
          onSessionIdChange: setContextChatSessionId
        }}
        onClear={() => {
          setReport("");
          setReportId(null);
          setContextChatSessionId(null);
        }}
      />
  );

  return (
    <WorkspaceSplit
      defaultPercent={64}
      minPercent={24}
      maxPercent={64}
      leftMin="340px"
      rightMin="430px"
      storageKey="codelens.diff.splitPercent"
      left={inputPanel}
      right={reportPanel}
    />
  );
}
