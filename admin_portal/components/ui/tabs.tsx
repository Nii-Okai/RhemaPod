import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "cn";

/* =============================================================================
   Tabs — RhemaPod UI Kit primitive (W2). Restyled Radix Tabs.
   Underline treatment on the token palette: clay active border + ink label,
   ink-muted inactive. Radix supplies roving focus + aria.
   ========================================================================== */

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-16", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex items-center gap-20 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px cursor-pointer border-b-2 border-transparent px-1 pb-[10px] text-[14px] font-semibold text-ink-muted transition-colors duration-150 ease-out outline-none",
        "hover:text-ink focus-visible:focus-ring-button",
        "data-[state=active]:border-clay-600 data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
