import { Play, RotateCcw } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { EditorPanel } from "../components/EditorPanel";
import { MetricsPanel } from "../components/MetricsPanel";
import { ReportViewer } from "../components/ReportViewer";
import { SelectField } from "../components/SelectField";
import { WorkspaceSplit } from "../components/WorkspaceSplit";
import { api } from "../lib/api";
import { streamPost } from "../lib/stream";
import type { SettingsResponse, StaticMetrics } from "../types";

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
  setCurrentReport,
  reportId,
  setReportId,
  contextChatSessionId,
  setContextChatSessionId
}: {
  settings: SettingsResponse | null;
  code: string;
  setCode: (value: string) => void;
  report: string;
  setReport: Dispatch<SetStateAction<string>>;
  setCurrentReport: Dispatch<SetStateAction<string>>;
  reportId: string | null;
  setReportId: Dispatch<SetStateAction<string | null>>;
  contextChatSessionId: string | null;
  setContextChatSessionId: Dispatch<SetStateAction<string | null>>;
}) {
  const [languageLabel, setLanguageLabel] = useState(settings?.default_language_label ?? "Python");
  const [modeGroup, setModeGroup] = useState<"function" | "script">("function");
  const [mode, setMode] = useState("func_comment");
  const [model, setModel] = useState(settings?.default_model_label ?? "dsV4flash");
  const [metrics, setMetrics] = useState<StaticMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const languages = settings?.languages ?? { Python: "python" };
  const modes = settings?.report_modes?.[modeGroup] ?? [];
  const models = settings?.models ?? { dsV4flash: "deepseek-v4-flash" };
  const languageCode = languages[languageLabel] ?? "python";

  async function analyze() {
    setMetrics(await api.staticAnalyze(code, languageCode));
  }

  async function generate() {
    setLoading(true);
    setError("");
    setReport("");
    setCurrentReport("");
    setReportId(null);
    setContextChatSessionId(null);

    try {
      await analyze();
      await streamPost(
        "/api/reports/stream",
        {
          code,
          mode,
          language_code: languageCode,
          language_label: languageLabel,
          model
        },
        {
          onDelta: (text) => {
            setReport((previous) => previous + text);
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
        contextChat={{
          settings,
          reportId,
          codeContext: code,
          reportContext: report,
          sessionId: contextChatSessionId,
          onSessionIdChange: setContextChatSessionId
        }}
        onClear={() => {
          setReport("");
          setCurrentReport("");
          setReportId(null);
          setContextChatSessionId(null);
        }}
      />
  );

  return (
    <WorkspaceSplit
      defaultPercent={56}
      minPercent={18}
      maxPercent={56}
      leftMin="280px"
      rightMin="460px"
      storageKey="codelens.workbench.splitPercent"
      left={inputPanel}
      right={reportPanel}
    />
  );
}
