import { SermonEditor } from "@/components/sermons/editor/sermon-editor";

/**
 * Sermon editor (W8) — the form half. A thin Server Component: the whole editor
 * is client-rendered (autosave, optimistic workflow, the read-only Media list
 * and its conditional poll are all `"use client"`, plan §A.4).
 *
 * Data load, the not-found state (an editor opening a sermon that isn't theirs
 * → `GET /api/v1/sermons/{id}` 404) and the skeleton all live inside
 * `<SermonEditor>`.
 */
export default async function SermonEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SermonEditor sermonId={id} />;
}
