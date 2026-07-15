import { useEffect, useRef, useState } from "react";

const launchDurationMs = 1600;
const launchExitMs = 160;

export function LaunchScreen({ onComplete }: { onComplete: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const completedRef = useRef(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedMotionRef.current = reducedMotion;
    let exitTimer = 0;

    function finish() {
      if (completedRef.current) return;
      completedRef.current = true;
      if (reducedMotion) {
        onComplete();
        return;
      }
      setLeaving(true);
      exitTimer = window.setTimeout(onComplete, launchExitMs);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      finish();
    }

    const timer = window.setTimeout(finish, launchDurationMs);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(exitTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onComplete]);

  return (
    <main
      aria-label="CodeLens Pro Next 正在启动"
      className={`launch-screen-v1417 ${leaving ? "is-leaving" : ""}`}
      onClick={() => {
        if (completedRef.current) return;
        completedRef.current = true;
        if (reducedMotionRef.current) {
          onComplete();
          return;
        }
        setLeaving(true);
        window.setTimeout(onComplete, launchExitMs);
      }}
    >
      <div className="launch-brand-v1417">
        <img alt="CodeLens Pro Next" src="/codelens-next.ico" />
        <h1>CodeLens Pro Next</h1>
        <p>沿波讨源，虽幽必显</p>
      </div>
    </main>
  );
}
