"use client";

import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditorField } from "@/components/sermons/editor/field";
import { MediaPlaceholder } from "@/components/portal/media-placeholder";
import { StatusBadge } from "@/components/portal/status-badge";
import {
  announcementBadgeLabel,
  toBadgeStatus,
} from "@/components/announcements/announcement-status";
import {
  formatLocalDateTime,
  parseLocalDateTime,
} from "@/components/announcements/datetime";
import { isApiError } from "@/lib/api/errors";
import { IMAGE_ACCEPT_ATTR } from "@/lib/upload";
import type { AnnouncementAdminItem } from "@/lib/query/hooks/use-announcements";
import {
  useCreateAnnouncement,
  useUpdateAnnouncement,
  type AnnouncementUpdate,
} from "@/lib/query/hooks/use-announcement-mutations";
import { useAnnouncementImageUpload } from "@/lib/query/hooks/use-announcement-image-upload";
import {
  useAnnouncementPublish,
  type AnnouncementPublishTarget,
  pathToTarget,
} from "@/lib/query/hooks/use-announcement-publish";

/* =============================================================================
   AnnouncementEditorPanel — the right column of the Announcements screen
   (design Screen 8, plan W13).

   ONE inline panel, not a route (the `.dc.html` and README §8 both lay the
   screen out as `1.4fr 1fr` — list left, editor right; the plan's prose sketch
   of `/announcements/new` + `/[id]` routes is the odd one out → logged
   `[GATE 3 Batch 5]`).

   Fields: title, image (ticket → PUT → confirm; disabled until the draft
   exists), short description (→ `description`, 500 max), markdown body (plain
   Textarea — there is no shared markdown input/preview component in the tree),
   publish/expiry as mono `YYYY-MM-DD HH:mm` local, pin toggle.

   Save  = POST (create) / PATCH (update); stays draft.
   Primary = "Submit for review" (editor) or "Publish" (manager) — the latter
   runs the shortest legal path to `published` (`useAnnouncementPublish`).

   `expires_at > publish_at` is checked inline before submit, matching the
   server validator, so it never surfaces as a 422. Request failures render as
   a card-top `<Alert>`, never a toast (design §"Errors").
   ========================================================================== */

const DESCRIPTION_MAX = 500;

interface FormState {
  title: string;
  description: string;
  body: string;
  publishAt: string;
  expiresAt: string;
  pinned: boolean;
}

function stateFrom(a: AnnouncementAdminItem | null): FormState {
  return {
    title: a?.title ?? "",
    description: a?.description ?? "",
    body: a?.body ?? "",
    publishAt: formatLocalDateTime(a?.publish_at ?? null),
    expiresAt: formatLocalDateTime(a?.expires_at ?? null),
    pinned: a?.pinned ?? false,
  };
}

function errorMessage(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return err instanceof Error ? err.message : fallback;
}

export interface AnnouncementEditorPanelProps {
  announcement: AnnouncementAdminItem | null;
  role: string;
  /** After a create — hand the new row up so the screen can select it. */
  onCreated: (item: AnnouncementAdminItem) => void;
  /** After the primary action fully lands. `reachedPublished` drives the
      "Published to the app feed" toast. */
  onPrimaryDone: (result: {
    target: AnnouncementPublishTarget;
    reachedPublished: boolean;
  }) => void;
}

