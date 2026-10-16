import { afterEach, describe, expect, test } from "bun:test";

import { CAN_API_ORIGIN } from "../lib/config";
import { resolveSession, type SessionUser } from "./canApi";

const USER: SessionUser = {
  username: "synthetic-member",
  name: "Synthetic Member",
  email: "member@example.com",
  rating: 0,
  aipAccess: 2,
};
const COOKIE = "can_session=synthetic-session";
const originalFetch = globalThis.fetch;
let calls = 0;

function context(cookie: string | null = COOKIE) {
  return {
    request: new Request("https://portal.example.test/", {
      headers: cookie === null ? {} : { cookie },
    }),
  };
}

function stub(response: Response | (() => Response), expectCookie = true) {
  calls = 0;
  globalThis.fetch = (async (input, init = {}) => {
    calls += 1;
    expect(String(input)).toBe(`${CAN_API_ORIGIN}/api/v1/auth/session`);
    if (expectCookie) expect(init.headers).toEqual({ cookie: COOKIE });
    return typeof response === "function" ? response() : response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveSession", () => {
  test("keeps an upstream 429 unavailable instead of treating it as signed out", async () => {
    stub(Response.json({ error: "rate_limited" }, { status: 429 }));
    expect(await resolveSession(context())).toEqual({ kind: "unavailable" });
    expect(calls).toBe(1);
  });

  test("keeps an upstream 503 unavailable instead of treating it as signed out", async () => {
    stub(Response.json({ error: "temporarily_unavailable" }, { status: 503 }));
    expect(await resolveSession(context())).toEqual({ kind: "unavailable" });
  });

  test("treats an authoritative 401 as signed out", async () => {
    stub(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect(await resolveSession(context())).toEqual({ kind: "signed-out" });
  });

  test("treats a successful null user response as signed out", async () => {
    stub(Response.json({ user: null }));
    expect(await resolveSession(context())).toEqual({ kind: "signed-out" });
  });

  test("preserves an authenticated session", async () => {
    stub(Response.json({ user: USER }), false);
    expect(await resolveSession(context())).toEqual({
      kind: "authenticated",
      user: USER,
    });
  });

  test("keeps a missing cookie signed out without querying upstream", async () => {
    stub(Response.json({ user: USER }));
    expect(await resolveSession(context(null))).toEqual({ kind: "signed-out" });
    expect(calls).toBe(0);
  });
});
