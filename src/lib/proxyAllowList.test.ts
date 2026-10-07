import { describe, expect, test } from "bun:test";

import { lookup } from "../pages/api/v1/[...path]";

/**
 * 通知铃的五条路径在转发白名单上，方法各自只有一个；相邻的形状不在。
 * 测试不放在 `src/pages/` 下：那里每个 `.ts` 都是路由。
 */

const BELL: Array<[string, string[]]> = [
  ["notifications", ["GET"]],
  ["notifications/unread", ["GET"]],
  ["notifications/read-all", ["POST"]],
  ["notifications/member/1", ["PATCH"]],
  ["notifications/broadcast/12345678901234567890", ["PATCH"]],
];

describe("通知铃", () => {
  test("五条都在，方法对得上，who 指向通知铃", () => {
    for (const [path, methods] of BELL) {
      const entry = lookup(path);
      expect(entry?.methods).toEqual(methods);
      expect(entry?.who).toContain("通知铃");
    }
  });

  test.each([
    "notifications/member",
    "notifications/member/",
    "notifications/member/abc",
    "notifications/member/1/read",
    "notifications/other/1",
    "notifications/broadcast/123456789012345678901",
    "notifications/unread/x",
    "notifications/../super/roster",
  ])("%s 不在名单上", (path) => {
    expect(lookup(path)).toBeUndefined();
  });
});

/**
 * 积分调整的四条路径。方法各自只有一个；相邻的形状不在。
 */
const POINTS: Array<[string, string[]]> = [
  ["super/points/balance", ["GET"]],
  ["super/points/adjust", ["POST"]],
  ["super/points/manual", ["GET"]],
  ["super/points/1/reverse", ["POST"]],
  ["super/points/12345678901234567890/reverse", ["POST"]],
];

describe("积分调整", () => {
  test("四条都在，方法对得上，who 指向 ManagePoints.vue", () => {
    for (const [path, methods] of POINTS) {
      const entry = lookup(path);
      expect(entry?.methods).toEqual(methods);
      expect(entry?.who).toContain("ManagePoints.vue");
    }
  });

  test("成员搜索的 who 也写上了 ManagePoints.vue", () => {
    expect(lookup("super/members")?.who).toContain("ManagePoints.vue");
  });

  test.each([
    "super/points",
    "super/points/",
    "super/points/1",
    "super/points/abc/reverse",
    "super/points/1/reverse/x",
    "super/points/1/undo",
    "super/points/123456789012345678901/reverse",
    "super/points/balance/x",
    "super/points/adjust/1",
    "super/points/../roster",
  ])("%s 不在名单上", (path) => {
    expect(lookup(path)).toBeUndefined();
  });
});
