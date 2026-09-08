import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// happy-dom carries state between tests in a file (the document, focus,
// mounted trees). Tear every render down so `document.activeElement` and the
// DOM start clean for the next test.
afterEach(() => {
  cleanup();
});
