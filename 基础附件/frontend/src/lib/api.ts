import type {
  AnalyticsResponse,
  ChatSessionDetail,
  ChatSessionListItem,
  HealthResponse,
  ReportDetail,
  ReportListItem,
  SettingsResponse,
  StaticMetrics
} from "../types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
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
  analytics: () => request<AnalyticsResponse>("/api/analytics"),
  staticAnalyze: (code: string, language_code: string) =>
    request<StaticMetrics>("/api/analyze/static", {
      method: "POST",
      body: JSON.stringify({ code, language_code })
    }),
  listReports: (params: { query?: string; language_code?: string; mode?: string }) => {
    const search = new URLSearchParams();
    if (params.query) search.set("query", params.query);
    if (params.language_code) search.set("language_code", params.language_code);
    if (params.mode) search.set("mode", params.mode);
    const suffix = search.toString() ? `?${search}` : "";
    return request<ReportListItem[]>(`/api/reports${suffix}`);
  },
  getReport: (id: string) => request<ReportDetail>(`/api/reports/${id}`),
  deleteReport: (id: string) =>
    request<{ ok: boolean }>(`/api/reports/${id}`, {
      method: "DELETE"
    }),
  listChatSessions: (params: { query?: string; context_type?: string; report_id?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.query) search.set("query", params.query);
    if (params.context_type) search.set("context_type", params.context_type);
    if (params.report_id) search.set("report_id", params.report_id);
    const suffix = search.toString() ? `?${search}` : "";
    return request<ChatSessionListItem[]>(`/api/chat/sessions${suffix}`);
  },
  getChatSession: (id: string) => request<ChatSessionDetail>(`/api/chat/sessions/${id}`),
  deleteChatSession: (id: string) =>
    request<{ ok: boolean }>(`/api/chat/sessions/${id}`, {
      method: "DELETE"
    })
};
