import { Cpu, KeyRound, Loader2, Plus, Save, Server, ShieldCheck, Sparkles, Trash2, Wifi } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import type { ModelProfile, Settings } from "../types";

export function SettingsView(props: {
  settings: Settings;
  enableLlm: boolean;
  apiBase: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  modelProfiles: ModelProfile[];
  profileName: string;
  profileNote: string;
  profileDefault: boolean;
  busy: string | null;
  testResult: string | null;
  onEnableLlmChange: (value: boolean) => void;
  onApiBaseChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onClearApiKeyChange: (value: boolean) => void;
  onProfileNameChange: (value: string) => void;
  onProfileNoteChange: (value: string) => void;
  onProfileDefaultChange: (value: boolean) => void;
  onSaveProfile: () => void;
  onApplyProfile: (profile: ModelProfile) => void;
  onDeleteProfile: (id: string) => void;
  onSubmit: (event: FormEvent) => void;
  onTest: () => void;
}) {
  const modeText = props.enableLlm ? (props.settings.api_key_set || props.apiKey ? "AI 增强模式" : "等待 API Key") : "本地规则模式";
  const keyText = props.settings.api_key_set ? "已保存" : props.apiKey ? "待保存" : "未配置";

  return (
    <section className="settings-page-next">
      <form className="settings-form settings-main-next" onSubmit={props.onSubmit}>
        <div className="settings-hero-next">
          <div>
            <span>模型管理</span>
            <h3>设置与模型管理</h3>
            <p>无 API Key 时保持本地规则分析；配置兼容接口后，报告、对话、导览、学习材料和 Agent 计划可获得 AI 增强。</p>
          </div>
          <label className="switch-row">
            <span>
              <strong>启用 LLM</strong>
              <small>{props.settings.api_key_set ? "已在本地保存 API Key。" : "尚未保存 API Key。"}</small>
            </span>
            <input type="checkbox" checked={props.enableLlm} onChange={(event) => props.onEnableLlmChange(event.target.checked)} />
          </label>
        </div>

        <section className="settings-model-status-next">
          <StatusCard icon={<Sparkles size={16} />} label="当前模式" value={modeText} detail={props.enableLlm ? "AI 可增强核心功能" : "本地分析仍可完整运行"} />
          <StatusCard icon={<KeyRound size={16} />} label="Key 状态" value={keyText} detail="不在界面和日志中显示明文" />
          <StatusCard icon={<Server size={16} />} label="接口地址" value={shortValue(props.apiBase || "未填写")} detail="OpenAI-compatible /v1 接口" />
          <StatusCard icon={<Cpu size={16} />} label="模型" value={props.model || "未填写"} detail="用于报告、对话和 Agent 增强" />
        </section>

        <section className="settings-profile-panel-next">
          <div className="section-title-next">
            <span>模型档案</span>
            <h3>可复用配置</h3>
          </div>
          <div className="model-preset-grid-next">
          {props.modelProfiles.map((preset) => (
            <button
              className={props.apiBase === preset.api_base && props.model === preset.model ? "model-preset-next active" : "model-preset-next"}
              key={preset.id}
              type="button"
              onClick={() => props.onApplyProfile(preset)}
            >
              <strong>{preset.name}{preset.is_default ? " · 默认" : ""}</strong>
              <span>{preset.model}</span>
              <small>{preset.note}</small>
              <em>{shortValue(preset.api_base)}</em>
            </button>
          ))}
          {props.modelProfiles.length === 0 && <div className="empty small">暂无模型档案。</div>}
          </div>
        </section>

        <section className="settings-profile-editor-next">
          <div className="two-fields">
            <label>档案名称<input value={props.profileName} onChange={(event) => props.onProfileNameChange(event.target.value)} placeholder="例如：DeepSeek 官方账号" /></label>
            <label>备注<input value={props.profileNote} onChange={(event) => props.onProfileNoteChange(event.target.value)} placeholder="用途、费用、网络环境等" /></label>
          </div>
          <label className="check-row"><input type="checkbox" checked={props.profileDefault} onChange={(event) => props.onProfileDefaultChange(event.target.checked)} />设为默认模型档案</label>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={props.onSaveProfile} disabled={props.busy === "settings" || !props.apiBase.trim() || !props.model.trim()}>
              <Plus size={16} />
              保存当前为档案
            </button>
          </div>
        </section>

        <div className="two-fields">
          <label>API Base<input value={props.apiBase} onChange={(event) => props.onApiBaseChange(event.target.value)} /></label>
          <label>模型<input value={props.model} onChange={(event) => props.onModelChange(event.target.value)} /></label>
        </div>
        <label>API Key<input value={props.apiKey} onChange={(event) => props.onApiKeyChange(event.target.value)} type="password" placeholder={props.settings.api_key_set ? "已保存，输入新值可替换。" : "尚未配置"} /></label>
        <label className="check-row"><input type="checkbox" checked={props.clearApiKey} onChange={(event) => props.onClearApiKeyChange(event.target.checked)} />清除已保存的 API Key</label>

        <section className="settings-checklist-next">
          <CheckItem ok label="本地兜底" detail="LLM 失败或未配置时，报告和导览仍使用本地规则分析。" />
          <CheckItem ok label="密钥保护" detail="API Key 不出现在页面回显、导出档案和运行日志中。" />
          <CheckItem ok={props.enableLlm} label="AI 增强" detail="启用后可增强报告、对话、学习材料和 Agent 计划。" />
        </section>

        <div className="button-row">
          <button className="primary-button" disabled={props.busy === "settings"} type="submit">
            {props.busy === "settings" ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
            保存设置
          </button>
          <button className="secondary-button" disabled={props.busy === "llm-test"} type="button" onClick={props.onTest}>
            {props.busy === "llm-test" ? <Loader2 className="spin" size={18} /> : <Wifi size={18} />}
            测试连接
          </button>
        </div>
        {props.testResult && <div className="notice neutral">{props.testResult}</div>}
      </form>

      <aside className="settings-side-next">
        <InfoBlock label="当前模式" value={modeText} />
        <InfoBlock label="Key 存储策略" value="API Key 只保存在本机 SQLite 设置中，不展示在 UI 和日志中。" />
        <InfoBlock label="兜底策略" value="LLM 失败或未配置时，报告类功能继续使用本地规则分析。" />
        <InfoBlock label="兼容接口" value="支持 OpenAI-compatible chat/completions stream 接口。" />
        <section className="settings-profile-list-next">
          <div className="section-title-next">
            <span>档案管理</span>
            <h3>本地模型档案</h3>
          </div>
          {props.modelProfiles.map((profile) => (
            <article key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.model} · {shortValue(profile.api_base)}</span>
              </div>
              <button className="icon-button danger" type="button" onClick={() => props.onDeleteProfile(profile.id)} aria-label="删除模型档案">
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </section>
      </aside>
    </section>
  );
}

function StatusCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <article>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function CheckItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <article className={ok ? "ok" : "warn"}>
      <ShieldCheck size={16} />
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <article className="info-block">
      <div>
        <span>{label}</span>
        <code>{value}</code>
      </div>
    </article>
  );
}

function shortValue(value: string) {
  return value.length > 34 ? `${value.slice(0, 20)}...${value.slice(-10)}` : value;
}
