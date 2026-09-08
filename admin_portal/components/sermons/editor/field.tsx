import type { ReactNode } from "react";
import { cn } from "cn";

/* Label + control + inline error for the editor cards. Mirrors the design's
   field spec (13px medium label, rose on error, 12px rose message). Shared by
   the Details and Access cards. */

export interface EditorFieldProps {
  label: string;
  htmlFor?: string;
  error?: string | null;
  /** Small helper text under the label (e.g. the Access sub-lines). */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function EditorField({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: EditorFieldProps) {
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          "text-[13px] font-medium",
          error ? "text-rose-text" : "text-ink-muted",
        )}
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12.5px] text-ink-faint">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="text-[12px] text-rose-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
