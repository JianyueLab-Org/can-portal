import { describe, expect, test } from "bun:test";
import {
  LOTTERY_CANCELLED,
  LOTTERY_DRAFT,
  LOTTERY_DRAWN,
  LOTTERY_OPEN,
  canCancel,
  canEdit,
  emptyForm,
  errorKey,
  formFromLottery,
  hasClosed,
  hasErrors,
  lotteryBody,
  pickerRows,
  selectedPrizes,
  shortfalls,
  toInstant,
  toZuluInput,
  unitsOf,
  validateLottery,
  type LotteryForm,
  type LotterySummary,
} from "./lottery";

const NOW = new Date("2026-09-25T12:00:00Z");

function form(overrides: Partial<LotteryForm> = {}): LotteryForm {
  return {
    ...emptyForm(),
    title: "国庆抽奖",
    closesAt: "2026-10-01T12:00",
    counts: { 3: "2" },
    ...overrides,
  };
}

function summary(overrides: Partial<LotterySummary> = {}): LotterySummary {
  return {
    id: 7,
    title: "国庆抽奖",
    description: null,
    closesAt: "2026-10-01T12:00:00Z",
    drawnAt: null,
    status: LOTTERY_DRAFT,
    entryCount: 0,
    entered: false,
    prizes: [
      { prizeId: 3, name: "徽章", count: 2 },
      { prizeId: 5, name: "马克杯", count: 1 },
    ],
    ...overrides,
  };
}

describe("validateLottery", () => {
  test("accepts a complete draft", () => {
    expect(validateLottery(form(), NOW)).toEqual({});
    expect(hasErrors(validateLottery(form(), NOW))).toBe(false);
  });

  test("requires a title of at most 120 characters", () => {
    expect(validateLottery(form({ title: "   " }), NOW).title).toBe(
      "titleRequired",
    );
    expect(validateLottery(form({ title: "x".repeat(121) }), NOW).title).toBe(
      "titleLength",
    );
    expect(
      validateLottery(form({ title: "x".repeat(120) }), NOW).title,
    ).toBeUndefined();
  });

  test("rejects a description over 2000 characters", () => {
    expect(
      validateLottery(form({ description: "x".repeat(2001) }), NOW).description,
    ).toBe("descriptionLength");
  });

  test("requires a closing time after now", () => {
    expect(validateLottery(form({ closesAt: "" }), NOW).closesAt).toBe(
      "closesAtRequired",
    );
    expect(
      validateLottery(form({ closesAt: "2026-09-25T12:00" }), NOW).closesAt,
    ).toBe("closesAtPast");
    expect(
      validateLottery(form({ closesAt: "2026-09-25T11:59" }), NOW).closesAt,
    ).toBe("closesAtPast");
  });

  test("requires at least one prize", () => {
    expect(validateLottery(form({ counts: {} }), NOW).prizes).toBe(
      "prizesRequired",
    );
    expect(
      validateLottery(form({ counts: { 3: "", 4: "0", 5: "  " } }), NOW).prizes,
    ).toBe("prizesRequired");
  });

  test("rejects a count that is not a positive integer within the limit", () => {
    for (const bad of ["1.5", "-1", "abc", "100001"]) {
      expect(validateLottery(form({ counts: { 3: bad } }), NOW).prizes).toBe(
        "count",
      );
    }
    expect(
      validateLottery(form({ counts: { 3: "100000" } }), NOW).prizes,
    ).toBeUndefined();
  });
});

describe('numeric counts (Vue 3.5 vModelText casts type="number" inputs)', () => {
  test("validateLottery accepts a form whose counts are numbers", () => {
    expect(validateLottery(form({ counts: { 3: 2 } }), NOW)).toEqual({});
  });

  test("validateLottery treats a numeric 0 count as unselected", () => {
    expect(validateLottery(form({ counts: { 3: 0 } }), NOW).prizes).toBe(
      "prizesRequired",
    );
  });

  test("selectedPrizes reads a numeric count", () => {
    expect(selectedPrizes({ 3: 2, 5: 1 })).toEqual([
      { prizeId: 3, count: 2 },
      { prizeId: 5, count: 1 },
    ]);
  });

  test("selectedPrizes drops a numeric zero count", () => {
    expect(selectedPrizes({ 3: 2, 4: 0 })).toEqual([{ prizeId: 3, count: 2 }]);
  });

  test("shortfalls reads a numeric count against known stock", () => {
    const shop = [{ id: 3, name: "徽章", stock: 1 }];
    expect(shortfalls(shop, { 3: 2 })).toEqual([3]);
  });

  test("lotteryBody serializes a form whose counts are numbers", () => {
    expect(lotteryBody(form({ counts: { 3: 2, 5: 1 } })).prizes).toEqual([
      { prizeId: 3, count: 2 },
      { prizeId: 5, count: 1 },
    ]);
  });
});

