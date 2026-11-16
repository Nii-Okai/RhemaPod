import { CommentsScreen } from "@/components/comments/comments-screen";

/**
 * Comments moderation queue (S12). Open to every staff role: an Editor gets a
 * read-only view of comments on their own sermons (server-scoped, ADR-0004), so
 * there is no `requireRole` here. Hide / restore / dismiss / delete are gated
 * in the UI cosmetically; FastAPI's role guards are the real enforcement.
 */
export default function CommentsPage() {
  return <CommentsScreen />;
}
