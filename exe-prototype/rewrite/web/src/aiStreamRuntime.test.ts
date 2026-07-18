import { afterEach, describe, expect, it, vi } from "vitest";
import { runAiStream, type AiStreamRuntimeDependencies } from "./aiStreamRuntime";
import type { AiStreamEvent } from "./types";

type EventHandler = (event: AiStreamEvent<unknown>) => void;

function runtimeHarness() {
  let handler: EventHandler | null = null;
  const unlisten = vi.fn();
  const invoke = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  const listen = vi.fn(async (_eventName: "ai:stream", next: EventHandler) => {
    handler = next;
    return unlisten;
  });
  const dependencies: AiStreamRuntimeDependencies = {
    listen,
    invoke,
    cancel,
    createRequestId: () => "request-1"
  };
  return {
    dependencies,
    invoke,
    cancel,
    unlisten,
    emit(event: AiStreamEvent<unknown>) {
      if (!handler) throw new Error("listener is not registered");
      handler(event);
    }
  };
}

function event(
  sequence: number,
  value: Partial<AiStreamEvent<unknown>> = {}
): AiStreamEvent<unknown> {
  return {
    request_id: "request-1",
    task: "diff_review",
    event: "phase",
    phase: "accepted",
    sequence,
    ...value
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runAiStream", () => {
  it("registers the listener before invoking and resolves the matching request", async () => {
    const harness = runtimeHarness();
    const phases: string[] = [];
    const chunks: string[] = [];
    const pending = runAiStream<{ ok: boolean }>(harness.dependencies, {
      command: "analyze_diff_stream",
      task: "diff_review",
      buildArgs: (requestId) => ({ requestId }),
      options: {
        onPhase: (phase) => phases.push(phase),
        onChunk: (chunk) => chunks.push(chunk)
      }
    });

    await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledOnce());
    expect(harness.dependencies.listen).toHaveBeenCalledBefore(harness.invoke);

    harness.emit(event(0));
    harness.emit(event(1, { event: "chunk", phase: undefined, chunk: "hello" }));
    harness.emit(event(2, { event: "done", phase: undefined, result: { ok: true } }));

    await expect(pending).resolves.toEqual({ ok: true });
    expect(phases).toEqual(["accepted"]);
    expect(chunks).toEqual(["hello"]);
    expect(harness.unlisten).toHaveBeenCalledOnce();
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("ignores foreign, duplicate, and out-of-order events", async () => {
    const harness = runtimeHarness();
    const chunks: string[] = [];
    const pending = runAiStream<string>(harness.dependencies, {
      command: "analyze_diff_stream",
      task: "diff_review",
      buildArgs: () => ({}),
      options: { onChunk: (chunk) => chunks.push(chunk) }
    });

    await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledOnce());
    harness.emit(event(0));
    harness.emit(event(1, { request_id: "other", event: "done", phase: undefined, result: "wrong" }));
    harness.emit(event(2, { event: "chunk", phase: undefined, chunk: "new" }));
    harness.emit(event(1, { event: "chunk", phase: undefined, chunk: "old" }));
    harness.emit(event(3, { event: "done", phase: undefined, result: "done" }));

    await expect(pending).resolves.toBe("done");
    expect(chunks).toEqual(["new"]);
  });

  it("rejects immediately when listener registration fails", async () => {
    const dependencies: AiStreamRuntimeDependencies = {
      listen: vi.fn(async () => { throw new Error("listen failed"); }),
      invoke: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      createRequestId: () => "request-1"
    };

    const pending = runAiStream(dependencies, {
      command: "analyze_diff_stream",
      task: "diff_review",
      buildArgs: () => ({})
    });

    await expect(pending).rejects.toMatchObject({
      code: "internal",
      requestId: "request-1"
    });
    expect(dependencies.invoke).not.toHaveBeenCalled();
  });

  it("cancels when the desktop does not acknowledge within three seconds", async () => {
    vi.useFakeTimers();
    const harness = runtimeHarness();
    const pending = runAiStream(harness.dependencies, {
      command: "analyze_diff_stream",
      task: "diff_review",
      buildArgs: () => ({})
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(3_001);
    await rejection;
    expect(harness.cancel).toHaveBeenCalledWith("request-1");
    expect(harness.unlisten).toHaveBeenCalledOnce();
  });

  it("enforces the terminal watchdog after acknowledgement", async () => {
    vi.useFakeTimers();
    const harness = runtimeHarness();
    const pending = runAiStream(harness.dependencies, {
      command: "analyze_diff_stream",
      task: "diff_review",
      buildArgs: () => ({})
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(0);
    harness.emit(event(0));
    await vi.advanceTimersByTimeAsync(100_001);
    await rejection;
    expect(harness.cancel).toHaveBeenCalledWith("request-1");
    expect(harness.unlisten).toHaveBeenCalledOnce();
  });

  it("cancels and cleans up when the caller aborts", async () => {
    const harness = runtimeHarness();
    const controller = new AbortController();
    const pending = runAiStream(harness.dependencies, {
      command: "analyze_diff_stream",
      task: "diff_review",
      buildArgs: () => ({}),
      options: { signal: controller.signal }
    });

    await vi.waitFor(() => expect(harness.invoke).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(harness.cancel).toHaveBeenCalledWith("request-1");
    expect(harness.unlisten).toHaveBeenCalledOnce();
  });
});
