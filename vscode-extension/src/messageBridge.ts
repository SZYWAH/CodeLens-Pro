import type { EditorCodeContext } from "./editorContext";

export type WebviewPage =
  | "workbench"
  | "diff"
  | "chat"
  | "agent"
  | "learning"
  | "knowledgeCards"
  | "projectGuide"
  | "learningReview"
  | "history"
  | "settings"
  | "activityGalaxy";

export type AgentPlanOperation = {
  type: "create" | "update" | "delete" | "rename";
  path: string;
  new_path?: string | null;
  content?: string | null;
  reason?: string | null;
};

export type AgentPlanPayload = {
  id?: string | null;
  plan_id?: string | null;
  session_id?: string | null;
  summary: string;
  assumptions: string[];
  warnings: string[];
  operations: AgentPlanOperation[];
  selected_file_paths?: string[];
  context_mode?: "manual" | "ai_auto" | "hybrid";
  workspace_root?: string | null;
  status?: string;
  source?: string;
};

export type ExtensionToWebviewMessage =
  | { type: "codelens.setApiBase"; apiBase: string }
  | { type: "codelens.openPage"; page: WebviewPage }
  | ({ type: "codelens.openWorkbench" } & EditorCodeContext)
  | { type: "codelens.recentFilesMenu"; files: EditorCodeContext[] }
  | { type: "codelens.agentPlanApplied"; planId?: string | null; sessionId?: string | null; status: "applied" | "failed" | "rejected"; message: string }
  | { type: "codelens.theme"; theme: "dark" | "light" };

export type WebviewToExtensionMessage =
  | { type: "codelens.webviewReady" }
  | { type: "codelens.showError"; message: string }
  | { type: "codelens.requestEditorContext"; selectionOnly: boolean }
  | { type: "codelens.pickFiles" }
  | { type: "codelens.collectRecentFiles" }
  | { type: "codelens.pickWorkspaceFiles" }
  | { type: "codelens.collectWorkspaceFiles" }
  | { type: "codelens.autoCollectWorkspaceFiles" }
  | { type: "codelens.applyAgentPlan"; plan: AgentPlanPayload };
