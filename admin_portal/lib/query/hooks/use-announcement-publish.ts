/**
 * `useAnnouncementPublish` — the Announcements editor panel's primary-button
 * workflow (W13). One button, role-dependent:
 *
 *   • Editor  → "Submit for review": save any unsaved edits, then
 *     `POST /announcements/{id}/submit` (draft | rejected → pending_review).
 *   • Manager → "Publish": save any unsaved edits, then run the SHORTEST legal
 *     path from the current status to `published` using the approval endpoints:
 *       draft | rejected     → submit → approve → publish
 *       pending_review       → approve → publish
 *       approved | archived  → publish
 *       published            → (nothing)
 *
 * Follows the W10 `use-review-actions` precedent for multi-step transitions: on
 * a failure the phase is named (`AnnouncementPublishError.phase`), a completed
 * earlier step is NOT rolled back, and the message is precise. The panel
 * renders it as a card-top `<Alert>` (design §"Errors").
 *
 * `create` / `update` are the same optimistic CRUD mutations the plain "Save"
 * button uses (`use-announcement-mutations.ts`), composed here so a Save that
 * precedes a Publish is one code path.
 *
 * CREATE mode: the new draft's id is surfaced via `onDraftReady` the instant the
 * POST lands — before the transition walk — so the screen can select the real
 * row. A retry after a mid-walk failure then resumes on that row (no second
 * `create`), and the walk skips any step it already committed this run.
 */

"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type {
  AnnouncementAdminItem,
  AnnouncementStatus,
} from "@/lib/query/hooks/use-announcements";
import {
  useCreateAnnouncement,
  useUpdateAnnouncement,
  type AnnouncementCreate,
  type AnnouncementUpdate,
} from "@/lib/query/hooks/use-announcement-mutations";

/** Who is driving the button. */
export type AnnouncementPublishTarget = "submit" | "publish";

/** Every distinct step the workflow can fail in. */
export type AnnouncementPublishPhase =
  | "create"
  | "save"
  | "submit"
  | "approve"
  | "publish";

const PHASE_VERB: Record<AnnouncementPublishPhase, string> = {
  create: "create",
  save: "save",
  submit: "submit for review",
  approve: "approve",
  publish: "publish",
};

export class AnnouncementPublishError extends Error {
  readonly phase: AnnouncementPublishPhase;
  override readonly cause: unknown;
  constructor(phase: AnnouncementPublishPhase, cause: unknown) {
    super(`announcement ${phase} phase failed`);
    this.name = "AnnouncementPublishError";
    this.phase = phase;
    this.cause = cause;
    Object.setPrototypeOf(this, AnnouncementPublishError.prototype);
  }
}

type TransitionStep = "submit" | "approve" | "publish";

/** The ordered transitions from `status` to the target end state. */
export function pathToTarget(
  status: AnnouncementStatus,
  target: AnnouncementPublishTarget,
): TransitionStep[] {
  if (target === "submit") {
    return status === "draft" || status === "rejected" ? ["submit"] : [];
  }
  switch (status) {
    case "draft":
    case "rejected":
      return ["submit", "approve", "publish"];
    case "pending_review":
      return ["approve", "publish"];
    case "approved":
    case "archived":
      return ["publish"];
    default:
      return [];
  }
}

async function transitionCall(id: string, step: TransitionStep): Promise<void> {
  if (step === "submit") {
    await api.POST("/api/v1/announcements/{announcement_id}/submit", {
      params: { path: { announcement_id: id } },
    });
    return;
  }
  if (step === "approve") {
    await api.POST("/api/v1/approvals/announcements/{announcement_id}/approve", {
      params: { path: { announcement_id: id } },
    });
    return;
  }
  await api.POST("/api/v1/approvals/announcements/{announcement_id}/publish", {
    params: { path: { announcement_id: id } },
  });
}

function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

function hasKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

export interface AnnouncementPublishInput {
  /** The saved row, or `null` when the panel is on a fresh (unsaved) draft. */
  current: AnnouncementAdminItem | null;
  /** Body for the create call (`current === null`). */
  body: AnnouncementCreate;
  /** Dirty fields for the pre-flight PATCH (`current !== null`). May be empty. */
  patch: AnnouncementUpdate;
  target: AnnouncementPublishTarget;
}

