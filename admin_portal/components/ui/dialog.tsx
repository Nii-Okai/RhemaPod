"use client";

import * as React from "react";
import { Dialog as RD } from "radix-ui";
import { cn } from "cn";

/* =============================================================================
   Dialog — RhemaPod UI Kit primitive. Restyled Radix.

   Radix owns the hard parts the design's Accessibility section demands — focus
   trap + return, `Esc` to close, `role="dialog"` / `aria-modal`, scroll lock,
   the labelled title/description wiring. This file is only the skin: a dimmed
   `ink/40` backdrop and a white, radius-16, `shadow-toast` panel centred in the
   viewport, entering with the same 120ms `rp-menu-in` motion as the menu.

   Every dialog MUST render a `<DialogTitle>` (visually hidden is fine) so the
   accessible name is set — Radix warns otherwise.
   ========================================================================== */

const Dialog = RD.Root;
const DialogTrigger = RD.Trigger;
const DialogClose = RD.Close;

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RD.Content>) {
  return (
    <RD.Portal>
      <RD.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-ink/40",
          "data-[state=open]:animate-[rp-menu-in_120ms_ease-out]",
        )}
      />
      <RD.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex w-[min(680px,calc(100vw-32px))] max-h-[calc(100vh-64px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-14 overflow-y-auto rounded-16 border border-border bg-surface p-20 shadow-toast",
          "data-[state=open]:animate-[rp-menu-in_120ms_ease-out]",
          "focus-visible:outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </RD.Content>
    </RD.Portal>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof RD.Title>) {
  return (
    <RD.Title
      className={cn(
        "font-serif text-[19px] leading-[1.25] tracking-[-0.01em] text-ink",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof RD.Description>) {
  return (
    <RD.Description
      className={cn("text-[13.5px] text-ink-muted", className)}
      {...props}
    />
  );
}

/** A visually-hidden node — use to satisfy the required title/description
    without showing it. */
function DialogSrOnly({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0_0_0_0)]">
      {children}
    </span>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogSrOnly,
};
