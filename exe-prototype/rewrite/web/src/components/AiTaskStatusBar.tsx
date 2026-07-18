import { Loader2, Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiTaskKind, AiTaskPhase } from "../types";

export type ActiveAiTaskStatus = {
  task: AiTaskKind;
  phase: AiTaskPhase;
  startedAt: number;
};

export function AiTaskStatusBar({ status, onCancel }: {
  status: ActiveAiTaskStatus | null;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!status) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status?.startedAt]);

  if (!status) return null;
  const seconds = Math.max(0, Math.floor((now - status.startedAt) / 1_000));

  return <aside aria-live="polite" className="ai-task-status-v150" role="status">
    <Loader2 className="spin" size={15} />
    <div><strong>{taskLabel(status.task)}</strong><span>{phaseLabel(status.phase)} · 已用 {seconds} 秒</span></div>
    <button onClick={onCancel} type="button"><Square size={12} />取消</button>
  </aside>;
}

function taskLabel(task: AiTaskKind): string {
  return {
    single_review: "单文件审查",
    project_review: "项目审查",
    workspace_review: "工作区审查",
    diff_review: "代码对比审查",
    chat: "AI 对话",
    card_material: "学习材料"
  }[task];
}

function phaseLabel(phase: AiTaskPhase): string {
  return {
    accepted: "请求已接收",
    connecting: "正在连接模型",
    streaming: "正在接收结果",
    fallback: "模型不可用，正在使用本地规则",
    saving: "正在保存结果"
  }[phase];
}

