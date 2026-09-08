"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Radio } from "@/components/ui/radio";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  StatusBadge,
  TierChip,
  RoleChip,
  Avatar,
  AVATAR_TINTS,
  MediaPlaceholder,
  StatCard,
  MediaCard,
  SegmentedControl,
  Pagination,
  Toast,
  EmptyState,
  DataTable,
  SERMON_STATUS_PIPELINE,
  UPLOAD_STATUS_PIPELINE,
  type AnyStatus,
  type DataTableColumn,
} from "@/components/portal";

type DemoRow = {
  id: string;
  title: string;
  speaker: string;
  duration: string;
  tier: "free" | "paid";
  status: AnyStatus;
};

const DEMO_ROWS: DemoRow[] = [
  { id: "s1", title: "The Weight of Mercy", speaker: "Ada Nwosu", duration: "42:18", tier: "paid", status: "published" },
  { id: "s2", title: "Parable of the Sower", speaker: "Daniel Okoye", duration: "35:04", tier: "free", status: "under_review" },
  { id: "s3", title: "A Table in the Wilderness", speaker: "Miriam Boateng", duration: "28:47", tier: "free", status: "draft" },
  { id: "s4", title: "On Patient Endurance", speaker: "Ada Nwosu", duration: "51:12", tier: "paid", status: "pending" },
  { id: "s5", title: "The Prodigal Returns", speaker: "Samuel Adjei", duration: "39:30", tier: "free", status: "approved" },
  { id: "s6", title: "Living Water", speaker: "Daniel Okoye", duration: "44:56", tier: "paid", status: "rejected" },
];

const DEMO_COLUMNS: DataTableColumn<DemoRow>[] = [
  {
    key: "title",
    header: "Sermon",
    gridWidth: "2.4fr",
    cell: (r) => (
      <div className="flex min-w-0 items-center gap-10">
        <MediaPlaceholder
          scale="thumb"
          className="h-[24px] w-[40px] shrink-0 rounded-4"
          label="thumb"
        />
        <span className="truncate text-[14.5px] font-semibold">{r.title}</span>
      </div>
    ),
  },
  {
    key: "speaker",
    header: "Speaker",
    gridWidth: "1.1fr",
    cell: (r) => (
      <span className="truncate text-[14px] text-ink-muted">{r.speaker}</span>
    ),
  },
  {
    key: "duration",
    header: "Length",
    gridWidth: "84px",
    align: "end",
    cell: (r) => (
      <span className="font-mono text-[12.5px] text-ink-muted">
        {r.duration}
      </span>
    ),
  },
  {
    key: "tier",
    header: "Tier",
    gridWidth: "74px",
    cell: (r) => <TierChip tier={r.tier} />,
  },
  {
    key: "status",
    header: "Status",
    gridWidth: "1.1fr",
    cell: (r) => <StatusBadge status={r.status} />,
  },
];

function RowMenuGlyph() {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Row actions"
      className="rounded-6 px-6 text-[16px] leading-none text-ink-faint hover:bg-surface-sunken"
    >
      &#x22EF;
    </button>
  );
}

