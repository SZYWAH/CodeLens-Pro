import { useEffect, useRef, type RefObject } from "react";

type ElementRef = RefObject<HTMLElement | null>;

export type OverlayFocusOptions = {
  active: boolean;
  containerRef: ElementRef;
  initialFocusRef?: ElementRef;
  returnFocusRef?: ElementRef;
  onRequestClose: () => void;
  closeOnEscape?: boolean;
  focusKey?: string | number | boolean;
};

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
    if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[inert]")) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return element.getClientRects().length > 0;
  });
}

export function useOverlayFocus(options: OverlayFocusOptions) {
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
      const elements = container ? getFocusableElements(container) : [];
      const requestedTarget = options.initialFocusRef?.current;
      const target = requestedTarget && elements.includes(requestedTarget) ? requestedTarget : elements[0];
      target?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && options.closeOnEscape !== false) {
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
  }, [options.active, options.closeOnEscape, options.containerRef, options.focusKey, options.initialFocusRef, options.returnFocusRef]);
}
