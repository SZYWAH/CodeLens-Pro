import type { PageKey } from "../components/Sidebar";

declare global {
  interface Window {
    CODELENS_API_BASE?: string;
    acquireVsCodeApi?: () => {
      postMessage: (message: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
  }
}

export type EditorPayload = {
  code: string;
  languageId?: string;
  languageLabel?: string;
  languageCode?: string;
  fileName?: string;
  filePath?: string;
};

export type VsCodeInboundMessage =
  | { type: "codelens.setApiBase"; apiBase: string }
  | { type: "codelens.openPage"; page: PageKey }
  | ({ type: "codelens.openWorkbench" } & EditorPayload)
  | { type: "codelens.theme"; theme: "dark" | "light" };

let vscodeApi: ReturnType<NonNullable<typeof window.acquireVsCodeApi>> | null | undefined;

export function getVsCodeApi() {
  if (vscodeApi !== undefined) return vscodeApi;
  vscodeApi = typeof window.acquireVsCodeApi === "function" ? window.acquireVsCodeApi() : null;
  return vscodeApi;
}

export function postToVsCode(message: unknown) {
  getVsCodeApi()?.postMessage(message);
}

export function isVsCodeWebview() {
  return Boolean(getVsCodeApi());
}

export function setApiBase(apiBase: string) {
  window.CODELENS_API_BASE = apiBase.replace(/\/+$/, "");
}

export function getApiBase() {
  const env = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  return (window.CODELENS_API_BASE ?? env.env?.VITE_CODELENS_API_BASE ?? "").replace(/\/+$/, "");
}

export function apiUrl(path: string) {
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function languageFromVsCodeId(languageId?: string): { languageLabel: string; languageCode: string } {
  const normalized = (languageId ?? "").toLowerCase();
  const map: Record<string, { languageLabel: string; languageCode: string }> = {
    python: { languageLabel: "Python", languageCode: "python" },
    java: { languageLabel: "Java", languageCode: "java" },
    javascript: { languageLabel: "JavaScript", languageCode: "javascript" },
    javascriptreact: { languageLabel: "JavaScript", languageCode: "javascript" },
    typescript: { languageLabel: "JavaScript", languageCode: "javascript" },
    typescriptreact: { languageLabel: "JavaScript", languageCode: "javascript" },
    cpp: { languageLabel: "C++", languageCode: "cpp" },
    c: { languageLabel: "C", languageCode: "c" },
  };
  return map[normalized] ?? { languageLabel: "Python", languageCode: "python" };
}
