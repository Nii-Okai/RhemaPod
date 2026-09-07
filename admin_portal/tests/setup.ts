import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw/server";

// Any request without a matching handler is a test bug (a wrong URL, a missed
// prefix rewrite) — fail loud rather than hit the network.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
