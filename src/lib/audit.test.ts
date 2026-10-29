import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_GROUPS, AUDIT_PAGE_SIZE, listPath } from "./audit";
import { createTranslator, LOCALES } from "./i18n";

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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

describe("listPath", () => {
  test("omits empty filters and always sends limit 50", () => {
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(listPath({})).toBe("/api/v1/super/audit?limit=50");
    expect(listPath({ action: "", actor: "", target: "", cursor: null })).toBe(
      "/api/v1/super/audit?limit=50",
    );
    expect(listPath({ cursor: 0 })).toBe("/api/v1/super/audit?limit=50");
  });

  test("includes a set action, actor, and target", () => {
    expect(
      listPath({
        action: "roster.update",
        actor: "1001",
        target: "1002",
      }),
    ).toBe(
      "/api/v1/super/audit?action=roster.update&actor=1001&target=1002&limit=50",
    );
  });

  test("includes the cursor and still sends limit 50", () => {
    expect(listPath({ cursor: 99 })).toBe(
      "/api/v1/super/audit?cursor=99&limit=50",
    );
    expect(listPath({ action: "points.adjust", cursor: 12 })).toBe(
      "/api/v1/super/audit?action=points.adjust&cursor=12&limit=50",
    );
  });
});

describe("audit dictionary", () => {
  test("exists in every locale with the same keys as zh-cn", () => {
    const reference = keys(at(dictionary("zh-cn"), "audit"));
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keys(at(dictionary(locale), "audit"))).toEqual(reference);
    }
  });

  test("names the page in the sidebar", () => {
    for (const locale of LOCALES) {
      expect(typeof at(dictionary(locale), "frame.admin.items").audit).toBe(
        "string",
      );
    }
  });

  test("translates every grouped action through createTranslator", () => {
    // 岛屿用的就是这条：`t("actions." + token)`。createTranslator 按 `.` 往下走，
    // 点号键 `"roster.update"` 对不上 `actions.roster.update`，查不到就原样返回
    // 键。方括号 `dict[action]` 测的是另一条路，所以这里必须走翻译器。
    const actions = ACTION_GROUPS.flatMap((group) => group.actions);
    expect(actions).toHaveLength(33);
    for (const locale of LOCALES) {
      const t = createTranslator(at(dictionary(locale), "audit"));
      for (const action of actions) {
        const label = t(`actions.${action}`);
        expect(label).not.toBe(`actions.${action}`);
        expect(label).not.toBe(action);
      }
      for (const group of ACTION_GROUPS) {
        const label = t(`groups.${group.group}`);
        expect(label).not.toBe(`groups.${group.group}`);
      }
    }
  });
});
