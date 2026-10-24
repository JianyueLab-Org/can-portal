import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "./i18n";
import { ERROR_CODES, errorKey } from "./vaStaff";

/** 直接读 `language/*.json`：`getMessages` 会用 zh-cn 垫底，缺键看不出来。 */
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

/** 表单校验的键、`load`，加上每个错误码映射到的键和兜底。 */
const ERROR_KEYS = [
  "load",
  "reasonRequired",
  "usernameRequired",
  "amount",
  "noteRequired",
  "value",
  ...ERROR_CODES.map(errorKey),
  errorKey("anything_else"),
];

describe("vaAirlines dictionary", () => {
  test("exists in every locale with the same keys", () => {
    const reference = keys(at(dictionary("zh-cn"), "vaAirlines"));
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keys(at(dictionary(locale), "vaAirlines"))).toEqual(reference);
    }
  });

  test("carries every error the page can show", () => {
    for (const locale of LOCALES) {
      const errors = at(dictionary(locale), "vaAirlines.errors");
      for (const key of ERROR_KEYS) {
        expect(typeof errors[key]).toBe("string");
      }
    }
  });

  test("names the page in the sidebar", () => {
    for (const locale of LOCALES) {
      expect(typeof at(dictionary(locale), "frame").airlinesManage).toBe(
        "string",
      );
    }
  });
});
