import { CheckCircle2, Database, FolderInput, KeyRound, Loader2, Menu, Moon, Palette, Plus, RotateCcw, Save, Settings as SettingsIcon, ShieldCheck, Sun, Trash2, Wifi, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { LegacyMigrationResult, ModelProfile, Settings } from "../types";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import { ProductToolbar } from "./ProductShell";

type Section = "appearance" | "mode" | "connection" | "profiles" | "security" | "data";

export function SettingsView(props: {
    theme: "dark" | "light";
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
    focusConnectionRequest: number;
    migration: LegacyMigrationResult | null;
    migrationBusy: boolean;
    onEnableLlmChange: (v: boolean) => void;
    onApiBaseChange: (v: string) => void;
    onModelChange: (v: string) => void;
    onApiKeyChange: (v: string) => void;
    onClearApiKeyChange: (v: boolean) => void;
    onProfileNameChange: (v: string) => void;
    onProfileNoteChange: (v: string) => void;
    onProfileDefaultChange: (v: boolean) => void;
    onSaveProfile: () => void;
    onApplyProfile: (p: ModelProfile) => void;
    onDeleteProfile: (id: string) => void;
    onSubmit: (e: FormEvent) => void;
    onTest: () => void;
    onOpenHealth: () => void;
    onThemeChange: (theme: "dark" | "light") => void;
    onMigrateLegacyData: () => void;
    onRestartApplication: () => void;
}) {
    const [section, setSection] = useState<Section>("appearance");
    const [mobile, setMobile] = useState(false);
    const [profileDrawer, setProfileDrawer] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const profileDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
    const profileDrawerRef = useRef<HTMLElement | null>(null);
    const profileDrawerCloseRef = useRef<HTMLButtonElement | null>(null);
    const profileDeleteTriggerRef = useRef<HTMLButtonElement | null>(null);
    const profileDeleteDialogRef = useRef<HTMLDivElement | null>(null);
    const profileDeleteCancelRef = useRef<HTMLButtonElement | null>(null);
    const keyState = props.settings.api_key_set ? "已存入本机 SQLite" : props.apiKey ? "等待保存" : "未配置";
    const mode = props.enableLlm ? (props.settings.api_key_set || props.apiKey ? "AI 增强模式" : "等待 API Key") : "本地规则模式";

    useOverlayFocus({
        active: profileDrawer,
        containerRef: profileDrawerRef,
        initialFocusRef: profileDrawerCloseRef,
        returnFocusRef: profileDrawerTriggerRef,
        onRequestClose: () => setProfileDrawer(false)
    });

    useEffect(() => {
        if (props.focusConnectionRequest <= 0) return;
        setSection("connection");
        setMobile(false);
    }, [props.focusConnectionRequest]);
    useOverlayFocus({
        active: Boolean(deleteId),
        containerRef: profileDeleteDialogRef,
        initialFocusRef: profileDeleteCancelRef,
        returnFocusRef: profileDeleteTriggerRef,
        onRequestClose: () => setDeleteId(null)
    });

    function choose(v: Section) {
        setSection(v);
        setMobile(false);
    }

    return <section className="system-workspace-v139">
        <ProductToolbar>
            <div className="product-toolbar-context-next">{mode} · Key {keyState}</div>
            <nav className="product-toolbar-actions-next">
                <button onClick={props.onOpenHealth} type="button"><Database size={14} />运行状态</button>
                <button className="primary-button" disabled={props.busy === "settings" || props.busy === "llm-test"} form="settings-form-v139" type="submit">
                    {props.busy === "settings" ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存并验证
                </button>
            </nav>
        </ProductToolbar>
        <button className="system-mobile-index-v139" onClick={() => setMobile(true)} type="button"><Menu size={15} />设置章节</button>
        <div className="system-layout-v139">
            {mobile && <button className="system-index-scrim-v139" aria-label="关闭设置章节" onClick={() => setMobile(false)} type="button" />}
            <aside className={`system-index-v139 ${mobile ? "is-open" : ""}`}>
                <header>
                    <strong>设置章节</strong>
                    <button aria-label="关闭设置章节" onClick={() => setMobile(false)} type="button"><X size={16} /></button>
                </header>
                <nav>
                    {([['appearance', '外观'], ['mode', '模型模式'], ['connection', '连接配置'], ['profiles', '模型档案'], ['data', '数据迁移'], ['security', '安全说明']] as [Section, string][]).map(([v, l]) => <button className={section === v ? "active" : ""} key={v} onClick={() => choose(v)} type="button">
                        <span>{v === "appearance" ? <Palette size={14} /> : v === "connection" ? <Wifi size={14} /> : v === "profiles" ? <SettingsIcon size={14} /> : v === "data" ? <Database size={14} /> : v === "security" ? <ShieldCheck size={14} /> : <KeyRound size={14} />}</span>
                        <strong>{l}</strong>
                    </button>)}
                </nav>
            </aside>
            <main className="system-content-v139">
                <form id="settings-form-v139" onSubmit={props.onSubmit}>
                    {section === "appearance" && <section className="settings-section-v139">
                        <Header title="外观" detail="业务页面支持原项目的暗色与亮色面板体系。" />
                        <div className="settings-theme-choice-v144" role="radiogroup" aria-label="业务页面主题">
                            <button aria-checked={props.theme === "dark"} className={props.theme === "dark" ? "active" : ""} onClick={() => props.onThemeChange("dark")} role="radio" type="button"><Moon size={18} /><span><strong>暗色主题</strong><small>深蓝黑面板，适合从活动展示台进入。</small></span></button>
                            <button aria-checked={props.theme === "light"} className={props.theme === "light" ? "active" : ""} onClick={() => props.onThemeChange("light")} role="radio" type="button"><Sun size={18} /><span><strong>亮色主题</strong><small>蓝白面板与暖纸卡片，贴近原项目界面。</small></span></button>
                        </div>
                        <p className="system-note-v139">主题选择只保存在本机界面偏好中，不会写入项目数据或产品档案。</p>
                    </section>}
                    {section === "mode" && <section className="settings-section-v139">
                        <Header title="模型模式" detail="本地规则始终可用，LLM 仅作为可选增强。" />
                        <label className="settings-switch-v139"><span><strong>启用 LLM</strong><small>{props.settings.api_key_set ? "API Key 已保存在本机" : "尚未保存 API Key"}</small></span><input checked={props.enableLlm} onChange={e => props.onEnableLlmChange(e.target.checked)} type="checkbox" /></label>
                        <dl className="settings-status-v139"><Meta label="当前模式" value={mode} /><Meta label="Key 状态" value={keyState} /><Meta label="模型" value={props.model || "未填写"} /><Meta label="接口" value={props.apiBase || "未填写"} /></dl>
                        <p className="system-note-v139">关闭或无法连接 LLM 时，项目报告、问题、卡片和日志仍使用本地规则运行。</p>
                    </section>}
                    {section === "connection" && <section className="settings-section-v139">
                        <Header title="连接配置" detail="兼容 OpenAI chat/completions stream 接口。" />
                        <div className="settings-fields-v139">
                            <label>API Base<input value={props.apiBase} onChange={e => props.onApiBaseChange(e.target.value)} /></label>
                            <label>模型<input value={props.model} onChange={e => props.onModelChange(e.target.value)} /></label>
                            <label className="full">API Key<input type="password" value={props.apiKey} onChange={e => props.onApiKeyChange(e.target.value)} placeholder={props.settings.api_key_set ? "已保存，输入新值可替换" : "尚未配置"} /></label>
                            <label className="settings-check-v139"><input checked={props.clearApiKey} onChange={e => props.onClearApiKeyChange(e.target.checked)} type="checkbox" />清除已保存的 API Key</label>
                        </div>
                        <div className="settings-test-v139"><button disabled={props.busy === "llm-test" || props.busy === "settings"} onClick={props.onTest} type="button">{props.busy === "llm-test" ? <Loader2 className="spin" size={14} /> : <Wifi size={14} />}测试当前填写</button>{props.testResult && <span>{props.testResult}</span>}</div>
                    </section>}
                    {section === "profiles" && <section className="settings-section-v139">
                        <Header title="模型档案" detail="保存并快速切换接口与模型；档案不包含 API Key。" />
                        <button className="settings-add-profile-v139" onClick={() => setProfileDrawer(true)} ref={profileDrawerTriggerRef} type="button"><Plus size={14} />保存当前配置为档案</button>
                        <div className="settings-profile-list-v139">
                            {props.modelProfiles.map(p => <article key={p.id}>
                                <button className={props.apiBase === p.api_base && props.model === p.model ? "active" : ""} onClick={() => props.onApplyProfile(p)} type="button"><strong>{p.name}{p.is_default ? " · 默认" : ""}</strong><span>{p.model}</span><small>{p.api_base}</small><p>{p.note}</p></button>
                                <button aria-label={`删除档案 ${p.name}`} onClick={event => { profileDeleteTriggerRef.current = event.currentTarget; setDeleteId(p.id); }} type="button"><Trash2 size={14} /></button>
                                {deleteId === p.id && <div aria-labelledby="settings-profile-delete-title-v145" aria-modal="true" ref={profileDeleteDialogRef} role="alertdialog">
                                    <span id="settings-profile-delete-title-v145">确认删除此档案？</span>
                                    <button onClick={() => { props.onDeleteProfile(p.id); setDeleteId(null); }} type="button">确认删除</button>
                                    <button onClick={() => setDeleteId(null)} ref={profileDeleteCancelRef} type="button">取消</button>
                                </div>}
                            </article>)}
                            {!props.modelProfiles.length && <p className="muted">暂无模型档案。</p>}
                        </div>
                    </section>}
                    {section === "security" && <section className="settings-section-v139">
                        <Header title="安全说明" detail="配置和项目数据只保存在本机。" />
                        <div className="settings-security-v139"><Info title="本机存储" text="API Key 保存在本机 SQLite 中；界面不回显，也不会写入运行日志或产品档案。" /><Info title="本地兜底" text="LLM 未配置或调用失败时，核心审查流程继续使用本地规则。" /><Info title="档案导出" text="模型档案和导出文件不包含 API Key，只记录密钥是否已配置。" /></div>
                    </section>}
                    {section === "data" && <section className="settings-section-v139 settings-migration-v110">
                        <Header title="旧版数据迁移" detail="安装版数据保存在当前用户的 LocalAppData，不随卸载删除。" />
                        <dl className="settings-status-v139">
                            <Meta label="迁移状态" value={migrationStatusLabel(props.migration)} />
                            <Meta label="目标目录" value={props.migration?.destination || "正在检查"} />
                            <Meta label="旧版来源" value={props.migration?.source || "尚未选择"} />
                            <Meta label="迁移日志" value={props.migration?.logsMigrated ? `${props.migration.logsMigrated} 个` : "无"} />
                        </dl>
                        <p className="system-note-v139">{props.migration?.message || "正在检查旧免安装版数据。"}</p>
                        <div className="settings-migration-v110__actions">
                            <button disabled={props.migrationBusy || props.migration?.status === "not_needed"} onClick={props.onMigrateLegacyData} type="button">
                                {props.migrationBusy ? <Loader2 className="spin" size={14} /> : <FolderInput size={14} />}选择旧版目录并迁移
                            </button>
                            {props.migration?.restartRequired && <button className="primary-button" onClick={props.onRestartApplication} type="button"><RotateCcw size={14} />重启并载入</button>}
                        </div>
                        <p className="system-note-v139">迁移只复制并校验数据，不会删除旧目录；当前库已有用户数据时请改用产品档案导入。</p>
                    </section>}
                </form>
            </main>
        </div>
        {profileDrawer && <>
            <button className="system-drawer-scrim-v139" aria-label="关闭模型档案编辑" onClick={() => setProfileDrawer(false)} type="button" />
            <aside aria-labelledby="settings-profile-drawer-title-v145" aria-modal="true" className="system-drawer-v139" ref={profileDrawerRef} role="dialog">
                <header><strong id="settings-profile-drawer-title-v145">保存模型档案</strong><button aria-label="关闭模型档案编辑" onClick={() => setProfileDrawer(false)} ref={profileDrawerCloseRef} type="button"><X size={17} /></button></header>
                <div className="system-drawer-body-v145">
                    <p className="system-note-v139">档案只保存 API Base、模型和备注，不保存 API Key。</p>
                    <label>档案名称<input value={props.profileName} onChange={e => props.onProfileNameChange(e.target.value)} placeholder="例如：DeepSeek 官方" /></label>
                    <label>备注<textarea value={props.profileNote} onChange={e => props.onProfileNoteChange(e.target.value)} placeholder="用途、网络环境或费用说明" /></label>
                    <label className="settings-check-v139"><input checked={props.profileDefault} onChange={e => props.onProfileDefaultChange(e.target.checked)} type="checkbox" />设为默认档案</label>
                    <button className="primary-button" disabled={props.busy === "settings" || !props.apiBase.trim() || !props.model.trim()} onClick={props.onSaveProfile} type="button"><Save size={14} />保存档案</button>
                </div>
            </aside>
        </>}
    </section>;
}

function Header({ title, detail }: {
    title: string;
    detail: string;
}) {
    return <header><strong>{title}</strong><span>{detail}</span></header>;
}

function Meta({ label, value }: {
    label: string;
    value: string;
}) {
    return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Info({ title, text }: {
    title: string;
    text: string;
}) {
    return <article><CheckCircle2 size={15} /><div><strong>{title}</strong><p>{text}</p></div></article>;
}

function migrationStatusLabel(migration: LegacyMigrationResult | null) {
    if (!migration) return "正在检查";
    if (migration.status === "completed") return migration.restartRequired ? "已迁移，等待重启" : "迁移完成";
    if (migration.status === "candidate_found") return "发现旧版数据";
    if (migration.status === "needs_location") return "等待选择旧版目录";
    if (migration.status === "failed") return "迁移失败";
    return "无需迁移";
}
