import { describe, expect, test } from "bun:test";
import { getMessages, LOCALES } from "./i18n";
import { errorKey } from "./lottery";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

/**
 * 岛屿会显示的每一个错误键：表单校验的、can-api 错误码映射的、页面自己的。
 * 后半段全部经 `errorKey()` 推导 —— 包括 `lottery_closed`，这样测的是
 * `lottery.ts` 的 `ERROR_KEYS` 映射本身，而不是一个手抄的 `publishExpired`
 * 字面量：映射改了这里就会跟着改，不会悄悄对不上。
 */
const ERROR_KEYS = [
  "load",
  "titleRequired",
  "titleLength",
  "descriptionLength",
  "closesAtRequired",
  "closesAtPast",
  "prizesRequired",
  "count",
  ...[
    "invalid_request",
    "lottery_not_found",
    "insufficient_stock",
    "not_draft",
    "not_cancellable",
    "lottery_closed",
    "network",
    "anything_else",
  ].map(errorKey),
];

describe("lottery.manage dictionary", () => {
  test("exists in every locale with the same keys", () => {
    const reference = keys(getMessages("zh-cn", "lottery.manage"));
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keys(getMessages(locale, "lottery.manage"))).toEqual(reference);
    }
  });

  test("carries every error the page can show", () => {
    for (const locale of LOCALES) {
      const errors = getMessages(locale, "lottery.manage.errors");
      for (const key of ERROR_KEYS) {
        expect(typeof errors[key]).toBe("string");
      }
    }
  });

  test("names the page in the sidebar and on the home page", () => {
    for (const locale of LOCALES) {
      expect(typeof getMessages(locale, "frame").lotteryManage).toBe("string");
      expect(typeof getMessages(locale, "portal.cards").lottery).toBe("string");
    }
  });
});
