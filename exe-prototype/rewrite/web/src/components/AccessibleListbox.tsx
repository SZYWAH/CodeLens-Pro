import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type ListboxOption = {
  value: string;
  label: string;
};

export function AccessibleListbox({
  label,
  value,
  options,
  onChange,
  disabled = false,
  compact = false
}: {
  label: string;
  value: string;
  options: ListboxOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((item) => item.value === value)));
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const selectedIndex = Math.max(0, options.findIndex((item) => item.value === value));
  const selected = options[selectedIndex] || options[0];

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const desiredHeight = Math.min(280, options.length * 38 + 12);
      const spaceBelow = window.innerHeight - rect.bottom - 10;
      const spaceAbove = rect.top - 10;
      const placeAbove = spaceBelow < Math.min(180, desiredHeight) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(desiredHeight, placeAbove ? spaceAbove : spaceBelow));
      setPopupStyle({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        top: placeAbove ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6,
        width: rect.width,
        maxHeight
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  function selectIndex(index: number) {
    const option = options[index];
    if (!option) return;
    setActiveIndex(index);
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (options.length === 0) return;
    setActiveIndex((current) => (current + delta + options.length) % options.length);
  }

  function handleTypeahead(key: string) {
    typeaheadRef.current += key.toLocaleLowerCase();
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = "";
      typeaheadTimerRef.current = null;
    }, 650);
    const query = typeaheadRef.current;
    const match = options.findIndex((item) => item.label.toLocaleLowerCase().startsWith(query));
    if (match >= 0) {
      setActiveIndex(match);
      if (!open) setOpen(true);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      setOpen(true);
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      if (open) selectIndex(activeIndex);
      else setOpen(true);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && open) {
      setOpen(false);
      event.preventDefault();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      handleTypeahead(event.key);
      event.preventDefault();
    }
  }

  const popup = open && typeof document !== "undefined"
    ? createPortal(
        <div
          className="accessible-listbox-popover-v143"
          id={id + "-listbox"}
          ref={popupRef}
          role="listbox"
          aria-label={label}
          style={popupStyle}
        >
          {options.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={(index === activeIndex ? "is-active " : "") + (option.value === value ? "is-selected" : "")}
              id={id + "-option-" + index}
              key={option.value}
              onClick={() => selectIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={compact ? "accessible-listbox-field-v143 is-compact" : "accessible-listbox-field-v143"}>
      <span className={compact ? "accessible-listbox-label-v143" : undefined} id={id + "-label"}>{label}</span>
      <button
        aria-activedescendant={open ? id + "-option-" + activeIndex : undefined}
        aria-controls={id + "-listbox"}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={id + "-label " + id + "-value"}
        className={open ? "accessible-listbox-trigger-v143 is-open" : "accessible-listbox-trigger-v143"}
        disabled={disabled}
        id={id + "-value"}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        ref={buttonRef}
        role="combobox"
        type="button"
      >
        <span>{selected?.label || "请选择"}</span>
        <ChevronDown size={15} />
      </button>
      {popup}
    </div>
  );
}