function DataTableShowcase() {
  const [page, setPage] = React.useState(1);
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-6">
        <span className="text-mono-eyebrow text-ink-faint">
          idle · selectable · footer range + pagination — click a checkbox to
          swap the header for the clay bulk bar
        </span>
        <DataTable
          caption="Sermons (showcase)"
          columns={DEMO_COLUMNS}
          rows={DEMO_ROWS}
          rowKey={(r) => r.id}
          selectable
          bulkActions={
            <>
              <Button size="sm" variant="secondary">
                Submit for review
              </Button>
              <Button size="sm" variant="destructive">
                Delete
              </Button>
            </>
          }
          rowActions={() => <RowMenuGlyph />}
          onRowClick={() => {}}
          rangeLabel="1–6 of 128"
          page={page}
          pageCount={22}
          onPageChange={setPage}
        />
      </div>

      <div className="flex flex-col gap-6">
        <span className="text-mono-eyebrow text-ink-faint">
          two rows selected · clay bulk bar · selected rows tinted clay-50
        </span>
        <DataTable
          caption="Sermons (bulk-bar showcase)"
          columns={DEMO_COLUMNS}
          rows={DEMO_ROWS}
          rowKey={(r) => r.id}
          selectable
          defaultSelectedKeys={new Set(["s2", "s3"])}
          bulkActions={
            <>
              <Button size="sm" variant="secondary">
                Submit for review
              </Button>
              <Button size="sm" variant="destructive">
                Delete
              </Button>
            </>
          }
          rowActions={() => <RowMenuGlyph />}
          rangeLabel="1–6 of 128"
        />
      </div>

      <div className="flex flex-col gap-6">
        <span className="text-mono-eyebrow text-ink-faint">
          loading · exact-geometry skeleton rows (#EFE9DF, 60px), no spinner
        </span>
        <DataTable
          caption="Sermons (loading showcase)"
          columns={DEMO_COLUMNS}
          rows={[]}
          rowKey={(r: DemoRow) => r.id}
          selectable
          rowActions={() => <RowMenuGlyph />}
          loading
          skeletonRows={5}
          rangeLabel="Loading…"
        />
      </div>

      <div className="flex flex-col gap-6">
        <span className="text-mono-eyebrow text-ink-faint">
          empty · the screen passes an EmptyState into the `empty` slot
        </span>
        <DataTable
          caption="Sermons (empty showcase)"
          columns={DEMO_COLUMNS}
          rows={[]}
          rowKey={(r: DemoRow) => r.id}
          selectable
          rowActions={() => <RowMenuGlyph />}
          empty={
            <EmptyState
              title="No sermons yet"
              description="Draft your first sermon and it will show up here."
              action={<Button size="sm">New sermon</Button>}
            />
          }
        />
      </div>
    </div>
  );
}

/* ============================================================================
   /kit — W2 component showcase.

   Every variant of every UI Kit primitive, laid out section-by-section to
   mirror docs/design_admin_portal/RhemaPod UI Kit.dc.html so Isaac's
   design-fidelity pass has one screen to check. Not a product screen.
   ========================================================================== */

