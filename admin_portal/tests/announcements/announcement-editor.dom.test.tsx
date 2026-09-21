import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { AnnouncementEditorPanel } from "@/components/announcements/announcement-editor-panel";
import type { AnnouncementAdminItem } from "@/lib/query/hooks/use-announcements";

/* W13 — the inline editor panel. BFF calls are MSW (§A.11); the storage PUT is
   a fake XHR (same seam as the sermon/series thumbnail tests). Covers: create
   (POST), edit (PATCH), the expires>publish inline guard, the role gate on the
   primary button, the multi-step Publish path + its failure-phase report, the
   image flow (ticket → PUT → confirm, disabled until the draft exists), and
   (review-fix batch, item 8) the debounced auto-draft on title+body with no
   Save click — fake timers, same technique as
   `tests/portal/autosave-sermon.dom.test.tsx` (`fireEvent` + `vi.
   advanceTimersByTimeAsync`, never `userEvent` + fake timers together, and
   never `waitFor` under fake timers — both deadlock). */

const A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STORAGE_URL = "http://storage.test/ann/put";

class FakeXHR {
  static instances: FakeXHR[] = [];
  static get last() {
    return FakeXHR.instances[FakeXHR.instances.length - 1];
  }
  upload = { onprogress: null as null | (() => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  status = 0;
  responseText = "";
  url = "";
  open(_m: string, u: string) {
    this.url = u;
  }
  setRequestHeader() {}
  send() {
    FakeXHR.instances.push(this);
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  FakeXHR.instances = [];
  vi.unstubAllGlobals();
});
afterAll(() => server.close());
beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXHR));

const item = (over: Partial<AnnouncementAdminItem> = {}): AnnouncementAdminItem => ({
  id: A_ID,
  title: "Baptism Sunday",
  description: "Two services, one river.",
  image_url: null,
  pinned: false,
  publish_at: null,
  created_at: "2026-03-01T12:00:00Z",
  body: "Sign-up closes Friday.",
  expires_at: null,
  status: "draft",
  is_visible: false,
  created_by: "u-1",
  ...over,
});

function renderPanel(props: Partial<React.ComponentProps<typeof AnnouncementEditorPanel>> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const onCreated = props.onCreated ?? vi.fn();
  const onPrimaryDone = props.onPrimaryDone ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <AnnouncementEditorPanel
        announcement={props.announcement ?? null}
        role={props.role ?? "manager"}
        onCreated={onCreated}
        onPrimaryDone={onPrimaryDone}
      />
    </QueryClientProvider>,
  );
  return {
    ...utils,
    client,
    onCreated,
    onPrimaryDone,
    fileInput: () =>
      utils.container.querySelector('input[type="file"]') as HTMLInputElement,
    /** Re-render with a new `announcement` prop on the SAME client — what the
        real Announcements screen does after `onCreated` selects the fresh
        row (`?sel=`) and its detail lands in cache. */
    rerenderWith: (next: Partial<React.ComponentProps<typeof AnnouncementEditorPanel>>) =>
      utils.rerender(
        <QueryClientProvider client={client}>
          <AnnouncementEditorPanel
            announcement={next.announcement ?? props.announcement ?? null}
            role={next.role ?? props.role ?? "manager"}
            onCreated={next.onCreated ?? onCreated}
            onPrimaryDone={next.onPrimaryDone ?? onPrimaryDone}
          />
        </QueryClientProvider>,
      ),
  };
}

function pngFile(name = "cover.png", type = "image/png", size = 4096) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

/* --- create / edit ----------------------------------------------- */

