import { beforeEach, describe, expect, it, vi } from "vitest";

/* W21 — the Subscriptions route is a thin Server Component gated by
   `requireRole("manager")` (plan §W21 acceptance: "Editors 404"). This drives
   the async component directly and asserts an editor triggers `notFound()`
   while a manager / admin gets the client screen. */

const getServerUser = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("@/lib/auth/session", () => ({ getServerUser }));
vi.mock("next/navigation", () => ({ notFound }));

const { default: SubscriptionsPage } = await import(
  "@/app/(portal)/subscriptions/page"
);
const { SubscriptionsScreen } = await import(
  "@/components/subscriptions/subscriptions-screen"
);

const session = (role: string) => ({
  id: "u-1",
  email: "x@rhemapod.church",
  name: "X",
  role,
});

beforeEach(() => {
  getServerUser.mockReset();
  notFound.mockClear();
});

describe("SubscriptionsPage — requireRole('manager')", () => {
  it("404s an editor (notFound thrown, screen never returned)", async () => {
    getServerUser.mockResolvedValue(session("editor"));
    await expect(SubscriptionsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("404s an anonymous request", async () => {
    getServerUser.mockResolvedValue(null);
    await expect(SubscriptionsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders <SubscriptionsScreen> for a manager and an admin", async () => {
    getServerUser.mockResolvedValue(session("manager"));
    expect(((await SubscriptionsPage()) as { type: unknown }).type).toBe(
      SubscriptionsScreen,
    );
    expect(notFound).not.toHaveBeenCalled();

    getServerUser.mockResolvedValue(session("admin"));
    expect(((await SubscriptionsPage()) as { type: unknown }).type).toBe(
      SubscriptionsScreen,
    );
  });
});
