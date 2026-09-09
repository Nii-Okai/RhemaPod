import { PeopleScreen } from "@/components/people/people-screen";

/**
 * Speakers & categories (design Screen 7, plan W12).
 *
 * A thin Server Component: the speaker rows, the category pills, every
 * per-entity sermon-count probe and every mutation are client-rendered React
 * Query (plan §A.4), so this just mounts the screen.
 */
export default function PeoplePage() {
  return <PeopleScreen />;
}
