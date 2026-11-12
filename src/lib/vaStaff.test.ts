import { describe, expect, test } from "bun:test";
import { lookup } from "../pages/api/v1/[...path]";
import {
  ERROR_CODES,
  actionRequest,
  airlinesPath,
  applicationsPath,
  approvePath,
  errorKey,
  formatMoney,
  formatTime,
  importPath,
  paramPath,
  paramsLogPath,
  paramsPath,
  parseMoney,
  parseParamValue,
  reinstatePath,
  type ActionFields,
} from "./vaStaff";

const blank: ActionFields = { reason: "", username: "", amount: "", note: "" };

/** 去掉 `/api/v1/` 前缀和查询串，得到反代 `lookup()` 认的那一段。 */
function proxied(path: string): string {
  return path.replace(/^\/api\/v1\//, "").replace(/\?.*$/, "");
}

describe("paths", () => {
  test("query strings", () => {
    expect(applicationsPath()).toBe(
      "/api/v1/va/staff/applications?status=pending",
    );
    expect(airlinesPath("all")).toBe("/api/v1/va/staff/airlines");
    expect(airlinesPath("suspended")).toBe(
      "/api/v1/va/staff/airlines?status=suspended",
    );
    expect(paramsLogPath(null)).toBe("/api/v1/va/staff/params/log?limit=20");
    expect(paramsLogPath(41)).toBe(
      "/api/v1/va/staff/params/log?limit=20&before=41",
    );
  });

  test("every staff route the page calls is on the proxy allow-list", () => {
    const ok = (fields: ActionFields): Array<[string, string]> =>
      (["reject", "suspend", "close", "owner", "adjust"] as const).map(
        (action) => {
          const request = actionRequest(action, 7, fields);
          if (!request.ok) throw new Error(`${action}: ${request.error}`);
          return [request.path, request.method];
        },
      );
    const calls: Array<[string, string]> = [
      [applicationsPath(), "GET"],
      [approvePath(3), "POST"],
      [airlinesPath("all"), "GET"],
      [airlinesPath("closed"), "GET"],
      [reinstatePath(7), "POST"],
      [paramsPath(), "GET"],
      [paramPath("pilot_starting_wallet"), "PUT"],
      [paramsLogPath(9), "GET"],
      [importPath(), "POST"],
      ...ok({ reason: "r", username: "100001", amount: "-12.5", note: "n" }),
    ];
    expect(new Set(calls.map(([p]) => proxied(p))).size).toBe(13);
    for (const [path, method] of calls) {
      const entry = lookup(proxied(path));
      expect(entry?.upstream).toBe("va");
      expect(entry?.methods).toContain(method);
    }
  });
});

describe("actionRequest", () => {
  test("reject and suspend and close need a reason", () => {
    for (const action of ["reject", "suspend", "close"] as const) {
      expect(actionRequest(action, 1, { ...blank, reason: "  " })).toEqual({
        ok: false,
        error: "reasonRequired",
      });
    }
    expect(
      actionRequest("reject", 5, { ...blank, reason: " 代码冲突 " }),
    ).toEqual({
      ok: true,
      method: "POST",
      path: "/api/v1/va/staff/applications/5/reject",
      body: { reason: "代码冲突" },
    });
    expect(actionRequest("close", 2, { ...blank, reason: "x" })).toEqual({
      ok: true,
      method: "POST",
      path: "/api/v1/va/staff/airlines/2/close",
      body: { reason: "x" },
    });
  });

  test("owner needs a username", () => {
    expect(actionRequest("owner", 2, blank)).toEqual({
      ok: false,
      error: "usernameRequired",
    });
    expect(
      actionRequest("owner", 2, { ...blank, username: " 100001 " }),
    ).toEqual({
      ok: true,
      method: "PUT",
      path: "/api/v1/va/staff/airlines/2/owner",
      body: { username: "100001" },
    });
  });

  test("adjust needs a non-zero amount and a note", () => {
    expect(actionRequest("adjust", 2, { ...blank, note: "n" })).toEqual({
      ok: false,
      error: "amount",
    });
    expect(actionRequest("adjust", 2, { ...blank, amount: "10" })).toEqual({
      ok: false,
      error: "noteRequired",
    });
    expect(
      actionRequest("adjust", 2, {
        ...blank,
        amount: "-1500.25",
        note: " 补偿 ",
      }),
    ).toEqual({
      ok: true,
      method: "POST",
      path: "/api/v1/va/staff/airlines/2/adjustments",
      body: { amount: -150025, note: "补偿" },
    });
  });
});

describe("money", () => {
  test.each([
    ["10", 1000],
    ["-10", -1000],
    ["+3.5", 350],
    ["0.01", 1],
    ["1,234.56", 123456],
  ])("parseMoney(%p) = %p", (text, minor) => {
    expect(parseMoney(text)).toBe(minor);
  });

  test.each([
    "",
    "0",
    "0.00",
    "1.234",
    "abc",
    "1e5",
    "--1",
    "99999999999999999",
  ])("parseMoney(%p) is null", (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  test("formatMoney", () => {
    expect(formatMoney(123456)).toBe("1,234.56");
    expect(formatMoney(-5)).toBe("-0.05");
    expect(formatMoney(0)).toBe("0.00");
  });
});

describe("parseParamValue", () => {
  test.each([
    ["1.25", 1.25],
    [" 400000 ", 400000],
    ["0", 0],
  ])("%p", (text, value) => {
    expect(parseParamValue(text)).toBe(value);
  });

  test.each(["", "-3", "abc", "1e3", "1.", ".5", "Infinity"])(
    "%p is null",
    (text) => {
      expect(parseParamValue(text)).toBeNull();
    },
  );
});

describe("formatTime", () => {
  test("UTC minutes with Z", () => {
    expect(formatTime("2026-10-24T08:05:59Z")).toBe("2026-10-24 08:05Z");
  });
  test("null or garbage", () => {
    expect(formatTime(null)).toBe("—");
    expect(formatTime("nope")).toBe("—");
  });
});

describe("errorKey", () => {
  test("contract codes map to their own keys", () => {
    expect(errorKey("code_taken")).toBe("codeTaken");
    expect(errorKey("import_running")).toBe("importRunning");
    expect(errorKey("no_owner")).toBe("noOwner");
    expect(errorKey("airport_unavailable")).toBe("airportUnavailable");
  });
  test("every listed code has a key other than the fallback", () => {
    for (const code of ERROR_CODES) {
      expect(errorKey(code)).not.toBe("actionFailed");
    }
  });
  test("unknown and prototype keys fall back", () => {
    expect(errorKey("whatever")).toBe("actionFailed");
    expect(errorKey("toString")).toBe("actionFailed");
    expect(errorKey("__proto__")).toBe("actionFailed");
  });
});
