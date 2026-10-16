import { describe, expect, test } from "bun:test";
import { evidenceState, settlementPreview } from "./activitySettlement";

describe("activity settlement preview", () => {
  test("shows the attendance award for a checked member", () => {
    expect(
      settlementPreview(
        { role: 0, onlineEvidence: false, noShowPoints: -2 },
        true,
        false,
      ),
    ).toBe(2);
  });

  test("shows the automatic no-show penalty only without online evidence", () => {
    expect(
      settlementPreview(
        { role: 0, onlineEvidence: false, noShowPoints: -2 },
        false,
        false,
      ),
    ).toBe(-2);
    expect(
      settlementPreview(
        { role: 0, onlineEvidence: true, noShowPoints: -2 },
        false,
        false,
      ),
    ).toBe(0);
  });

  test("derives the expected penalty when the API omits the preview field", () => {
    expect(
      settlementPreview({ role: 0, onlineEvidence: false }, false, false, true),
    ).toBe(-2);
  });

  test("does not invent an automatic penalty when no end time exists", () => {
    expect(evidenceState(null, false)).toBe("unavailable");
    expect(
      settlementPreview(
        { role: 0, onlineEvidence: false, noShowPoints: 0 },
        false,
        false,
        false,
      ),
    ).toBe(0);
  });
});
