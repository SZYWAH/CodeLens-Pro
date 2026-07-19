export type PreviewDataFixture = "standard" | "dense" | "empty";
export type PreviewUiState = "ready" | "loading" | "error";
export type PreviewAiScenario =
  | "unconfigured"
  | "success"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "disconnect";
export type PreviewMapState = "overview" | "dependencies-list" | "dependencies-2d" | "dependencies-3d";
export type PreviewMigrationState = "none" | "candidate" | "failed" | "restart-required";

export type PreviewScenario = {
  fixture: PreviewDataFixture;
  ui: PreviewUiState;
  ai: PreviewAiScenario;
  map: PreviewMapState;
  migration: PreviewMigrationState;
  invalid: Record<string, string>;
};

const defaults: Omit<PreviewScenario, "invalid"> = {
  fixture: "standard",
  ui: "ready",
  ai: "unconfigured",
  map: "overview",
  migration: "none"
};

export function isPreviewMode() {
  return (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === "preview";
}

export function readPreviewScenario(): PreviewScenario {
  if (!isPreviewMode() || typeof window === "undefined") return { ...defaults, invalid: {} };
  const params = new URL(window.location.href).searchParams;
  const invalid: Record<string, string> = {};
  return {
    fixture: readValue(params, "fixture", ["standard", "dense", "empty"], defaults.fixture, invalid),
    ui: readValue(params, "ui", ["ready", "loading", "error"], defaults.ui, invalid),
    ai: readValue(params, "ai", ["unconfigured", "success", "unauthorized", "rate_limited", "server_error", "timeout", "disconnect"], defaults.ai, invalid),
    map: readValue(params, "map", ["overview", "dependencies-list", "dependencies-2d", "dependencies-3d"], defaults.map, invalid),
    migration: readValue(params, "migration", ["none", "candidate", "failed", "restart-required"], defaults.migration, invalid),
    invalid
  };
}

function readValue<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
  invalid: Record<string, string>
): T {
  const value = params.get(key);
  if (!value) return fallback;
  if (allowed.includes(value as T)) return value as T;
  invalid[key] = value;
  return fallback;
}
