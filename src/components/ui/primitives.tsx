"use client";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "bg-surface-2 text-fg border border-border hover:bg-border/60",
  ghost: "text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }>(
  function Button({ variant = "secondary", size = "md", className, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none",
          size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
          VARIANTS[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx("h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx("w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted", className)} {...props} />;
});

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("h-10 rounded-lg border border-border bg-surface px-3 text-sm text-fg", className)} {...props} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-border bg-surface", className)}>{children}</div>;
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode; className?: string }) {
  const t = { info: "border-border bg-surface-2", warn: "border-warn/40 bg-warn/10", error: "border-danger/40 bg-danger/10", ok: "border-ok/40 bg-ok/10" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg border px-3 py-2 text-sm", t, className)}>{children}</div>;
}

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return <label htmlFor={htmlFor} className={cx("mb-1 block text-xs font-medium text-muted", className)}>{children}</label>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full bg-accent transition-[width]" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full overflow-auto rounded-t-2xl border border-border bg-surface p-4 shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
