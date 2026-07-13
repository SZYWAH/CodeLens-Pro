import { useEffect, useRef, type RefObject } from "react";

type ElementRef = RefObject<HTMLElement | null>;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    return !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true";
  });
}

export function useOverlayFocus(options: {
  active: boolean;
  containerRef: ElementRef;
  initialFocusRef?: ElementRef;
  returnFocusRef?: ElementRef;
  onRequestClose: () => void;
}) {
  const closeRef = useRef(options.onRequestClose);
  const wasActiveRef = useRef(false);

  closeRef.current = options.onRequestClose;

  useEffect(() => {
    if (!options.active) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        window.requestAnimationFrame(() => options.returnFocusRef?.current?.focus());
      }
      return;
    }

    wasActiveRef.current = true;
    const focusFrame = window.requestAnimationFrame(() => {
      const container = options.containerRef.current;
      const target = options.initialFocusRef?.current || (container ? getFocusableElements(container)[0] : null);
      target?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const container = options.containerRef.current;
      if (!container) return;
      const elements = getFocusableElements(container);
      if (!elements.length) {
        event.preventDefault();
        return;
      }

      const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? elements.length - 1 : currentIndex - 1
        : currentIndex === elements.length - 1 ? 0 : currentIndex + 1;
      event.preventDefault();
      elements[nextIndex].focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [options.active, options.containerRef, options.initialFocusRef, options.returnFocusRef]);
}
