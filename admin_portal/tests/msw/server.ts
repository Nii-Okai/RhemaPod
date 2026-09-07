import { setupServer } from "msw/node";

// Shared MSW server for the unit suite (plan §A.11). Handlers are registered
// per-test with `server.use(...)`; `tests/setup.ts` owns listen/reset/close.
export const server = setupServer();
