import { describe, expect, test } from "bun:test";
import {
  HISTORY_PAGE_SIZE,
  adjustBody,
  balancePath,
  canReverse,
  charCount,
  emptyAdjustForm,
  entryState,
  errorKey,
  formatPoints,
  formatSigned,
  hasErrors,
  isReplay,
  isSelf,
  manualPath,
  mergeEntries,
  newReference,
  parseAmount,
  projectedBalance,
  reverseBody,
  reversePath,
  signedAmount,
  validateAdjust,
  validateReverseNote,
  type AdjustForm,
  type ManualEntry,
} from "./points";

const ME = "1001";
const REF = "3f1c2b8e-9d4a-4c1e-8b7f-2a6d5e4c3b21";

function form(overrides: Partial<AdjustForm> = {}): AdjustForm {
  return {
    ...emptyAdjustForm(),
    username: "2002",
    amount: "100",
    detail: "活动补发",
    ...overrides,
  };
}

function entry(overrides: Partial<ManualEntry> = {}): ManualEntry {
  return {
    id: 9,
    username: "2002",
    amount: 100,
    detail: "活动补发",
    note: null,
    operator: ME,
    createdAt: "2026-10-07T12:00:00Z",
    reverses: null,
    reversedBy: null,
    ...overrides,
  };
}

