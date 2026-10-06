import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "./i18n";
import { errorKey } from "./points";

/**
 * 直接读 `language/*.json`，不经 `getMessages`：它在每个语言下面垫了 zh-cn，
 * 某个键只缺在 zh-tw / en-us / ja-jp 时，经它读到的仍是中文，测试照样绿。
 */
function dictionary(locale: string): Record<string, unknown> {
  const path = join(import.meta.dir, "../../language", `${locale}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function at(root: unknown, path: string): Record<string, unknown> {
  let node: unknown = root;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return (node ?? {}) as Record<string, unknown>;
}

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

/** 岛屿会显示的每一个错误键：表单校验的、can-api 错误码映射的、页面自己的。 */
const ERROR_KEYS = [
  "load",
  "balance",
  "memberRequired",
  "amountRequired",
  "amount",
  "detailRequired",
  "detailLength",
  "noteLength",
  "selfAdjust",
  ...[
    "invalid_amount",
    "invalid_detail",
    "invalid_request",
    "self_adjust",
    "not_found",
    "not_reversible",
    "already_reversed",
    "network",
    "anything_else",
  ].map(errorKey),
];

describe("points.manage dictionary", () => {
  test("exists in every locale with the same keys", () => {
    const reference = keys(at(dictionary("zh-cn"), "points.manage"));
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keys(at(dictionary(locale), "points.manage"))).toEqual(reference);
    }
  });

  test("carries every error the page can show", () => {
    for (const locale of LOCALES) {
      const errors = at(dictionary(locale), "points.manage.errors");
      for (const key of ERROR_KEYS) {
        expect(typeof errors[key]).toBe("string");
      }
    }
  });

  test("carries a label for every entry state", () => {
    for (const locale of LOCALES) {
      const status = at(dictionary(locale), "points.manage.history.status");
      for (const key of ["active", "reversed", "reversal"]) {
        expect(typeof status[key]).toBe("string");
      }
    }
  });

  test("names the page in the sidebar and on the home page", () => {
    for (const locale of LOCALES) {
      const dict = dictionary(locale);
      expect(typeof at(dict, "frame").pointsManage).toBe("string");
      expect(typeof at(dict, "portal.cards").points).toBe("string");
    }
  });
});
