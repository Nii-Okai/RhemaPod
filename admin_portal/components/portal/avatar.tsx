import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Avatar — RhemaPod UI Kit primitive (W2). Hand-built.

   Initials, 700 weight, tinted by a hash of the name (README §"Avatar";
   sidebar footer + Speakers panel "rotating tint — clay, sage, slate,
   neutral"). The hash MUST be deterministic and identical on server and client
   or hydration mismatches — it is a plain string hash, never Math.random / Date
   (plan §A.6). Pure helpers `avatarHash` / `avatarTint` / `initials` are
   unit-tested.
   ========================================================================== */

export const AVATAR_TINTS = ["clay", "sage", "slate", "neutral"] as const;
export type AvatarTint = (typeof AVATAR_TINTS)[number];

const TINT_CLASS: Record<AvatarTint, string> = {
  clay: "bg-clay-100 text-clay-700",
  sage: "bg-sage-tint text-sage-text",
  slate: "bg-slate-tint text-slate-text",
  neutral: "bg-neutral-badge text-ink-soft",
};

/** djb2 string hash → non-negative 32-bit int. Stable across environments. */
export function avatarHash(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = (h * 33) ^ name.charCodeAt(i);
  }
  return h >>> 0;
}

/** Deterministic tint for a name. */
export function avatarTint(name: string): AvatarTint {
  return AVATAR_TINTS[avatarHash(name.trim()) % AVATAR_TINTS.length];
}

/** Up to two uppercase initials. "Ada Nwosu" -> "AN", "Cher" -> "CH", "" -> "?". */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type AvatarProps = Omit<React.ComponentProps<"span">, "children"> & {
  name: string;
  /** px; the glyph scales with it. Default 32 (sidebar footer). */
  size?: number;
  /** Override the hashed tint. */
  tint?: AvatarTint;
};

function Avatar({ name, size = 32, tint, className, style, ...props }: AvatarProps) {
  const resolved = tint ?? avatarTint(name);
  return (
    <span
      data-slot="avatar"
      data-tint={resolved}
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        TINT_CLASS[resolved],
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.39),
        ...style,
      }}
      {...props}
    >
      {initials(name)}
    </span>
  );
}

export { Avatar };
export type { AvatarProps };
