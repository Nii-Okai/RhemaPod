/* Geometry-matched loading state for the sermon editor (design "Loading:
   skeletons that match final geometry"). No spinners. */

function Block({ className }: { className?: string }) {
  return <span className={`block rounded-8 bg-border-subtle ${className ?? ""}`} />;
}

export function EditorSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-16">
      {/* breadcrumb + save row */}
      <div className="flex items-center justify-between gap-16">
        <Block className="h-[16px] w-[220px]" />
        <div className="flex items-center gap-8">
          <Block className="h-[14px] w-[96px]" />
          <Block className="h-[38px] w-[104px] rounded-10" />
          <Block className="h-[38px] w-[140px] rounded-10" />
        </div>
      </div>

      {/* title row */}
      <div className="flex items-center gap-12">
        <Block className="h-[34px] w-[340px]" />
        <Block className="h-[26px] w-[96px] rounded-full" />
      </div>

      {/* body grid */}
      <div className="grid items-start gap-16 min-[1100px]:grid-cols-[1.7fr_1fr]">
        <div className="flex flex-col gap-16">
          <Block className="h-[360px] w-full rounded-16" />
          <Block className="h-[220px] w-full rounded-16" />
        </div>
        <div className="flex flex-col gap-16">
          <Block className="h-[210px] w-full rounded-16" />
          <Block className="h-[150px] w-full rounded-16" />
          <Block className="h-[190px] w-full rounded-16" />
        </div>
      </div>
    </div>
  );
}
