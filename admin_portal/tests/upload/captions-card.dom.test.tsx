import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { server } from "../msw/server";
import { CaptionsCard } from "@/components/sermons/editor/captions-card";
import type { Caption, CaptionList } from "@/lib/query/hooks/use-sermon-captions";

const SERMON_ID = "11111111-1111-1111-1111-111111111111";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function caption(over: Partial<Caption> = {}): Caption {
  return {
    language: "en",
    status: "ready",
    source: "generated",
    error_message: null,
    updated_at: "2026-11-09T10:00:00Z",
    ...over,
  };
}

function serve(list: CaptionList) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  server.use(
    http.get(`*/api/bff/sermons/${SERMON_ID}/captions`, () => HttpResponse.json(list)),
    http.put(`*/api/bff/sermons/${SERMON_ID}/captions/:lang`, async ({ request, params }) => {
      const body = await request.json();
      calls.push({ method: "PUT", url: String(params.lang), body });
      return HttpResponse.json(caption({ language: String(params.lang), source: "uploaded" }));
    }),
    http.post(
      `*/api/bff/sermons/${SERMON_ID}/captions/:lang/regenerate`,
      ({ params }) => {
        calls.push({ method: "POST", url: String(params.lang) });
        return HttpResponse.json(
          caption({ language: String(params.lang), status: "pending", source: "translated" }),
        );
      },
    ),
  );
  return calls;
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CaptionsCard sermonId={SERMON_ID} />
    </QueryClientProvider>,
  );
}

describe("Captions card", () => {
  it("explains captions come later when there is no processed video", async () => {
    serve({ available: false, default_language: "en", captions: [] });
    renderCard();
    expect(await screen.findByText(/added automatically a few minutes/)).toBeTruthy();
  });

  it("shows each language's status and source", async () => {
    serve({
      available: true,
      default_language: "en",
      captions: [
        caption(),
        caption({ language: "fr", status: "generating", source: "translated" }),
      ],
    });
    const { container } = renderCard();
    await screen.findByText("English");
    const en = container.querySelector('[data-language="en"]') as HTMLElement;
    const fr = container.querySelector('[data-language="fr"]') as HTMLElement;
    expect(within(en).getByText("Ready")).toBeTruthy();
    expect(within(en).getByText(/Generated from the audio/)).toBeTruthy();
    expect(within(fr).getByText("Generating")).toBeTruthy();
    expect(within(fr).getByText(/Translated from English/)).toBeTruthy();
  });

  it("uploads a .vtt for the chosen language", async () => {
    const calls = serve({
      available: true,
      default_language: "en",
      captions: [caption(), caption({ language: "fr", source: "translated" })],
    });
    const user = userEvent.setup();
    const { container } = renderCard();
    await user.click(await screen.findByRole("button", { name: "Upload French captions" }));
    const input = container.querySelector('[data-testid="caption-file-input"]') as HTMLInputElement;
    const file = new File(["WEBVTT\n\n00:00.000 --> 00:01.000\nBonjour\n"], "fr.vtt", {
      type: "text/vtt",
    });
    await user.upload(input, file);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "PUT", url: "fr" });
    expect((calls[0].body as { vtt: string }).vtt).toContain("Bonjour");
  });

  it("retries a failed track", async () => {
    const calls = serve({
      available: true,
      default_language: "en",
      captions: [
        caption(),
        caption({
          language: "fr",
          status: "error",
          source: "translated",
          error_message: "Workers AI returned 503",
        }),
      ],
    });
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByText("Workers AI returned 503")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Retry French captions automatically" }),
    );
    await waitFor(() => expect(calls).toEqual([{ method: "POST", url: "fr" }]));
  });
});
