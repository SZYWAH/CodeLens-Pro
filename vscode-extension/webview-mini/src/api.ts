import { apiUrl } from "./runtime";
import type {
  AgentPlan,
  AgentApplyResultRequest,
  AgentPlanRequest,
  AnalyticsResponse,
  ChatSessionDetail,
  ChatSessionListItem,
  HealthResponse,
  ReportDetail,
  ReportListItem,
  SettingsResponse,
  StaticMetrics,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `请求失败：${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  settings: () => request<SettingsResponse>("/api/settings"),
  analytics: () => request<AnalyticsResponse>("/api/analytics"),
  staticAnalyze: (code: string, language_code: string) =>
    request<StaticMetrics>("/api/analyze/static", {
      method: "POST",
      body: JSON.stringify({ code, language_code }),
    }),
  listReports: () => request<ReportListItem[]>("/api/reports"),
  getReport: (id: string) => request<ReportDetail>(`/api/reports/${id}`),
  listChatSessions: () => request<ChatSessionListItem[]>("/api/chat/sessions"),
  getChatSession: (id: string) => request<ChatSessionDetail>(`/api/chat/sessions/${id}`),
  agentPlan: (body: AgentPlanRequest) =>
    request<AgentPlan>("/api/agent/plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pendingAgentTasks: () => request<AgentPlan[]>("/api/agent/pending"),
  updateAgentPlanResult: (id: string, body: AgentApplyResultRequest) =>
    request<AgentPlan>(`/api/agent/plans/${id}/apply-result`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
