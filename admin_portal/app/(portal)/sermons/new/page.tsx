import { SermonEditor } from "@/components/sermons/editor/sermon-editor";

/**
 * New sermon (W8) — the same editor form with no id yet. The first autosave
 * does `POST /api/v1/sermons`, then the editor switches to patch-mode against
 * the new id and updates the URL to `/sermons/{id}` via `history.replaceState`
 * (no remount → focus and form state survive).
 */
export default function NewSermonPage() {
  return <SermonEditor />;
}
