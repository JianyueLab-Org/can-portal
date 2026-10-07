import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DENIED_PATH, noAccessReason, requiredRating } from "./access";

describe("requiredRating", () => {
  test("ADM pages win over /super", () => {
    expect(requiredRating("/super/aip-access")).toBe(12);
    expect(requiredRating("/super/developers")).toBe(12);
  });

  test("/super is SUP, /instr is instructor", () => {
    expect(requiredRating("/super/prizes")).toBe(11);
    expect(requiredRating("/super/promotions")).toBe(11);
    expect(requiredRating("/super/points")).toBe(11);
    expect(requiredRating("/instr/roster")).toBe(8);
    expect(requiredRating("/instr/sweatbox/ZGGG.json")).toBe(8);
  });

  test("everything else is the site floor", () => {
    expect(requiredRating("/")).toBe(8);
    expect(requiredRating(DENIED_PATH)).toBe(8);
  });
});

describe("noAccessReason", () => {
  test("below the floor", () => {
    expect(noAccessReason("/", 5)).toEqual({ kind: "rating", required: 8 });
  });

  test("instructor on a SUP page", () => {
    expect(noAccessReason("/super/prizes", 8)).toEqual({
      kind: "rating",
      required: 11,
    });
  });

  test("SUP on an ADM page", () => {
    expect(noAccessReason("/super/aip-access", 11)).toEqual({
      kind: "rating",
      required: 12,
    });
  });

  test("enough rating", () => {
    expect(noAccessReason("/instr/roster", 8)).toBeNull();
    expect(noAccessReason("/super/prizes", 11)).toBeNull();
    expect(noAccessReason("/super/developers", 12)).toBeNull();
  });
});

describe("roster status access", () => {
  test("allows the SUP floor to edit controller status", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../pages/instr/roster.astro", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("RATING_SUP");
    expect(source).toContain(">= RATING_SUP");
  });
});
