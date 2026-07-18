import type { AiStreamEvent, AiTaskError, AiTaskKind, AiTaskPhase, AiTaskRunOptions } from "./types";

export type AiStreamUnlisten = () => void;

export type AiStreamRuntimeDependencies = {
  listen: (eventName: "ai:stream", handler: (event: AiStreamEvent<unknown>) => void) => Promise<AiStreamUnlisten>;
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  cancel: (requestId: string) => Promise<unknown>;
  setTimer?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  createRequestId?: () => string;
};

export type RunAiStreamInput<T> = {
  command: string;
  task: AiTaskKind;
  buildArgs: (requestId: string) => Record<string, unknown>;
  options?: AiTaskRunOptions;
};

export class AiStreamRuntimeError extends Error {
  readonly code: AiTaskError["code"];
  readonly retryable: boolean;
  readonly requestId: string;

  constructor(error: AiTaskError, requestId: string) {
    super(error.message);
    this.name = "AiStreamRuntimeError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.requestId = requestId;
  }
}

const ACCEPTED_TIMEOUT_MS = 3_000;
const TERMINAL_TIMEOUT_MS = 100_000;

export async function runAiStream<T>(
  dependencies: AiStreamRuntimeDependencies,
  input: RunAiStreamInput<T>
): Promise<T> {
  const setTimer = dependencies.setTimer || ((handler, timeoutMs) => setTimeout(handler, timeoutMs));
  const clearTimer = dependencies.clearTimer || ((timer) => clearTimeout(timer));
  const requestId = (dependencies.createRequestId || createRequestId)();
  const options = input.options || {};
  let unlisten: AiStreamUnlisten | null = null;
  let acceptedTimer: ReturnType<typeof setTimeout> | null = null;
  let terminalTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSequence = -1;
  let settled = false;
  let acknowledged = false;

  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const cleanup = () => {
    if (acceptedTimer !== null) clearTimer(acceptedTimer);
    if (terminalTimer !== null) clearTimer(terminalTimer);
    acceptedTimer = null;
    terminalTimer = null;
    options.signal?.removeEventListener("abort", handleAbort);
    if (unlisten) {
      const stop = unlisten;
      unlisten = null;
      stop();
    }
  };

  const finishWithError = (error: AiTaskError, cancelBackend = false) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (cancelBackend) void dependencies.cancel(requestId).catch(() => undefined);
    rejectResult(new AiStreamRuntimeError(error, requestId));
  };

  const finishWithResult = (value: T) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveResult(value);
  };

  function handleAbort() {
    finishWithError({ code: "cancelled", message: "AI 任务已取消。", retryable: true }, true);
  }

  if (options.signal?.aborted) {
    handleAbort();
    return result;
  }

  try {
    unlisten = await dependencies.listen("ai:stream", (event) => {
      if (settled || event.request_id !== requestId || event.task !== input.task) return;
      if (!Number.isFinite(event.sequence) || event.sequence <= lastSequence) return;
      lastSequence = event.sequence;

      if (event.event === "phase") {
        if (!event.phase) return;
        if (event.phase === "accepted" && !acknowledged) {
          acknowledged = true;
          if (acceptedTimer !== null) clearTimer(acceptedTimer);
          acceptedTimer = null;
        }
        options.onPhase?.(event.phase);
        return;
      }

      if (event.event === "chunk") {
        if (typeof event.chunk === "string") options.onChunk?.(event.chunk);
        return;
      }

      if (event.event === "done") {
        if (event.result === undefined) {
          finishWithError({ code: "protocol", message: "AI 任务完成事件缺少结果。", retryable: true });
          return;
        }
        finishWithResult(event.result as T);
        return;
      }

      finishWithError(event.error || { code: "internal", message: "AI 任务失败。", retryable: true });
    });
  } catch (error) {
    finishWithError({ code: "internal", message: normalizeError(error, "无法监听 AI 任务事件。"), retryable: true });
    return result;
  }

  if (settled) return result;
  if (options.signal?.aborted) {
    handleAbort();
    return result;
  }
  options.onRequestId?.(requestId);
  options.signal?.addEventListener("abort", handleAbort, { once: true });
  acceptedTimer = setTimer(() => {
    finishWithError({ code: "timeout", message: "桌面端未在 3 秒内接收 AI 任务。", retryable: true }, true);
  }, ACCEPTED_TIMEOUT_MS);
  terminalTimer = setTimer(() => {
    finishWithError({ code: "timeout", message: "AI 任务超过 100 秒仍未结束，已自动取消。", retryable: true }, true);
  }, TERMINAL_TIMEOUT_MS);

  void dependencies.invoke(input.command, input.buildArgs(requestId)).catch((error) => {
    finishWithError({ code: "internal", message: normalizeError(error, "无法启动 AI 任务。"), retryable: true });
  });

  return result;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