describe("AnnouncementEditorPanel — Save", () => {
  it("create mode: POSTs a draft body and hands the new row up", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/bff/announcements", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...item({ title: "Youth camp" }) }, { status: 201 });
      }),
    );

    const { onCreated } = renderPanel({ announcement: null });

    await userEvent.type(screen.getByLabelText("Title"), "Youth camp");
    await userEvent.type(
      screen.getByLabelText("Body (markdown)"),
      "Deposits due Friday.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({
      title: "Youth camp",
      body: "Deposits due Friday.",
      pinned: false,
      publish_at: null,
      expires_at: null,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("edit mode: PATCHes only the changed fields", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.patch(`*/api/bff/announcements/${A_ID}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({ title: "Baptism Sunday — sign up" }));
      }),
    );

    renderPanel({ announcement: item() });

    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Baptism Sunday — sign up");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ title: "Baptism Sunday — sign up" });
  });

  it("Publish at / Expires at are native datetime-local pickers", () => {
    renderPanel({ announcement: item() });
    expect(screen.getByLabelText("Publish at")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByLabelText("Expires at")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  it("blocks Save when the expiry is not after the publish time (no request)", async () => {
    let patched = false;
    server.use(
      http.patch(`*/api/bff/announcements/${A_ID}`, () => {
        patched = true;
        return HttpResponse.json(item());
      }),
    );

    renderPanel({ announcement: item() });

    // datetime-local takes/gives `YYYY-MM-DDTHH:mm` (local, no zone).
    fireEvent.change(screen.getByLabelText("Publish at"), {
      target: { value: "2026-09-10T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Expires at"), {
      target: { value: "2026-09-08T09:00" },
    });

    expect(
      await screen.findByText("The expiry must be after the publish time."),
    ).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(patched).toBe(false);
  });

  it("sends the picked publish/expiry as ISO on the wire", async () => {
    let publishAt: unknown = "__unset__";
    server.use(
      http.patch(`*/api/bff/announcements/${A_ID}`, async ({ request }) => {
        const sent = (await request.json()) as Record<string, unknown>;
        publishAt = sent.publish_at;
        return HttpResponse.json(item());
      }),
    );

    renderPanel({ announcement: item() });

    fireEvent.change(screen.getByLabelText("Publish at"), {
      target: { value: "2026-09-10T09:00" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(publishAt).not.toBe("__unset__"));
    expect(typeof publishAt).toBe("string");
    const iso = publishAt as string;
    // A fully-qualified instant (ends in Z), and the same wall-clock the picker
    // showed once read back in the local zone.
    expect(iso).toMatch(/Z$/);
    const d = new Date(iso);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });
});

/* --- auto-draft on title+body (review-fix batch, item 8) --------- */

describe("AnnouncementEditorPanel — auto-draft (debounced, no Save click)", () => {
  afterEach(() => vi.useRealTimers());

  it("fires a create once title AND body are both non-empty, 2s after the last change — no Save click", async () => {
    vi.useFakeTimers();
    let createCount = 0;
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/bff/announcements", async ({ request }) => {
        createCount += 1;
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({ title: "Youth camp" }), {
          status: 201,
        });
      }),
    );

    const { onCreated } = renderPanel({ announcement: null });

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Youth camp" },
    });
    fireEvent.change(screen.getByLabelText("Body (markdown)"), {
      target: { value: "Deposits due Friday." },
    });

    expect(createCount).toBe(0); // still inside the debounce

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(createCount).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(createCount).toBe(1);
    expect(body).toMatchObject({
      title: "Youth camp",
      body: "Deposits due Friday.",
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("title alone does not create — AnnouncementCreate.body is required, unlike SermonCreate", async () => {
    vi.useFakeTimers();
    let createCount = 0;
    server.use(
      http.post("*/api/bff/announcements", async () => {
        createCount += 1;
        return HttpResponse.json(item(), { status: 201 });
      }),
    );

    renderPanel({ announcement: null });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Youth camp" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(createCount).toBe(0);
  });

  it("an empty (title-less) editor never fires a create", async () => {
    vi.useFakeTimers();
    let createCount = 0;
    server.use(
      http.post("*/api/bff/announcements", async () => {
        createCount += 1;
        return HttpResponse.json(item(), { status: 201 });
      }),
    );

    renderPanel({ announcement: null });
    fireEvent.change(screen.getByLabelText("Body (markdown)"), {
      target: { value: "Deposits due Friday." },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(createCount).toBe(0);
  });

  it("the image slot enables once the debounced create resolves and the screen re-selects the row", async () => {
    vi.useFakeTimers();
    server.use(
      http.post("*/api/bff/announcements", async ({ request }) => {
        const sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { ...item(), ...sent, image_url: null },
          { status: 201 },
        );
      }),
    );

    const createdRows: AnnouncementAdminItem[] = [];
    const { rerenderWith } = renderPanel({
      announcement: null,
      onCreated: (row) => createdRows.push(row),
    });

    const addImage = screen.getByRole("button", { name: "Add image" });
    expect(addImage).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Youth camp" },
    });
    fireEvent.change(screen.getByLabelText("Body (markdown)"), {
      target: { value: "Deposits due Friday." },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(createdRows).toHaveLength(1);
    const created = createdRows[0]!;

    // What the real screen does next: select the row, its detail lands in
    // props as `announcement`.
    rerenderWith({ announcement: created });

    expect(
      screen.getByRole("button", { name: "Add image" }),
    ).toBeEnabled();
  });
});

/* --- role gate --------------------------------------------------- */

describe("AnnouncementEditorPanel — primary button role gate", () => {
  it("an editor sees 'Submit for review'; a manager sees 'Publish'", () => {
    const { unmount } = renderPanel({ announcement: item(), role: "editor" });
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    unmount();

    renderPanel({ announcement: item(), role: "manager" });
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).toBeNull();
  });
});

/* --- multi-step publish --------------------------------------- */

describe("AnnouncementEditorPanel — manager Publish walks the shortest path", () => {
  it("draft → submit → approve → publish, in order", async () => {
    const calls: string[] = [];
    server.use(
      http.post(`*/api/bff/announcements/${A_ID}/submit`, () => {
        calls.push("submit");
        return HttpResponse.json({ id: A_ID, status: "pending_review" });
      }),
      http.post(`*/api/bff/approvals/announcements/${A_ID}/approve`, () => {
        calls.push("approve");
        return HttpResponse.json({ id: A_ID, status: "approved" });
      }),
      http.post(`*/api/bff/approvals/announcements/${A_ID}/publish`, () => {
        calls.push("publish");
        return HttpResponse.json({ id: A_ID, status: "published" });
      }),
    );

    const { onPrimaryDone } = renderPanel({
      announcement: item({ status: "draft" }),
      role: "manager",
    });

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(calls).toEqual(["submit", "approve", "publish"]),
    );
    await waitFor(() =>
      expect(onPrimaryDone).toHaveBeenCalledWith({
        target: "publish",
        reachedPublished: true,
      }),
    );
  });

  it("names the failing phase and does NOT roll back the completed step", async () => {
    const calls: string[] = [];
    server.use(
      http.post(`*/api/bff/announcements/${A_ID}/submit`, () => {
        calls.push("submit");
        return HttpResponse.json({ id: A_ID, status: "pending_review" });
      }),
      http.post(`*/api/bff/approvals/announcements/${A_ID}/approve`, async () => {
        calls.push("approve");
        await delay(10);
        return HttpResponse.json(
          { detail: "Reviewer conflict", correlation_id: "cid-7" },
          { status: 409 },
        );
      }),
      http.post(`*/api/bff/approvals/announcements/${A_ID}/publish`, () => {
        calls.push("publish");
        return HttpResponse.json({ id: A_ID, status: "published" });
      }),
    );

    renderPanel({ announcement: item({ status: "draft" }), role: "manager" });
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    const alert = await screen.findByText(/Reviewer conflict/);
    expect(alert).toHaveTextContent(/“approve” step/);
    // submit committed, approve failed, publish never attempted
    expect(calls).toEqual(["submit", "approve"]);
  });
});

/* --- create-mode publish: no orphan drafts ------------------------ */

describe("AnnouncementEditorPanel — create-mode Publish surfaces the draft first", () => {
  const publishHandlers = (events: string[]) => [
    http.post("*/api/bff/announcements", async ({ request }) => {
      events.push("create");
      const sent = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...item(), ...sent }, { status: 201 });
    }),
    http.post(`*/api/bff/announcements/${A_ID}/submit`, () => {
      events.push("submit");
      return HttpResponse.json({ id: A_ID, status: "pending_review" });
    }),
    http.post(`*/api/bff/approvals/announcements/${A_ID}/approve`, () => {
      events.push("approve");
      return HttpResponse.json({ id: A_ID, status: "approved" });
    }),
    http.post(`*/api/bff/approvals/announcements/${A_ID}/publish`, () => {
      events.push("publish");
      return HttpResponse.json({ id: A_ID, status: "published" });
    }),
  ];

  it("selects the created row (onCreated) BEFORE walking the transitions", async () => {
    const events: string[] = [];
    server.use(...publishHandlers(events));

    const onCreated = vi.fn((row: AnnouncementAdminItem) =>
      events.push(`select:${row.id}`),
    );
    const { onPrimaryDone } = renderPanel({
      announcement: null,
      role: "manager",
      onCreated,
    });

    await userEvent.type(screen.getByLabelText("Title"), "Youth camp");
    await userEvent.type(
      screen.getByLabelText("Body (markdown)"),
      "Deposits due Friday.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(onPrimaryDone).toHaveBeenCalledWith({
        target: "publish",
        reachedPublished: true,
      }),
    );
    expect(events).toEqual([
      "create",
      `select:${A_ID}`,
      "submit",
      "approve",
      "publish",
    ]);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("a retry after a mid-walk 500 resumes on the draft — ONE POST /announcements, no replayed submit", async () => {
    const events: string[] = [];
    let createCount = 0;
    let submitCount = 0;
    let approveAttempts = 0;
    server.use(
      http.post("*/api/bff/announcements", async ({ request }) => {
        createCount += 1;
        const sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...item(), ...sent }, { status: 201 });
      }),
      http.post(`*/api/bff/announcements/${A_ID}/submit`, () => {
        submitCount += 1;
        return HttpResponse.json({ id: A_ID, status: "pending_review" });
      }),
      http.post(
        `*/api/bff/approvals/announcements/${A_ID}/approve`,
        async () => {
          approveAttempts += 1;
          if (approveAttempts === 1) {
            await delay(10);
            return HttpResponse.json(
              { detail: "Upstream boom" },
              { status: 500 },
            );
          }
          return HttpResponse.json({ id: A_ID, status: "approved" });
        },
      ),
      http.post(`*/api/bff/approvals/announcements/${A_ID}/publish`, () => {
        events.push("publish");
        return HttpResponse.json({ id: A_ID, status: "published" });
      }),
    );

    const { onPrimaryDone } = renderPanel({
      announcement: null,
      role: "manager",
    });

    await userEvent.type(screen.getByLabelText("Title"), "Youth camp");
    await userEvent.type(
      screen.getByLabelText("Body (markdown)"),
      "Deposits due Friday.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    // Walk stops at approve.
    expect(await screen.findByText(/Upstream boom/)).toBeInTheDocument();
    expect(createCount).toBe(1);
    expect(submitCount).toBe(1);

    // Retry — button is back to "Publish".
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(onPrimaryDone).toHaveBeenCalledWith({
        target: "publish",
        reachedPublished: true,
      }),
    );

    // No second draft; submit not replayed on the already-submitted row.
    expect(createCount).toBe(1);
    expect(submitCount).toBe(1);
    expect(approveAttempts).toBe(2);
    expect(events).toEqual(["publish"]);
  });
});

/* --- image flow ------------------------------------------------ */

describe("AnnouncementEditorPanel — image", () => {
  it("is disabled on a fresh (unsaved) draft, with a hint", () => {
    renderPanel({ announcement: null });
    const btn = screen.getByRole("button", { name: "Add image" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Save the announcement before adding an image",
    );
  });

  it("edit mode: ticket → PUT → confirm swaps the image in", async () => {
    let confirmKey = "";
    server.use(
      http.post(`*/api/bff/announcements/${A_ID}/image-url`, () =>
        HttpResponse.json(
          {
            upload_url: STORAGE_URL,
            headers: { "Content-Type": "image/png" },
            expires_in: 3600,
            thumbnail_key: `thumbnails/announcements/${A_ID}/img.png`,
          },
          { status: 201 },
        ),
      ),
      http.post(
        `*/api/bff/announcements/${A_ID}/image/confirm`,
        ({ request }) => {
          confirmKey = new URL(request.url).searchParams.get("thumbnail_key")!;
          return HttpResponse.json({
            thumbnail_url: "http://storage.test/ann/img.png",
          });
        },
      ),
    );

    const { fileInput } = renderPanel({ announcement: item() });

    await userEvent.upload(fileInput(), pngFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    expect(FakeXHR.last.url).toBe(STORAGE_URL);
    FakeXHR.last.respond(200);

    const img = await screen.findByAltText("Image for Baptism Sunday");
    expect(img).toHaveAttribute("src", "http://storage.test/ann/img.png");
    expect(confirmKey).toBe(`thumbnails/announcements/${A_ID}/img.png`);
  });

  it("surfaces a confirm failure", async () => {
    server.use(
      http.post(`*/api/bff/announcements/${A_ID}/image-url`, () =>
        HttpResponse.json(
          {
            upload_url: STORAGE_URL,
            headers: { "Content-Type": "image/png" },
            expires_in: 3600,
            thumbnail_key: `thumbnails/announcements/${A_ID}/img.png`,
          },
          { status: 201 },
        ),
      ),
      http.post(`*/api/bff/announcements/${A_ID}/image/confirm`, () =>
        HttpResponse.json(
          { detail: "No uploaded image found — complete the PUT first" },
          { status: 409 },
        ),
      ),
    );

    const { fileInput } = renderPanel({ announcement: item() });
    await userEvent.upload(fileInput(), pngFile());
    await waitFor(() => expect(FakeXHR.last).toBeDefined());
    FakeXHR.last.respond(200);

    expect(
      await screen.findByText(/No uploaded image found/),
    ).toBeInTheDocument();
  });
});