describe("limits", () => {
  test("amount accepts 1 and 1000000, rejects 0 and 1000001", () => {
    expect(validateAdjust(form({ amount: "1" }), ME).amount).toBeUndefined();
    expect(
      validateAdjust(form({ amount: "1000000" }), ME).amount,
    ).toBeUndefined();
    expect(validateAdjust(form({ amount: "0" }), ME).amount).toBe("amount");
    expect(validateAdjust(form({ amount: "1000001" }), ME).amount).toBe(
      "amount",
    );
  });

  test("detail is counted after trim: 255 accepted, 256 rejected", () => {
    const pad = (n: number) => ` ${"x".repeat(n)} `;
    expect(
      validateAdjust(form({ detail: pad(255) }), ME).detail,
    ).toBeUndefined();
    expect(validateAdjust(form({ detail: pad(256) }), ME).detail).toBe(
      "detailLength",
    );
  });

  test("note is counted after trim: 255 accepted, 256 rejected", () => {
    const pad = (n: number) => ` ${"x".repeat(n)} `;
    expect(validateAdjust(form({ note: pad(255) }), ME).note).toBeUndefined();
    expect(validateAdjust(form({ note: pad(256) }), ME).note).toBe(
      "noteLength",
    );
    expect(validateReverseNote(pad(255))).toBeUndefined();
    expect(validateReverseNote(pad(256))).toBe("noteLength");
  });

  test("history page size is within can-api's 1..100 range", () => {
    expect(HISTORY_PAGE_SIZE).toBeGreaterThanOrEqual(1);
    expect(HISTORY_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe("emptyAdjustForm", () => {
  test("starts as a grant with nothing filled", () => {
    expect(emptyAdjustForm()).toEqual({
      username: "",
      direction: "grant",
      amount: "",
      detail: "",
      note: "",
    });
  });
});

describe("newReference", () => {
  test("is a v4 UUID and differs per call", () => {
    const a = newReference();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newReference()).not.toBe(a);
  });
});

describe("charCount", () => {
  test("counts code points, not UTF-16 units", () => {
    expect(charCount("abc")).toBe(3);
    expect(charCount("积分")).toBe(2);
    expect(charCount("😀")).toBe(1);
  });
});

describe("parseAmount", () => {
  test("accepts whole numbers from 1 to 1000000", () => {
    expect(parseAmount("1")).toBe(1);
    expect(parseAmount(" 250 ")).toBe(250);
    expect(parseAmount("1000000")).toBe(1_000_000);
  });

  test("rejects zero, signs, decimals, exponents and anything above the bound", () => {
    for (const bad of [
      "",
      " ",
      "0",
      "00",
      "-5",
      "+5",
      "1.5",
      "1e3",
      "abc",
      "1000001",
    ]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("signedAmount", () => {
  test("the toggle sets the sign", () => {
    expect(signedAmount(form({ direction: "grant", amount: "30" }))).toBe(30);
    expect(signedAmount(form({ direction: "deduct", amount: "30" }))).toBe(-30);
  });

  test("an invalid amount has no signed value", () => {
    expect(signedAmount(form({ amount: "0" }))).toBeNull();
    expect(signedAmount(form({ direction: "deduct", amount: "" }))).toBeNull();
  });
});

describe("isSelf", () => {
  test("compares trimmed usernames and never matches an empty one", () => {
    expect(isSelf("1001", ME)).toBe(true);
    expect(isSelf(" 1001 ", ME)).toBe(true);
    expect(isSelf("2002", ME)).toBe(false);
    expect(isSelf("", "")).toBe(false);
    expect(isSelf("1001", "")).toBe(false);
  });
});

describe("validateAdjust", () => {
  test("accepts a complete grant and a complete deduction", () => {
    expect(validateAdjust(form(), ME)).toEqual({});
    expect(validateAdjust(form({ direction: "deduct" }), ME)).toEqual({});
    expect(hasErrors(validateAdjust(form(), ME))).toBe(false);
  });

  test("requires a member who is not the operator", () => {
    expect(validateAdjust(form({ username: "" }), ME).username).toBe(
      "memberRequired",
    );
    expect(validateAdjust(form({ username: ME }), ME).username).toBe(
      "selfAdjust",
    );
  });

  test("requires an amount inside the bound", () => {
    expect(validateAdjust(form({ amount: "  " }), ME).amount).toBe(
      "amountRequired",
    );
    expect(validateAdjust(form({ amount: "0" }), ME).amount).toBe("amount");
    expect(validateAdjust(form({ amount: "1000001" }), ME).amount).toBe(
      "amount",
    );
    expect(validateAdjust(form({ amount: "1.5" }), ME).amount).toBe("amount");
  });

  test("requires a public description of 1 to 255 characters", () => {
    expect(validateAdjust(form({ detail: "   " }), ME).detail).toBe(
      "detailRequired",
    );
    expect(validateAdjust(form({ detail: "x".repeat(256) }), ME).detail).toBe(
      "detailLength",
    );
    expect(
      validateAdjust(form({ detail: "x".repeat(255) }), ME).detail,
    ).toBeUndefined();
    expect(
      validateAdjust(form({ detail: "😀".repeat(255) }), ME).detail,
    ).toBeUndefined();
  });

  test("caps the internal note at 255 characters", () => {
    expect(validateAdjust(form({ note: "x".repeat(256) }), ME).note).toBe(
      "noteLength",
    );
    expect(
      validateAdjust(form({ note: "x".repeat(255) }), ME).note,
    ).toBeUndefined();
  });
});

describe("adjustBody", () => {
  test("sends a signed number, trimmed text and no note when blank", () => {
    const body = adjustBody(
      form({
        direction: "deduct",
        amount: " 30 ",
        detail: " 误发 ",
        note: "  ",
      }),
      REF,
    );
    expect(body).toEqual({
      username: "2002",
      amount: -30,
      detail: "误发",
      reference: REF,
    });
    expect("note" in body).toBe(false);
  });

  test("keeps a non-blank note, trimmed", () => {
    expect(adjustBody(form({ note: " 工单 42 " }), REF).note).toBe("工单 42");
  });

  test("refuses an invalid amount", () => {
    expect(() => adjustBody(form({ amount: "0" }), REF)).toThrow();
  });
});

describe("reverse note", () => {
  test("is optional and capped at 255 characters", () => {
    expect(validateReverseNote("")).toBeUndefined();
    expect(validateReverseNote("x".repeat(255))).toBeUndefined();
    expect(validateReverseNote("x".repeat(256))).toBe("noteLength");
  });

  test("a blank note is left out of the body", () => {
    expect(reverseBody("  ")).toEqual({});
    expect(reverseBody(" 重复发放 ")).toEqual({ note: "重复发放" });
  });
});

describe("balances and numbers", () => {
  test("projects the balance, negative allowed", () => {
    expect(projectedBalance(50, 30)).toBe(80);
    expect(projectedBalance(50, -80)).toBe(-30);
  });

  test("formats with grouping and an explicit plus sign", () => {
    expect(formatPoints(1234567)).toBe("1,234,567");
    expect(formatPoints(-30)).toBe("-30");
    expect(formatSigned(1000)).toBe("+1,000");
    expect(formatSigned(-5)).toBe("-5");
    expect(formatSigned(0)).toBe("0");
  });
});

describe("isReplay", () => {
  const body = adjustBody(form(), REF);

  test("the entry that was asked for is not a replay", () => {
    expect(isReplay(entry(), body)).toBe(false);
  });

  test("an entry that differs from the request is a replay", () => {
    expect(isReplay(entry({ amount: 50 }), body)).toBe(true);
    expect(isReplay(entry({ username: "3003" }), body)).toBe(true);
    expect(isReplay(entry({ detail: "别的说明" }), body)).toBe(true);
  });
});

describe("entryState / canReverse", () => {
  test("classifies entries", () => {
    expect(entryState(entry())).toBe("active");
    expect(entryState(entry({ reversedBy: 12 }))).toBe("reversed");
    expect(entryState(entry({ reverses: 3, amount: -100 }))).toBe("reversal");
  });

  test("only an active entry of another member can be reversed", () => {
    expect(canReverse(entry(), ME)).toBe(true);
    expect(canReverse(entry({ reversedBy: 12 }), ME)).toBe(false);
    expect(canReverse(entry({ reverses: 3 }), ME)).toBe(false);
    expect(canReverse(entry({ username: ME }), ME)).toBe(false);
  });
});

describe("paths", () => {
  test("balance", () => {
    expect(balancePath("2002")).toBe(
      "/api/v1/super/points/balance?username=2002",
    );
  });

  test("history leaves out a blank filter and a missing cursor", () => {
    expect(manualPath({ username: "", cursor: null, limit: 50 })).toBe(
      "/api/v1/super/points/manual?limit=50",
    );
    expect(manualPath({ username: " 2002 ", cursor: "abc", limit: 50 })).toBe(
      "/api/v1/super/points/manual?username=2002&cursor=abc&limit=50",
    );
    expect(manualPath({ username: "", cursor: 42, limit: 100 })).toBe(
      "/api/v1/super/points/manual?cursor=42&limit=100",
    );
  });

  test("reverse", () => {
    expect(reversePath(9)).toBe("/api/v1/super/points/9/reverse");
  });
});

describe("mergeEntries", () => {
  test("appends the next page and drops rows already shown", () => {
    const merged = mergeEntries(
      [entry({ id: 9 }), entry({ id: 8 })],
      [entry({ id: 8 }), entry({ id: 7 })],
    );
    expect(merged.map((e) => e.id)).toEqual([9, 8, 7]);
  });
});

describe("errorKey", () => {
  test("maps every documented can-api code", () => {
    expect(errorKey("invalid_amount")).toBe("invalidAmount");
    expect(errorKey("invalid_detail")).toBe("invalidDetail");
    expect(errorKey("invalid_request")).toBe("invalidRequest");
    expect(errorKey("self_adjust")).toBe("selfAdjust");
    expect(errorKey("not_found")).toBe("notFound");
    expect(errorKey("not_reversible")).toBe("notReversible");
    expect(errorKey("already_reversed")).toBe("alreadyReversed");
    expect(errorKey("network")).toBe("network");
  });

  test("falls back for anything else, prototype names included", () => {
    expect(errorKey("http_error")).toBe("actionFailed");
    expect(errorKey("toString")).toBe("actionFailed");
    expect(errorKey("__proto__")).toBe("actionFailed");
  });
});
