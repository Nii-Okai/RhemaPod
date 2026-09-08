import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";

/**
 * Label + login-size Input + inline error, matching the design's field spec
 * (README "Components to build → Input": rose border + 12px rose message on
 * error; label turns rose too).
 */
export function Field({
  label,
  error,
  id,
  ...inputProps
}: { label: string; error?: string | null } & Omit<
  ComponentProps<typeof Input>,
  "inputSize" | "error"
>) {
  const describedBy = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-6">
      <label
        htmlFor={id}
        className={`text-[13px] font-medium ${error ? "text-rose-text" : "text-ink-muted"}`}
      >
        {label}
      </label>
      <Input
        id={id}
        inputSize="login"
        error={Boolean(error)}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {error ? (
        <p id={describedBy} className="text-[12px] text-rose-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
