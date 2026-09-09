import Link from "next/link";

/* =============================================================================
   NewSeriesTile — the trailing dashed affordance in the Series grid
   (design Screen 6): centered, a 30px dashed circle, a 14.5/600 label and a
   13px explainer; hover turns the border clay-600 and the fill `clay-50`.
   ========================================================================== */

export function NewSeriesTile() {
  return (
    <Link
      href="/series/new"
      className="group flex min-h-[220px] flex-col items-center justify-center gap-8 rounded-14 border-[1.5px] border-dashed border-border-strong p-16 text-center outline-none transition-[background-color,border-color] duration-150 ease-out hover:border-clay-600 hover:bg-clay-50 focus-visible:focus-ring-button"
    >
      <span
        aria-hidden
        className="flex size-[30px] items-center justify-center rounded-full border-[1.5px] border-dashed border-border-strong text-[18px] leading-none text-ink-faint transition-colors duration-150 ease-out group-hover:border-clay-600 group-hover:text-clay-600"
      >
        +
      </span>
      <span className="text-[14.5px] font-semibold text-ink">New series</span>
      <span className="max-w-[24ch] text-pretty text-[13px] text-ink-muted">
        Group sermons into an ordered teaching series.
      </span>
    </Link>
  );
}
