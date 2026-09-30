import { useEffect, useRef, useState, type ReactNode } from "react";

/** Bootstrap-styled dropdown driven by React state (no Bootstrap JS). */
export function Dropdown({
  label,
  children,
  className = "btn btn-outline-secondary btn-sm",
  align = "start",
  keepOpen = false,
  disabled = false,
  title,
  block = false,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  /** Keep open while clicking inside (checklists). */
  keepOpen?: boolean;
  disabled?: boolean;
  title?: string;
  /** Full-width trigger and menu. */
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`dropdown ${block ? "d-block" : "d-inline-block"}`} ref={root}>
      <button
        type="button"
        className={`${className} dropdown-toggle`}
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      <div
        className={`dropdown-menu${open ? " show" : ""}${align === "end" ? " dropdown-menu-end" : ""}${block ? " w-100" : ""}`}
        style={align === "end" ? { right: 0, left: "auto" } : undefined}
        onClick={keepOpen ? undefined : () => setOpen(false)}
      >
        {children}
      </div>
    </div>
  );
}
