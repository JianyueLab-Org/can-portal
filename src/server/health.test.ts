import { describe, expect, test } from "bun:test";
import { createHealth, healthResponse } from "./health";

describe("health", () => {
  test("200 when every check passes", async () => {
    const res = healthResponse(
      await createHealth({ "can-api": async () => {} })(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "ok",
      checks: { "can-api": "ok" },
    });
  });

  test("503 when a check fails", async () => {
    const res = healthResponse(
      await createHealth({
        "can-api": async () => {
          throw new Error("HTTP 503");
        },
      })(),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "fail",
      checks: { "can-api": "HTTP 503" },
    });
  });

  test("caches for 10 s and shares in-flight checks", async () => {
    let calls = 0;
    let t = 0;
    const check = createHealth({ x: async () => void calls++ }, () => t);
    await Promise.all([check(), check(), check()]);
    expect(calls).toBe(1);
    t = 9_999;
    await check();
    expect(calls).toBe(1);
    t = 10_000;
    await check();
    expect(calls).toBe(2);
  });
});
