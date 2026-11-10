"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/portal";
import { StatusPill } from "@/components/devotionals/status-pill";
import { useSession } from "@/lib/auth/session-context";
import {
  dayLabel,
  isCovered,
  localToday,
  monthGrid,
  monthLabel,
  monthsIn,
  rangeFor,
  rangeLabel,
  shiftAnchor,
  type CalendarRange,
} from "@/lib/devotionals/calendar";
import {
  useDevotionalCalendar,
  useEvergreenPool,
  usePendingDevotionals,
  type DevotionalListItem,
} from "@/lib/query/hooks/use-devotionals";

/* =============================================================================
   Library › Devotionals (plan-daily-devotional A1–A2).

   The planner's view: a week / month / quarter calendar of dated devotionals,
   the "days ready ahead" gap alert, what is waiting for review, and the
   evergreen pool that fills any empty day (ADR 0022 §3).

   A day cell links to its devotional, or to /devotionals/new?date=… when it is
   empty, so filling a gap is one click.
   ========================================================================== */

const VIEWS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
] as const;

const WEEKDAY_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DevotionalsScreen() {
  const { role } = useSession();
  const isManager = role === "manager" || role === "admin";
  const today = localToday();
  const [view, setView] = React.useState<CalendarRange>("month");
  const [anchor, setAnchor] = React.useState(today);
  const { from, to } = rangeFor(view, anchor);

  const calendar = useDevotionalCalendar(from, to);
  const pool = useEvergreenPool();
  const pending = usePendingDevotionals(isManager);

  const byDate = React.useMemo(() => {
    const map = new Map<string, DevotionalListItem | null>();
    for (const d of calendar.data?.days ?? []) map.set(d.date, d.devotional ?? null);
    return map;
  }, [calendar.data]);

  const cal = calendar.data;
  const short = cal ? cal.ready_days_ahead < cal.gap_alert_days : false;

  return (
    <div className="flex flex-col gap-20">
      <PageHeader
        title="Devotionals"
        subhead="One quiet-time devotional per day. Empty days fall back to the evergreen pool."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/devotionals/import">Bulk import</Link>
            </Button>
            <Button asChild>
              <Link href="/devotionals/new">New devotional</Link>
            </Button>
          </>
        }
      />

      {cal ? (
        short ? (
          <Alert variant="warning" title={`Only ${cal.ready_days_ahead} day${cal.ready_days_ahead === 1 ? "" : "s"} ready ahead`}>
            The church asks for {cal.gap_alert_days}. Listeners will see an evergreen devotional on
            any empty day{cal.evergreen_ready === 0 ? ", but the evergreen pool is empty, so they will see nothing" : ""}.
          </Alert>
        ) : (
          <Alert variant="success" title={`${cal.ready_days_ahead} days ready ahead`}>
            {cal.evergreen_ready} evergreen devotional{cal.evergreen_ready === 1 ? "" : "s"} in reserve.
          </Alert>
        )
      ) : null}

      <div className="grid grid-cols-1 items-start gap-16 min-[1100px]:grid-cols-[1fr_320px]">
        <Card className="flex min-w-0 flex-col gap-16">
          <div className="flex flex-wrap items-center justify-between gap-12">
            <div className="flex items-center gap-8">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Previous"
                onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
              >
                ‹
              </Button>
              <h2 className="min-w-[180px] text-center text-[15px] font-semibold" aria-live="polite">
                {rangeLabel(view, from, to)}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Next"
                onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
              >
                ›
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAnchor(today)}>
                Today
              </Button>
            </div>
            <SegmentedControl
              aria-label="Calendar range"
              options={VIEWS}
              value={view}
              onValueChange={(v) => setView(v as CalendarRange)}
              className="w-[240px]"
            />
          </div>

          {calendar.isError ? (
            <Alert variant="error" title="Couldn’t load the calendar">
              <button type="button" className="underline" onClick={() => void calendar.refetch()}>
                Try again
              </button>
            </Alert>
          ) : view === "week" ? (
            <WeekList from={from} byDate={byDate} today={today} loading={calendar.isPending} />
          ) : (
            <div className="flex flex-col gap-24">
              {monthsIn(from, to).map((m) => (
                <MonthGrid
                  key={m}
                  month={m}
                  byDate={byDate}
                  today={today}
                  showTitle={view === "quarter"}
                  compact={view === "quarter"}
                />
              ))}
            </div>
          )}
          <Legend />
        </Card>

        <div className="flex flex-col gap-16">
          {isManager ? (
            <SidePanel
              title="Waiting for review"
              empty="Nothing waiting."
              loading={pending.isPending}
              items={pending.data ?? []}
            />
          ) : null}
          <SidePanel
            title="Evergreen pool"
            hint="Shown on any day with nothing scheduled. The same one for every listener that day."
            empty="No evergreen devotionals yet. Create one without a date to start the pool."
            loading={pool.isPending}
            items={pool.data?.items ?? []}
          />
        </div>
      </div>
    </div>
  );
}

function dayHref(date: string, d: DevotionalListItem | null | undefined) {
  return d ? `/devotionals/${d.id}` : `/devotionals/new?date=${date}`;
}

