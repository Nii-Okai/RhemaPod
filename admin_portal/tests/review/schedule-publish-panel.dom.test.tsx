import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SchedulePublishPanel } from "@/components/review/schedule-publish-panel";

/* Round 2 (scheduled sermon publish) — the inline datetime-local panel the
   review card swaps in for "scheduling" mode. Covers: the confirm label per
   `variant`, the future-only Confirm gate (disabled + inline hint on a blank
   or past value), `onConfirm` firing with the parsed ISO exactly once, and
   Cancel. `now` is injected so "future" is deterministic. */

const NOW = Date.parse("2026-09-21T12:00:00Z");

function Harness({
  variant = "approve" as "approve" | "publish",
  onConfirm = vi.fn(),
  onCancel = vi.fn(),
  busy = false,
}: {
  variant?: "approve" | "publish";
  onConfirm?: (iso: string) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [value, setValue] = React.useState("");
  return (
    <SchedulePublishPanel
      variant={variant}
      value={value}
      onChange={setValue}
      onConfirm={onConfirm}
      onCancel={onCancel}
      busy={busy}
      now={NOW}
    />
  );
}

describe("SchedulePublishPanel", () => {
  it("labels Confirm 'Approve & schedule' for variant=approve, 'Schedule' for variant=publish", () => {
    const { rerender } = render(<Harness variant="approve" />);
    expect(
      screen.getByRole("button", { name: "Approve & schedule" }),
    ).toBeInTheDocument();

    rerender(<Harness variant="publish" />);
    expect(
      screen.getByRole("button", { name: "Schedule" }),
    ).toBeInTheDocument();
  });

  it("Confirm is disabled with an inline hint while the field is blank", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Approve & schedule" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Pick a time in the future/),
    ).toBeInTheDocument();
  });

  it("a past datetime keeps Confirm disabled with the hint", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText("Publish at");
    await user.clear(input);
    await user.type(input, "2026-09-21T11:00");

    expect(
      screen.getByRole("button", { name: "Approve & schedule" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Pick a time in the future/),
    ).toBeInTheDocument();
  });

  it("a future datetime enables Confirm and clears the hint; clicking it fires onConfirm once with the parsed ISO", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} />);

    const input = screen.getByLabelText("Publish at");
    await user.clear(input);
    await user.type(input, "2026-09-22T09:00");

    const confirm = screen.getByRole("button", {
      name: "Approve & schedule",
    });
    expect(confirm).toBeEnabled();
    expect(
      screen.queryByText(/Pick a time in the future/),
    ).not.toBeInTheDocument();

    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      new Date(2026, 8, 22, 9, 0).toISOString(),
    );
  });

  it("Cancel fires onCancel; while busy, both Confirm and Cancel are disabled", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Harness onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<Harness onCancel={onCancel} busy />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Approve & schedule" }),
    ).toBeDisabled();
  });
});