export interface UseAnnouncementPublishOptions {
  /** In CREATE mode, fired the instant the draft has been POSTed — BEFORE the
      transition walk starts. The panel uses it to hand the new row up so the
      screen selects it (`?sel=`): a retry after a mid-walk failure then resumes
      on the real row instead of minting a second draft. */
  onDraftReady?: (item: AnnouncementAdminItem) => void;
  /** A phase failed. `phase` names which; `message` is ready to render. Earlier
      committed steps are NOT undone — the message should say where it stopped. */
  onError: (phase: AnnouncementPublishPhase, message: string) => void;
  /** The whole path completed. `reachedPublished` is true when the row is now
      live (the manager "Publish" success toast trigger). `item` is the freshest
      known row (post-save; its status may lag the transitions). */
  onSuccess: (result: {
    item: AnnouncementAdminItem;
    target: AnnouncementPublishTarget;
    reachedPublished: boolean;
  }) => void;
}

export function useAnnouncementPublish(options: UseAnnouncementPublishOptions) {
  const qc = useQueryClient();
  const create = useCreateAnnouncement();
  const update = useUpdateAnnouncement();

  // How far this hook instance has already driven a given row. A retry after a
  // mid-walk failure (approve ok, publish 500) resumes from the last committed
  // step instead of replaying one the server has already applied → 409. Cleared
  // on full success; a remount (the panel re-keying onto the fresh row) drops
  // it too, and then `pathToTarget` re-derives from that row's real status.
  const progress = useRef<{ id: string; done: Set<TransitionStep> } | null>(
    null,
  );

  const mutation = useMutation<
    { item: AnnouncementAdminItem; target: AnnouncementPublishTarget; reachedPublished: boolean },
    Error,
    AnnouncementPublishInput
  >({
    mutationFn: async ({ current, body, patch, target }) => {
      let item = current;
      let created = false;

      // 1. Make sure the draft exists and holds the latest edits.
      if (!item) {
        try {
          item = await create.mutateAsync(body);
        } catch (err) {
          throw new AnnouncementPublishError("create", err);
        }
        created = true;
      } else if (hasKeys(patch)) {
        try {
          item = await update.mutateAsync({
            announcementId: item.id,
            patch,
          });
        } catch (err) {
          throw new AnnouncementPublishError("save", err);
        }
      }

      // Reuse the completed-steps set only while still working the SAME row
      // (a retry before the panel has remounted onto the fresh row). Any other
      // case starts clean.
      if (progress.current?.id !== item.id) {
        progress.current = { id: item.id, done: new Set<TransitionStep>() };
      }
      const done = progress.current.done;

      // 2. Hand the fresh draft up NOW — before walking the transitions — so the
      //    screen selects it and a retry can never mint a second draft.
      if (created) options.onDraftReady?.(item);

      // 3. Walk the approval path, skipping any step already committed in an
      //    earlier attempt. A failed step throws with its own phase; the steps
      //    that already committed stay committed.
      const steps = pathToTarget(item.status, target).filter(
        (step) => !done.has(step),
      );
      let reachedPublished =
        item.status === "published" || done.has("publish");
      for (const step of steps) {
        try {
          await transitionCall(item.id, step);
        } catch (err) {
          throw new AnnouncementPublishError(step, err);
        }
        done.add(step);
        if (step === "publish") reachedPublished = true;
      }

      progress.current = null;
      return { item, target, reachedPublished };
    },
    onError: (err) => {
      const phase =
        err instanceof AnnouncementPublishError ? err.phase : "save";
      const cause =
        err instanceof AnnouncementPublishError ? err.cause : err;
      options.onError(
        phase,
        messageFor(
          cause,
          `Couldn’t ${PHASE_VERB[phase]} this announcement.`,
        ),
      );
    },
    onSuccess: (result) => options.onSuccess(result),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements.lists() });
    },
  });

  return {
    isPending: mutation.isPending,
    run: (input: AnnouncementPublishInput) => mutation.mutate(input),
  };
}
