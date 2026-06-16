import type {
  AgentConfirmRequest,
  AgentPlan,
  AgentPlanRequest,
  AnalyticsResponse,
  ActivityItem,
  ActivityStarItem,
  BootstrapResponse,
  ChatSessionDetail,
  ChatSessionListItem,
  DailyWorkLogCalendarItem,
  DailyWorkLogItem,
  HealthResponse,
  LearningCardCreateRequest,
  LearningCardCandidate,
  LearningCardApplyTagSuggestionsResponse,
  LearningCardBulkCreateResponse,
  LearningCardGenerateResponse,
  LearningCardItem,
  LearningCardMaterialItem,
  LearningCardTagSuggestion,
  LearningCardTagSuggestionResponse,
  LearningCenterResponse,
  LearningReviewResponse,
  LLMKeyStatusResponse,
  LLMKeyTestResponse,
  ProjectGuideResponse,
  ReportOutlineItem,
  ReportDetail,
  ReportListItem,
  SettingsResponse,
  StaticMetrics,
  WorkspaceSnapshot
} from "../types";
import { apiUrl } from "./runtime";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
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
  llmKeyStatus: () => request<LLMKeyStatusResponse>("/api/llm/key"),
  saveLlmKey: (api_key: string) =>
    request<LLMKeyTestResponse>("/api/llm/key", {
      method: "POST",
      body: JSON.stringify({ api_key })
    }),
  clearLlmKey: () =>
    request<LLMKeyStatusResponse>("/api/llm/key", {
      method: "DELETE"
    }),
  testLlmKey: (api_key?: string | null) =>
    request<LLMKeyTestResponse>("/api/llm/key/test", {
      method: "POST",
      body: JSON.stringify({ api_key: api_key || null })
    }),
  analytics: () => request<AnalyticsResponse>("/api/analytics"),
  bootstrap: () => request<BootstrapResponse>("/api/ui/bootstrap"),
  recentActivity: (limit = 16) => request<ActivityItem[]>(`/api/activity/recent?limit=${limit}`),
  activityConstellation: (limit = 300) => request<ActivityStarItem[]>(`/api/activity/constellation?limit=${limit}`),
  currentWorkspace: () => request<WorkspaceSnapshot>("/api/agent/workspace/current"),
  dailyLogCalendar: (days = 30) => request<DailyWorkLogCalendarItem[]>(`/api/daily-logs/calendar?days=${days}`),
  dailyLogCalendarMonth: (month: string) => request<DailyWorkLogCalendarItem[]>(`/api/daily-logs/calendar?month=${encodeURIComponent(month)}`),
  dailyLog: (date: string) => request<DailyWorkLogItem>(`/api/daily-logs/${date}`),
  generateDailyLog: (date: string, model?: string | null) =>
    request<DailyWorkLogItem>(`/api/daily-logs/${date}/generate`, {
      method: "POST",
      body: JSON.stringify({ model })
    }),
  updateDailyLog: (date: string, body: { title?: string; content_markdown?: string }) =>
    request<DailyWorkLogItem>(`/api/daily-logs/${date}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  learningCenter: () => request<LearningCenterResponse>("/api/learning/center"),
  learningCards: (params: { query?: string; status?: string; difficulty?: string; language_label?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.query) search.set("query", params.query);
    if (params.status) search.set("status", params.status);
    if (params.difficulty) search.set("difficulty", params.difficulty);
    if (params.language_label) search.set("language_label", params.language_label);
    const suffix = search.toString() ? `?${search}` : "";
    return request<LearningCardItem[]>(`/api/learning/cards${suffix}`);
  },
  createLearningCard: (body: LearningCardCreateRequest) =>
    request<LearningCardItem>("/api/learning/cards", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  createLearningCardsBulk: (cards: LearningCardCandidate[]) =>
    request<LearningCardBulkCreateResponse>("/api/learning/cards/bulk", {
      method: "POST",
      body: JSON.stringify({ cards })
    }),
  updateLearningCard: (id: string, body: Partial<LearningCardCreateRequest>) =>
    request<LearningCardItem>(`/api/learning/cards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteLearningCard: (id: string) =>
    request<{ ok: boolean }>(`/api/learning/cards/${id}`, {
      method: "DELETE"
    }),
  learningCardMaterial: (id: string) => request<LearningCardMaterialItem>(`/api/learning/cards/${id}/material`),
  generateLearningCardMaterial: (id: string, model?: string | null) =>
    request<LearningCardMaterialItem>(`/api/learning/cards/${id}/material/generate`, {
      method: "POST",
      body: JSON.stringify({ model })
    }),
  generateLearningCards: (source_limit = 10) =>
    request<LearningCardGenerateResponse>("/api/learning/cards/generate", {
      method: "POST",
      body: JSON.stringify({ source_limit })
    }),
  suggestLearningCardTags: (limit = 120) =>
    request<LearningCardTagSuggestionResponse>("/api/learning/cards/tag-suggestions", {
      method: "POST",
      body: JSON.stringify({ limit })
    }),
  applyLearningCardTagSuggestions: (suggestions: LearningCardTagSuggestion[]) =>
    request<LearningCardApplyTagSuggestionsResponse>("/api/learning/cards/apply-tag-suggestions", {
      method: "POST",
      body: JSON.stringify({ suggestions })
    }),
  projectGuide: () => request<ProjectGuideResponse>("/api/learning/project-guide"),
  learningReview: (period: "week" | "month" | "all" = "week") => request<LearningReviewResponse>(`/api/learning/review?period=${period}`),
  reportOutline: (id: string) => request<{ report_id: string; outline: ReportOutlineItem[] }>(`/api/reports/${id}/outline`),
  staticAnalyze: (code: string, language_code: string) =>
    request<StaticMetrics>("/api/analyze/static", {
      method: "POST",
      body: JSON.stringify({ code, language_code })
    }),
  listReports: (params: { query?: string; language_code?: string; mode?: string; report_type?: string; date_from?: string; date_to?: string }) => {
    const search = new URLSearchParams();
    if (params.query) search.set("query", params.query);
    if (params.language_code) search.set("language_code", params.language_code);
    if (params.mode) search.set("mode", params.mode);
    if (params.report_type) search.set("report_type", params.report_type);
    if (params.date_from) search.set("date_from", params.date_from);
    if (params.date_to) search.set("date_to", params.date_to);
    const suffix = search.toString() ? `?${search}` : "";
    return request<ReportListItem[]>(`/api/reports${suffix}`);
  },
  getReport: (id: string) => request<ReportDetail>(`/api/reports/${id}`),
  reportLearningCards: (id: string) => request<LearningCardItem[]>(`/api/reports/${id}/learning-cards`),
  deleteReport: (id: string) =>
    request<{ ok: boolean }>(`/api/reports/${id}`, {
      method: "DELETE"
    }),
  listChatSessions: (params: { query?: string; context_type?: string; report_id?: string; date_from?: string; date_to?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.query) search.set("query", params.query);
    if (params.context_type) search.set("context_type", params.context_type);
    if (params.report_id) search.set("report_id", params.report_id);
    if (params.date_from) search.set("date_from", params.date_from);
    if (params.date_to) search.set("date_to", params.date_to);
    const suffix = search.toString() ? `?${search}` : "";
    return request<ChatSessionListItem[]>(`/api/chat/sessions${suffix}`);
  },
  getChatSession: (id: string) => request<ChatSessionDetail>(`/api/chat/sessions/${id}`),
  deleteChatSession: (id: string) =>
    request<{ ok: boolean }>(`/api/chat/sessions/${id}`, {
      method: "DELETE"
    }),
  agentPlan: (body: AgentPlanRequest) =>
    request<AgentPlan>("/api/agent/plan", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  confirmAgentPlan: (planId: string, body: AgentConfirmRequest) =>
    request<AgentPlan>(`/api/agent/plans/${planId}/confirm`, {
      method: "POST",
      body: JSON.stringify(body)
    })
};