function WeekList({
  from,
  byDate,
  today,
  loading,
}: {
  from: string;
  byDate: Map<string, DevotionalListItem | null>;
  today: string;
  loading: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return (
    <ul className="flex flex-col divide-y divide-border-subtle rounded-12 border border-border">
      {days.map((date) => {
        const d = byDate.get(date);
        return (
          <li key={date}>
            <Link
              href={dayHref(date, d)}
              className="flex items-center gap-16 px-16 py-12 hover:bg-clay-50 focus-visible:focus-ring-button"
            >
              <span
                className={cn(
                  "w-[96px] shrink-0 font-mono text-[12.5px]",
                  date === today ? "font-semibold text-clay-700" : "text-ink-faint",
                )}
              >
                {dayLabel(date)}
              </span>
              {loading ? (
                <span className="h-[14px] w-1/2 rounded-6 bg-border-subtle" aria-hidden />
              ) : d ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                    {d.title}
                    <span className="ml-8 text-ink-faint">{d.passage_ref}</span>
                  </span>
                  {d.has_reading ? (
                    <span className="text-[12px] text-ink-faint">Reading</span>
                  ) : null}
                  <StatusPill status={d.display_status} />
                </>
              ) : (
                <span className="flex-1 text-[13.5px] text-ink-faint">
                  Empty, evergreen will show · <span className="text-clay-600">Add one</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MonthGrid({
  month,
  byDate,
  today,
  showTitle,
  compact,
}: {
  month: string;
  byDate: Map<string, DevotionalListItem | null>;
  today: string;
  showTitle: boolean;
  compact: boolean;
}) {
  return (
    <section aria-label={monthLabel(month)} className="flex flex-col gap-8">
      {showTitle ? <h3 className="text-[14px] font-semibold text-ink">{monthLabel(month)}</h3> : null}
      <div className="grid grid-cols-7 gap-4" role="grid">
        {WEEKDAY_HEAD.map((w) => (
          <div key={w} role="columnheader" className="px-4 font-mono text-[11px] uppercase text-ink-faint">
            {w}
          </div>
        ))}
        {monthGrid(month).map((date, i) => {
          if (!date) return <div key={`pad-${i}`} aria-hidden />;
          const d = byDate.get(date);
          const covered = isCovered(d?.display_status);
          const past = date < today;
          return (
            <Link
              key={date}
              role="gridcell"
              href={dayHref(date, d)}
              aria-label={`${dayLabel(date)}: ${d ? `${d.title}, ${d.display_status.replace("_", " ")}` : "empty"}`}
              className={cn(
                "flex flex-col gap-2 rounded-8 border p-6 text-left focus-visible:focus-ring-button",
                compact ? "min-h-[44px]" : "min-h-[86px]",
                d
                  ? covered
                    ? "border-sage-dot bg-sage-tint/50 hover:bg-sage-tint"
                    : "border-wheat-tint bg-wheat-tint/40 hover:bg-wheat-tint"
                  : past
                    ? "border-border-subtle bg-surface-sunken"
                    : "border-dashed border-border-strong hover:bg-clay-50",
                date === today && "ring-2 ring-clay-400",
              )}
            >
              <span className="font-mono text-[11.5px] text-ink-faint">{Number(date.slice(8, 10))}</span>
              {d && !compact ? (
                <>
                  <span className="line-clamp-2 text-[12.5px] leading-tight text-ink">{d.title}</span>
                  <span className="truncate text-[11px] text-ink-faint">{d.passage_ref}</span>
                </>
              ) : null}
              {d && compact ? (
                <span aria-hidden className={cn("size-[6px] rounded-full", covered ? "bg-sage" : "bg-wheat")} />
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-16 text-[12.5px] text-ink-muted">
      <li className="flex items-center gap-6">
        <span aria-hidden className="size-[10px] rounded-3 border border-sage-dot bg-sage-tint" /> Approved
      </li>
      <li className="flex items-center gap-6">
        <span aria-hidden className="size-[10px] rounded-3 border border-wheat-tint bg-wheat-tint" /> In progress
      </li>
      <li className="flex items-center gap-6">
        <span aria-hidden className="size-[10px] rounded-3 border border-dashed border-border-strong" /> Empty
        (evergreen shows)
      </li>
    </ul>
  );
}

function SidePanel({
  title,
  hint,
  empty,
  loading,
  items,
}: {
  title: string;
  hint?: string;
  empty: string;
  loading: boolean;
  items: DevotionalListItem[];
}) {
  return (
    <Card className="flex flex-col gap-12">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {!loading ? <span className="font-mono text-[12px] text-ink-faint">{items.length}</span> : null}
      </CardHeader>
      {hint ? <p className="text-[12.5px] text-ink-faint">{hint}</p> : null}
      {loading ? (
        <span className="h-[40px] rounded-8 bg-border-subtle" aria-hidden />
      ) : items.length === 0 ? (
        <p className="text-[13.5px] text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((d) => (
            <li key={d.id}>
              <Link
                href={`/devotionals/${d.id}`}
                className="flex items-center justify-between gap-8 rounded-8 px-8 py-6 hover:bg-clay-50 focus-visible:focus-ring-button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] text-ink">{d.title}</span>
                  <span className="block truncate text-[12px] text-ink-faint">
                    {d.date ? `${dayLabel(d.date)} · ` : ""}
                    {d.passage_ref}
                  </span>
                </span>
                <StatusPill status={d.display_status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