describe("toInstant / toZuluInput", () => {
  test("reads a zone-less value as Zulu", () => {
    expect(toInstant("2026-10-01T12:00", "zulu").toISOString()).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  test("an empty value is an invalid date", () => {
    expect(Number.isNaN(toInstant("", "zulu").getTime())).toBe(true);
  });

  test("turns an instant back into a Zulu input value", () => {
    expect(toZuluInput("2026-10-01T12:00:00Z")).toBe("2026-10-01T12:00");
    expect(toZuluInput(null)).toBe("");
    expect(toZuluInput("junk")).toBe("");
  });
});

describe("selectedPrizes / lotteryBody", () => {
  test("drops blank and zero counts and sorts by prize id", () => {
    expect(selectedPrizes({ 5: "1", 3: " 2 ", 9: "", 4: "0" })).toEqual([
      { prizeId: 3, count: 2 },
      { prizeId: 5, count: 1 },
    ]);
  });

  test("sends numbers, an absolute instant and null for a blank description", () => {
    expect(
      lotteryBody(
        form({
          title: "  国庆抽奖 ",
          description: "  ",
          counts: { 5: "1", 3: " 2 ", 9: "" },
        }),
      ),
    ).toEqual({
      title: "国庆抽奖",
      description: null,
      closesAt: "2026-10-01T12:00:00.000Z",
      prizes: [
        { prizeId: 3, count: 2 },
        { prizeId: 5, count: 1 },
      ],
    });
  });

  test("keeps a non-blank description, trimmed", () => {
    expect(lotteryBody(form({ description: " 祝好运 " })).description).toBe(
      "祝好运",
    );
  });
});

describe("formFromLottery", () => {
  test("loads a draft into the form in Zulu", () => {
    expect(formFromLottery(summary({ description: "说明" }))).toEqual({
      title: "国庆抽奖",
      description: "说明",
      closesAt: "2026-10-01T12:00",
      timezone: "zulu",
      counts: { 3: "2", 5: "1" },
    });
  });
});

describe("shortfalls", () => {
  test("lists prizes whose count exceeds known stock", () => {
    const shop = [
      { id: 3, name: "徽章", stock: 1 },
      { id: 5, name: "马克杯", stock: 10 },
    ];
    expect(shortfalls(shop, { 3: "2", 5: "10", 7: "1" })).toEqual([3]);
  });
});

describe("pickerRows", () => {
  test("lists the shop, then draft prizes the shop no longer has", () => {
    const shop = [{ id: 5, name: "马克杯", stock: 10 }];
    expect(pickerRows(shop, summary().prizes)).toEqual([
      { prizeId: 5, name: "马克杯", stock: 10 },
      { prizeId: 3, name: "徽章", stock: null },
    ]);
  });
});

describe("unitsOf", () => {
  test("sums the counts", () => {
    expect(unitsOf(summary().prizes)).toBe(3);
    expect(unitsOf([])).toBe(0);
  });
});

describe("status rules", () => {
  test("only a draft can be edited or published", () => {
    expect(canEdit(LOTTERY_DRAFT)).toBe(true);
    expect(canEdit(LOTTERY_OPEN)).toBe(false);
    expect(canEdit(LOTTERY_DRAWN)).toBe(false);
    expect(canEdit(LOTTERY_CANCELLED)).toBe(false);
  });

  test("a draft or an open draw can be cancelled", () => {
    expect(canCancel(LOTTERY_DRAFT)).toBe(true);
    expect(canCancel(LOTTERY_OPEN)).toBe(true);
    expect(canCancel(LOTTERY_DRAWN)).toBe(false);
    expect(canCancel(LOTTERY_CANCELLED)).toBe(false);
  });

  test("hasClosed compares against now", () => {
    expect(hasClosed("2026-09-25T12:00:00Z", NOW)).toBe(true);
    expect(hasClosed("2026-09-25T12:01:00Z", NOW)).toBe(false);
  });
});

describe("errorKey", () => {
  test("maps every documented can-api code", () => {
    expect(errorKey("invalid_request")).toBe("invalidRequest");
    expect(errorKey("lottery_not_found")).toBe("notFound");
    expect(errorKey("insufficient_stock")).toBe("insufficientStock");
    expect(errorKey("not_draft")).toBe("notDraft");
    expect(errorKey("not_cancellable")).toBe("notCancellable");
    expect(errorKey("network")).toBe("network");
  });

  // Controller ruling (overrides the brief): can-api answers 409
  // `lottery_closed` when publishing a draft whose `closesAt` has already
  // passed. The `publishExpired` dictionary key lands in Task 2.
  test("maps the expired-draft code", () => {
    expect(errorKey("lottery_closed")).toBe("publishExpired");
  });

  test("falls back for anything else, prototype names included", () => {
    expect(errorKey("http_error")).toBe("actionFailed");
    expect(errorKey("toString")).toBe("actionFailed");
    expect(errorKey("__proto__")).toBe("actionFailed");
  });
});
