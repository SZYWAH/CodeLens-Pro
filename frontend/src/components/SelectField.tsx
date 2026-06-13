import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  label: string;
  value: string;
};

export function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  disabled = false
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selected = options.find((item) => item.value === value) ?? options[0];
  const isDisabled = disabled || !options.length;

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportGap = 10;
    const maxHeight = Math.min(300, window.innerHeight - rect.bottom - viewportGap);
    setMenuStyle({
      left: rect.left,
      top: rect.bottom + 6,
      width: rect.width,
      maxHeight: Math.max(160, maxHeight)
    });
  }, []);

  function openMenu() {
    if (isDisabled) return;
    updatePosition();
    setOpen(true);
    window.requestAnimationFrame(updatePosition);
  }

  function closeMenu() {
    setOpen(false);
  }

  function choose(nextValue: string) {
    onChange(nextValue);
    closeMenu();
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      buttonRef.current?.focus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (index + offset + options.length) % options.length;
      menuRef.current?.querySelectorAll<HTMLButtonElement>(".select-option")[nextIndex]?.focus();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[index].value);
    }
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={buttonRef}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={["select-field", open ? "select-field-open" : "", className].filter(Boolean).join(" ")}
        disabled={isDisabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleButtonKeyDown}
        type="button"
      >
        <span className="select-field-value">{selected?.label ?? "请选择"}</span>
        <ChevronDown className="select-field-icon" size={16} />
      </button>

      {open
        ? createPortal(
            <div ref={menuRef} id={listboxId} className="select-menu-layer" role="listbox" style={menuStyle}>
              {options.map((item, index) => {
                const isSelected = item.value === value;
                return (
                  <button
                    key={`${item.value}-${index}`}
                    aria-selected={isSelected}
                    className={["select-option", isSelected ? "select-option-selected" : ""].filter(Boolean).join(" ")}
                    onClick={() => choose(item.value)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    role="option"
                    type="button"
                  >
                    <span>{item.label}</span>
                    {isSelected ? <Check size={14} /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