function Section({
  index,
  title,
  blurb,
  children,
}: {
  index: string;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-20">
      <div className="flex flex-col gap-4">
        <div className="text-mono-eyebrow text-ink-faint">{index}</div>
        <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h2>
        {blurb ? (
          <p className="max-w-[62ch] text-[15px] text-ink-muted">{blurb}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-12 rounded-16 border border-border bg-surface p-24">
      {children}
    </div>
  );
}

const SERMON_STATUSES: AnyStatus[] = [
  ...SERMON_STATUS_PIPELINE,
  "rejected",
  "unpublished",
  "archived",
];
const UPLOAD_STATUSES: AnyStatus[] = [...UPLOAD_STATUS_PIPELINE, "failed"];

export default function KitPage() {
  const [seg, setSeg] = React.useState("all");
  const [notify, setNotify] = React.useState(true);
  const [downloads, setDownloads] = React.useState(false);
  const [tab, setTab] = React.useState("details");
  const [page, setPage] = React.useState(3);
  const [tags, setTags] = React.useState(["mercy", "parables"]);

  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-28 px-28 py-28">
      <header className="flex flex-col gap-14 border-b border-border pb-24">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[30px] font-normal tracking-[-0.01em]">
            Rhema
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em] text-clay-600">
            Pod
          </span>
        </div>
        <h1 className="text-display">UI Kit</h1>
        <p className="max-w-[62ch] text-[17px] leading-[1.6] text-ink-muted">
          W2 reference. Every primitive from{" "}
          <code className="font-mono text-[14px]">
            components/ui
          </code>{" "}
          and{" "}
          <code className="font-mono text-[14px]">components/portal</code>,
          section-by-section against{" "}
          <code className="font-mono text-[14px]">RhemaPod UI Kit.dc.html</code>.
          The token audit lives at{" "}
          <a className="text-clay-600 hover:text-clay-700" href="/tokens">
            /tokens
          </a>
          .
        </p>
      </header>

      {/* 01 — Type scale ---------------------------------------------------- */}
      <Section
        index="01"
        title="Type scale"
        blurb="Encoded as @utility classes in globals.css from the README token table (the stated source of truth). Where the UI Kit HTML disagrees, the table value is used and the HTML value is left in a code comment for this pass."
      >
        <div className="flex flex-col overflow-hidden rounded-16 border border-border bg-surface">
          {[
            ["text-display", "display · Newsreader 400 · 52/1.02/-0.025em"],
            [
              "text-page-title",
              "page-title · 32/1.12/-0.02em  (HTML: 32/1.15/-0.015em)",
            ],
            ["text-card-title", "card-title · 20/1.22/-0.01em  (table 19-22)"],
            ["text-metric", "metric · 40/1/-0.02em  (table 38-40)"],
            ["text-heading", "heading · Figtree 600 · 20/1.3/-0.015em"],
            ["text-section-title", "section-title · Figtree 600 · 15/1.4"],
            ["text-body", "body · Figtree 400 · 15/1.6"],
            ["text-body-sm", "body-sm · Figtree 400 · 14/1.55"],
            ["text-label", "label · Figtree 500 · 13/1.4 · ink-muted"],
            ["text-badge", "badge · Figtree 600 · 12.5"],
            ["text-mono-meta", "mono-meta · Plex Mono 400 · 12 · +0.06em"],
            [
              "text-mono-eyebrow",
              "mono-eyebrow · Plex Mono 400 · 10.5 · +0.12em · upper",
            ],
          ].map(([cls, label]) => (
            <div
              key={cls}
              className="grid grid-cols-[280px_1fr] items-baseline gap-20 border-b border-border-subtle px-24 py-16 last:border-b-0"
            >
              <span className="font-mono text-[11px] text-ink-faint">
                {label}
              </span>
              <span className={cls}>The weight of mercy</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 02 — Buttons ----------------------------------------------------- */}
      <Section
        index="02"
        title="Buttons"
        blurb="Heights 30 / 38 / 46, radii 8 / 10 / 12, weight 600. One primary per view. Focus ring: 2px clay-400, offset 2px."
      >
        <div className="flex flex-col gap-0 overflow-hidden rounded-16 border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-12 border-b border-border-subtle p-24">
            <Button variant="primary">Publish sermon</Button>
            <Button variant="secondary">Save draft</Button>
            <Button variant="ghost">Preview</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="disabled" disabled>
              Submit for review
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-12 p-24">
            <Button size="sm">Small · 30px</Button>
            <Button size="md">Default · 38px</Button>
            <Button size="lg">Large · 46px</Button>
            <span className="font-mono text-[11px] text-ink-faint">
              also: primary/secondary/ghost/destructive at every size
            </span>
          </div>
        </div>
      </Section>

      {/* 03 — Form controls -------------------------------------------------- */}
      <Section index="03" title="Form controls">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-24 rounded-16 border border-border bg-surface p-24">
          <label className="flex flex-col gap-[7px]">
            <span className="text-label">Sermon title · 40px default</span>
            <Input defaultValue="The Weight of Mercy" />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-label">Dense · 38px</span>
            <Input inputSize="dense" defaultValue="Panel field" />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-label">Login · 44px</span>
            <Input inputSize="login" placeholder="you@grace.chapel" />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-label">Speaker · Select</span>
            <Select defaultValue="ada">
              <option value="ada">Pastor Ada Nwosu</option>
              <option value="daniel">Rev. Daniel Okoye</option>
            </Select>
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-label">Episode number · mono</span>
            <Input defaultValue="04" className="font-mono" />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-medium text-rose">
              Slug · error state
            </span>
            <Input error defaultValue="the weight of mercy" />
            <span className="text-[12px] text-rose">
              Slugs cannot contain spaces.
            </span>
          </label>
          <label className="col-span-full flex flex-col gap-[7px]">
            <span className="text-label">Description · Textarea</span>
            <Textarea
              rows={3}
              defaultValue="A three-part look at the parable of the unforgiving servant."
            />
          </label>
          <div className="col-span-full flex flex-wrap items-center gap-20">
            <label className="flex cursor-pointer items-center gap-8 text-[14px]">
              <Checkbox defaultChecked />
              <span>Pin to top</span>
            </label>
            <label className="flex cursor-pointer items-center gap-8 text-[14px]">
              <Radio name="kittier" defaultChecked />
              <span>Free</span>
            </label>
            <label className="flex cursor-pointer items-center gap-8 text-[14px]">
              <Radio name="kittier" />
              <span>Paid</span>
            </label>
            <label className="flex items-center gap-9 text-[14px]">
              <Switch checked={notify} onCheckedChange={setNotify} />
              <span>Notify subscribers</span>
            </label>
            <label className="flex items-center gap-9 text-[14px] text-ink-muted">
              <Switch checked={downloads} onCheckedChange={setDownloads} />
              <span>Allow downloads</span>
            </label>
          </div>
          <div className="col-span-full flex flex-wrap items-center gap-8">
            <span className="text-label">Tags</span>
            {tags.map((t) => (
              <Tag
                key={t}
                onRemove={() => setTags((cur) => cur.filter((x) => x !== t))}
              >
                {t}
              </Tag>
            ))}
            <Tag
              variant="add"
              onClick={() =>
                setTags((cur) =>
                  cur.includes("grace") ? cur : [...cur, "grace"],
                )
              }
            >
              + add tag
            </Tag>
          </div>
        </div>
      </Section>

      {/* 04 — Status badges ---------------------------------------------- */}
      <Section
        index="04"
        title="Status badges"
        blurb="The leading dot's position on the pipeline rail is the non-colour cue, derived from the ordered status enum (see status-badge.tsx). Off-pipeline statuses show a hollow dot anchored where they left the pipeline."
      >
        <Card className="flex flex-col gap-18">
          <div className="flex flex-col gap-2">
            <span className="text-mono-eyebrow text-ink-faint">
              SermonStatus · draft → pending → under_review → approved → published
            </span>
            <div className="mt-8 flex flex-wrap gap-9">
              {SERMON_STATUSES.map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
            </div>
          </div>
          <div className="h-px bg-border-subtle" />
          <div className="flex flex-col gap-2">
            <span className="text-mono-eyebrow text-ink-faint">
              UploadStatus
            </span>
            <div className="mt-8 flex flex-wrap gap-9">
              {UPLOAD_STATUSES.map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
            </div>
          </div>
          <div className="h-px bg-border-subtle" />
          <div className="flex flex-wrap items-center gap-9">
            <span className="text-mono-eyebrow mr-4 text-ink-faint">
              Tier &amp; role
            </span>
            <TierChip tier="free" />
            <TierChip tier="paid" />
            <RoleChip role="viewer" />
            <RoleChip role="editor" />
            <RoleChip role="manager" />
            <RoleChip role="admin" />
          </div>
        </Card>
      </Section>

      {/* 05 — Cards & media -------------------------------------------------- */}
      <Section index="05" title="Cards & media">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-16">
          <MediaCard
            title="The Weight of Mercy"
            meta="Ada Nwosu · Ep 4 · Parables"
            caption="series art 16:9"
            duration="42:18"
          />
          <StatCard
            label="Total plays · 30d"
            value="18,402"
            delta={{ direction: "up", text: "12.4% vs. prior 30d" }}
          />
          <StatCard
            label="Past due"
            value="17"
            delta={{ direction: "down", text: "3 lapsed this week" }}
          />
          <StatCard
            label="Published sermons"
            value="96"
            delta={{ direction: "neutral", text: "of 128 total" }}
          />
          <Card className="flex flex-col gap-12 rounded-14 p-18">
            <span className="text-mono-eyebrow text-ink-faint">Empty state</span>
            <EmptyState
              title="Nothing waiting"
              description="When editors submit sermons, they land here for review."
            />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Panel card</CardTitle>
              <a className="text-[13px] text-clay-600" href="#kit">
                View all
              </a>
            </CardHeader>
            <p className="mt-12 text-body text-ink-muted">
              radius 16, 1px border, surface fill, 20px padding.
            </p>
          </Card>
        </div>
        <div className="flex flex-wrap items-end gap-16">
          <div className="flex flex-col gap-6">
            <span className="text-mono-eyebrow text-ink-faint">thumb 4/8</span>
            <MediaPlaceholder
              scale="thumb"
              className="h-[24px] w-[40px] rounded-4"
              label="list thumbnail"
            />
          </div>
          <div className="flex flex-col gap-6">
            <span className="text-mono-eyebrow text-ink-faint">card 6/12</span>
            <MediaPlaceholder
              scale="card"
              className="aspect-video w-[220px] rounded-10"
              caption="thumbnail 16:9 · 1280×720"
              duration="31:02"
            />
          </div>
          <div className="flex flex-col gap-6">
            <span className="text-mono-eyebrow text-ink-faint">hero 8/16</span>
            <MediaPlaceholder
              scale="hero"
              className="h-[160px] w-[130px] rounded-12"
              caption="brand image · 4:5"
            />
          </div>
        </div>
      </Section>

      {/* 06 — Progress ---------------------------------------------------- */}
      <Section
        index="06"
        title="Progress"
        blurb="6px track, radius 999. clay for upload, slate gradient for transcode, sage for completion metrics."
      >
        <Card className="flex flex-col gap-16">
          <div className="flex flex-col gap-6">
            <span className="text-[12.5px] text-ink-muted">
              Uploading — 64% · 1.4 GB / 2.2 GB
            </span>
            <Progress value={64} variant="upload" label="Upload progress" />
          </div>
          <div className="flex flex-col gap-6">
            <span className="text-[12.5px] text-ink-muted">
              Transcoding renditions · 1080p done, 720p running
            </span>
            <Progress value={38} variant="transcode" label="Transcode" />
          </div>
          <div className="flex flex-col gap-6">
            <span className="text-[12.5px] text-ink-muted">
              Completion rate · Anchored
            </span>
            <Progress value={78} variant="complete" label="Completion" />
          </div>
        </Card>
      </Section>

      {/* 07 — Alerts & toasts --------------------------------------------- */}
      <Section index="07" title="Alerts & toasts">
        <div className="flex flex-col gap-12">
          <Alert variant="success" title="Published to the app">
            “Anchored: Part One” is live for 1,240 subscribers.
          </Alert>
          <Alert variant="warning" title="3 sermons waiting over 48 hours">
            Editors are blocked until a manager reviews them.
          </Alert>
          <Alert variant="error" title="Transcode failed">
            youth-night.avi — unsupported container. Re-encode and retry.
          </Alert>
          <Toast message="Draft saved" timestamp="just now" onDismiss={() => {}} />
        </div>
      </Section>

      {/* 08 — Segmented / tabs / pagination ----------------------------- */}
      <Section index="08" title="Segmented control · Tabs · Pagination">
        <Panel>
          <SegmentedControl
            aria-label="Status filter"
            value={seg}
            onValueChange={setSeg}
            options={[
              { value: "all", label: "All" },
              { value: "drafts", label: "Drafts" },
              { value: "review", label: "In review" },
              { value: "published", label: "Published" },
            ]}
          />
          <span className="font-mono text-[11px] text-ink-faint">
            selected: {seg}
          </span>
        </Panel>
        <Panel>
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="access">Access</TabsTrigger>
              <TabsTrigger value="log">Approval log</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="pt-12 text-body text-ink-muted">
              Details tab content.
            </TabsContent>
            <TabsContent value="access" className="pt-12 text-body text-ink-muted">
              Access tab content.
            </TabsContent>
            <TabsContent value="log" className="pt-12 text-body text-ink-muted">
              Approval log tab content.
            </TabsContent>
          </Tabs>
        </Panel>
        <Panel>
          <Pagination page={page} pageCount={22} onPageChange={setPage} />
          <span className="font-mono text-[11px] text-ink-faint">page {page}</span>
        </Panel>
      </Section>

      {/* 09 — Avatar --------------------------------------------------------- */}
      <Section
        index="09"
        title="Avatar"
        blurb="Initials, 700 weight, tint from a deterministic name hash (clay / sage / slate / neutral). Same hash on server and client — no hydration mismatch."
      >
        <Panel>
          {["Ada Nwosu", "Daniel Okoye", "Grace Chapel", "Miriam Boateng", "T"].map(
            (n) => (
              <div key={n} className="flex flex-col items-center gap-6">
                <Avatar name={n} size={38} />
                <span className="font-mono text-[10.5px] text-ink-faint">
                  {n}
                </span>
              </div>
            ),
          )}
          <div className="mx-8 h-[38px] w-px bg-border" />
          {AVATAR_TINTS.map((t) => (
            <div key={t} className="flex flex-col items-center gap-6">
              <Avatar name="Ada Nwosu" size={38} tint={t} />
              <span className="font-mono text-[10.5px] text-ink-faint">{t}</span>
            </div>
          ))}
          <div className="mx-8 h-[38px] w-px bg-border" />
          <Avatar name="Ada Nwosu" size={24} />
          <Avatar name="Ada Nwosu" size={32} />
          <Avatar name="Ada Nwosu" size={48} />
        </Panel>
      </Section>

      {/* 10 — DataTable ------------------------------------------------------ */}
      <Section
        index="10"
        title="DataTable"
        blurb="CSS-grid rows (not <table>), 38px sunken sticky header with mono-eyebrow labels, 60px body rows. Opt-in selection: per-row checkbox, header select-all (indeterminate on a partial page), Space toggles the focused row, Shift-click / Shift-Space range-selects from the anchor. ≥1 selected swaps the 38px header for the 44px clay bulk bar. Sunken footer = rangeLabel + Pagination."
      >
        <DataTableShowcase />
      </Section>
    </main>
  );
}