export function AnnouncementEditorPanel({
  announcement,
  role,
  onCreated,
  onPrimaryDone,
}: AnnouncementEditorPanelProps) {
  const isManager = role === "manager" || role === "admin";
  const mode: "create" | "edit" = announcement ? "edit" : "create";
  const status = announcement?.status ?? "draft";
  const target: AnnouncementPublishTarget = isManager ? "publish" : "submit";

  // Editors may only touch their own draft/rejected work (`_load_editable`
  // 409s otherwise); managers can edit any status.
  const locked =
    mode === "edit" &&
    !isManager &&
    status !== "draft" &&
    status !== "rejected";

  const initial = React.useMemo(
    () => stateFrom(announcement),
    [announcement],
  );
  const [form, setForm] = React.useState<FormState>(initial);
  const [baseline, setBaseline] = React.useState<FormState>(initial);
  // A different row (or a fresh → saved transition) remounts this panel via the
  // screen's `key={selected?.id ?? "new"}`, so `useState(initial)` re-seeds on
  // its own — no in-render reseed needed.

  // The row this panel created during the current session, before the screen's
  // selection/refetch has remounted us onto it. Lets a retry after a mid-walk
  // publish failure resume on the real draft instead of POSTing a second one.
  const [createdRow, setCreatedRow] =
    React.useState<AnnouncementAdminItem | null>(null);

  const [titleTouched, setTitleTouched] = React.useState(false);
  const [bodyTouched, setBodyTouched] = React.useState(false);
  const [alert, setAlert] = React.useState<string | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();
  const image = useAnnouncementImageUpload({
    announcementId: announcement?.id,
  });
  const publish = useAnnouncementPublish({
    onDraftReady: (item) => {
      setCreatedRow(item);
      setBaseline(stateFrom(item));
      // Select the real row now — before the walk — so a retry resumes on it.
      onCreated(item);
    },
    onError: (phase, message) =>
      setAlert(
        phase === "save" || phase === "create"
          ? message
          : `${message} It stopped at the “${phase}” step — earlier steps were kept.`,
      ),
    onSuccess: ({ target: t, reachedPublished }) => {
      setAlert(null);
      onPrimaryDone({ target: t, reachedPublished });
    },
  });

  const busy =
    create.isPending || update.isPending || publish.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /* --- validation ---------------------------------------------------- */

  const titleError =
    (titleTouched || mode === "edit") && form.title.trim() === ""
      ? "A title is required."
      : null;
  const bodyError =
    (bodyTouched || mode === "edit") && form.body.trim() === ""
      ? "A body is required."
      : null;

  const parsedPublish = parseLocalDateTime(form.publishAt);
  const parsedExpires = parseLocalDateTime(form.expiresAt);
  const publishAtError = !parsedPublish.ok
    ? "Use the format YYYY-MM-DD HH:mm."
    : null;
  const expiresAtError = !parsedExpires.ok
    ? "Use the format YYYY-MM-DD HH:mm."
    : parsedPublish.ok &&
        parsedExpires.ok &&
        parsedPublish.iso &&
        parsedExpires.iso &&
        Date.parse(parsedExpires.iso) <= Date.parse(parsedPublish.iso)
      ? "The expiry must be after the publish time."
      : null;

  const hasBlockingError = Boolean(
    titleError || bodyError || publishAtError || expiresAtError,
  );

  /* --- dirty + payloads -------------------------------------------- */

  // `dirty` and `buildPatch` must agree on what "changed" means, or a
  // whitespace-only edit to a trimmed field leaves the form permanently dirty
  // and fires a no-op PATCH. Both trim `title` / `description`; `body` is
  // markdown, compared verbatim on both sides.
  const dirty =
    form.title.trim() !== baseline.title.trim() ||
    form.description.trim() !== baseline.description.trim() ||
    form.body !== baseline.body ||
    form.publishAt !== baseline.publishAt ||
    form.expiresAt !== baseline.expiresAt ||
    form.pinned !== baseline.pinned;

  const buildPatch = (): AnnouncementUpdate => {
    const patch: AnnouncementUpdate = {};
    if (form.title.trim() !== baseline.title.trim()) {
      patch.title = form.title.trim();
    }
    if (form.description.trim() !== baseline.description.trim()) {
      patch.description = form.description.trim() || null;
    }
    if (form.body !== baseline.body) patch.body = form.body;
    if (form.pinned !== baseline.pinned) patch.pinned = form.pinned;
    if (form.publishAt !== baseline.publishAt && parsedPublish.ok) {
      patch.publish_at = parsedPublish.iso;
    }
    if (form.expiresAt !== baseline.expiresAt && parsedExpires.ok) {
      patch.expires_at = parsedExpires.iso;
    }
    return patch;
  };

  const buildCreateBody = () => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    body: form.body,
    pinned: form.pinned,
    publish_at: parsedPublish.ok ? parsedPublish.iso : null,
    expires_at: parsedExpires.ok ? parsedExpires.iso : null,
  });

  /* --- actions ---------------------------------------------------- */

  const guard = (): boolean => {
    setTitleTouched(true);
    setBodyTouched(true);
    if (hasBlockingError) return false;
    setAlert(null);
    return true;
  };

  // The saved row this panel is working, whether it arrived as a prop or was
  // just minted here (create walk / a prior Save) and not yet remounted onto.
  const savedRow = announcement ?? createdRow;

  const handleSave = () => {
    if (!guard()) return;
    if (!savedRow) {
      create.mutate(buildCreateBody(), {
        onSuccess: (item) => {
          setCreatedRow(item);
          setBaseline(stateFrom(item));
          onCreated(item);
        },
        onError: (err) =>
          setAlert(errorMessage(err, "Couldn’t create the announcement.")),
      });
      return;
    }
    if (!dirty) return;
    update.mutate(
      { announcementId: savedRow.id, patch: buildPatch() },
      {
        onSuccess: (item) => {
          // Keep the local ref fresh too, for the pre-remount window after a
          // create walk left us on this row.
          if (!announcement) setCreatedRow(item);
          setBaseline(stateFrom(item));
        },
        onError: (err) =>
          setAlert(errorMessage(err, "Couldn’t save the announcement.")),
      },
    );
  };

  const handlePrimary = () => {
    if (!guard()) return;
    publish.run({
      current: savedRow,
      body: buildCreateBody(),
      patch: savedRow ? buildPatch() : {},
      target,
    });
  };

  const handlePickImage = () => imageInputRef.current?.click();

  /* --- render --------------------------------------------------------- */

  const shownImage = image.uploadedUrl ?? announcement?.image_url ?? null;
  const canReplaceImage = mode === "edit" && !locked && !image.isPending;

  const primaryLabel = isManager ? "Publish" : "Submit for review";
  const canAdvance =
    mode === "create" || pathToTarget(status, target).length > 0;
  const primaryDisabled =
    busy ||
    locked ||
    hasBlockingError ||
    !canAdvance ||
    (mode === "create" && form.title.trim() === "");
  const saveDisabled =
    busy ||
    locked ||
    hasBlockingError ||
    (savedRow ? !dirty : form.title.trim() === "");

  return (
    <Card className="flex flex-col gap-14 p-20">
      <CardHeader>
        <CardTitle>
          {mode === "create" ? "New announcement" : "Edit announcement"}
        </CardTitle>
        {mode === "edit" && announcement ? (
          <StatusBadge
            status={toBadgeStatus(announcement.status)}
            label={announcementBadgeLabel(announcement.status)}
          />
        ) : null}
      </CardHeader>

      {locked ? (
        <Alert variant="warning" title="This announcement is in review">
          It’s past the draft stage — a manager can make changes now.
        </Alert>
      ) : null}

      {alert ? (
        <Alert variant="error" title="That didn’t go through">
          <span className="flex items-center gap-10">
            <span>{alert}</span>
            <button
              type="button"
              onClick={() => setAlert(null)}
              className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
            >
              Dismiss
            </button>
          </span>
        </Alert>
      ) : null}

      <form
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        noValidate
      >
        <EditorField label="Title" htmlFor="announcement-title" error={titleError}>
          <Input
            id="announcement-title"
            value={form.title}
            error={Boolean(titleError)}
            disabled={locked}
            onChange={(e) => set("title", e.target.value)}
            onBlur={() => setTitleTouched(true)}
            placeholder="e.g. Baptism Sunday — sign up"
          />
        </EditorField>

        {/* Image slot — 16:9, disabled until the draft exists. */}
        <div className="flex flex-col gap-7">
          <span className="text-[13px] font-medium text-ink-muted">Image</span>
          {shownImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownImage}
              alt={`Image for ${form.title || "this announcement"}`}
              className="aspect-video w-full rounded-10 border border-border object-cover"
            />
          ) : (
            <MediaPlaceholder
              scale="card"
              caption="announcement image 16:9"
              className="aspect-video rounded-10 border border-border"
            />
          )}

          {image.errorMessage ? (
            <Alert variant="error" title="Couldn’t attach the image">
              <span className="flex items-center gap-10">
                <span>{image.errorMessage}</span>
                <button
                  type="button"
                  onClick={image.reset}
                  className="shrink-0 font-semibold text-clay-600 underline underline-offset-2 outline-none hover:text-clay-700 focus-visible:focus-ring-button"
                >
                  Dismiss
                </button>
              </span>
            </Alert>
          ) : null}

          <input
            ref={imageInputRef}
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) image.replace(file);
            }}
          />
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canReplaceImage}
              onClick={handlePickImage}
              title={
                mode === "create"
                  ? "Save the announcement before adding an image"
                  : locked
                    ? "Locked while the announcement is in review"
                    : undefined
              }
            >
              {image.isPending
                ? "Uploading…"
                : shownImage
                  ? "Replace image"
                  : "Add image"}
            </Button>
          </div>
        </div>

        <EditorField
          label="Short description (list card)"
          htmlFor="announcement-description"
          hint={`${form.description.length}/${DESCRIPTION_MAX}`}
        >
          <Input
            id="announcement-description"
            value={form.description}
            maxLength={DESCRIPTION_MAX}
            disabled={locked}
            onChange={(e) => set("description", e.target.value)}
            placeholder="One line shown on the app’s announcement card."
          />
        </EditorField>

        <EditorField
          label="Body (markdown)"
          htmlFor="announcement-body"
          error={bodyError}
        >
          <Textarea
            id="announcement-body"
            rows={4}
            value={form.body}
            error={Boolean(bodyError)}
            disabled={locked}
            onChange={(e) => set("body", e.target.value)}
            onBlur={() => setBodyTouched(true)}
            placeholder="Markdown. Links and lists render in the app."
          />
        </EditorField>

        <div className="grid grid-cols-2 gap-12">
          <EditorField
            label="Publish at"
            htmlFor="announcement-publish-at"
            error={publishAtError}
          >
            <Input
              id="announcement-publish-at"
              className="font-mono text-[13.5px]"
              value={form.publishAt}
              error={Boolean(publishAtError)}
              disabled={locked}
              onChange={(e) => set("publishAt", e.target.value)}
              placeholder="YYYY-MM-DD HH:mm"
            />
          </EditorField>
          <EditorField
            label="Expires at"
            htmlFor="announcement-expires-at"
            error={expiresAtError}
          >
            <Input
              id="announcement-expires-at"
              className="font-mono text-[13.5px]"
              value={form.expiresAt}
              error={Boolean(expiresAtError)}
              disabled={locked}
              onChange={(e) => set("expiresAt", e.target.value)}
              placeholder="YYYY-MM-DD HH:mm"
            />
          </EditorField>
        </div>

        <label className="flex cursor-pointer items-center gap-8 text-[14px] text-ink">
          <Checkbox
            checked={form.pinned}
            disabled={locked}
            onChange={(e) => set("pinned", e.target.checked)}
          />
          <span>Pin to top of the app feed</span>
        </label>

        <div className="flex gap-9 pt-2">
          <Button
            type="submit"
            size="md"
            variant="secondary"
            disabled={saveDisabled}
          >
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="md"
            disabled={primaryDisabled}
            onClick={handlePrimary}
            title={
              locked
                ? "Locked while the announcement is in review"
                : !canAdvance
                  ? isManager
                    ? "This announcement is already published"
                    : "This announcement is already in review"
                  : undefined
            }
          >
            {publish.isPending ? "Working…" : primaryLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
