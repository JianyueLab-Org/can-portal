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

/**
 * 操作日志只有精确的 GET。带 id、尾斜杠、以及往上跳的形状都不转发。
 */
describe("操作日志", () => {
  test("audit GET is on the list", () => {
    const entry = lookup("super/audit");
    expect(entry?.methods).toEqual(["GET"]);
    expect(entry?.who).toContain("AuditLog.vue");
  });

  test.each(["super/audit/1", "super/audit/", "super/audit/../roster"])(
    "%s 不在名单上",
    (path) => {
      expect(lookup(path)).toBeUndefined();
    },
  );
});

/**
 * 虚拟航空平台管理（`/super/airlines`）。转发到 can-va-api，不是 can-api。
 */
const VA_STAFF: Array<[string, string[]]> = [
  ["va/staff/applications", ["GET"]],
  ["va/staff/applications/1/approve", ["POST"]],
  ["va/staff/applications/12345678901234567890/reject", ["POST"]],
  ["va/staff/airlines", ["GET"]],
  ["va/staff/airlines/7/suspend", ["POST"]],
  ["va/staff/airlines/7/reinstate", ["POST"]],
  ["va/staff/airlines/7/close", ["POST"]],
  ["va/staff/airlines/7/adjustments", ["POST"]],
  ["va/staff/airlines/7/owner", ["PUT"]],
  ["va/staff/params", ["GET"]],
  ["va/staff/params/log", ["GET"]],
  ["va/staff/params/pilot_starting_wallet", ["PUT"]],
  ["va/staff/airports/import", ["POST"]],
];

describe("虚拟航空平台管理", () => {
  test("十三条都在，方法对得上，转发到 can-va-api，who 指向 ManageAirlines.vue", () => {
    for (const [path, methods] of VA_STAFF) {
      const entry = lookup(path);
      expect(entry?.methods).toEqual(methods);
      expect(entry?.upstream).toBe("va");
      expect(entry?.who).toContain("ManageAirlines.vue");
    }
  });

  test("can-api 的条目不带 upstream", () => {
    expect(lookup("super/points/adjust")?.upstream).toBeUndefined();
    expect(lookup("auth/session")?.upstream).toBeUndefined();
  });

  test("params/log 是精确条目，只有 GET", () => {
    expect(lookup("va/staff/params/log")?.methods).toEqual(["GET"]);
  });

  test.each([
    "va/me",
    "va/airports",
    "va/airlines",
    "va/staff",
    "va/staff/",
    "va/staff/applications/",
    "va/staff/applications/abc/approve",
    "va/staff/applications/1",
    "va/staff/applications/1/delete",
    "va/staff/applications/123456789012345678901/approve",
    "va/staff/airlines/",
    "va/staff/airlines/1",
    "va/staff/airlines/ABC/suspend",
    "va/staff/airlines/1/owner/x",
    "va/staff/airlines/1/delete",
    "va/staff/params/",
    "va/staff/params/Pilot",
    "va/staff/params/a/b",
    "va/staff/params/../airlines",
    "va/staff/airports",
    "va/staff/airports/import/x",
    "internal/va/pilots/100001",
  ])("%s 不在名单上", (path) => {
    expect(lookup(path)).toBeUndefined();
  });
});
