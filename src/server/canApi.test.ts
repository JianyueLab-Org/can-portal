import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { APIContext } from "astro";
import { defineMiddleware } from "astro/middleware";
import { resolveSession, type SessionUser } from "./canApi";

// Astro's Vite alias is not registered in Bun's unit-test runtime.
mock.module("astro:middleware", () => ({ defineMiddleware }));

const user: SessionUser = {
  username: "synthetic-member",
  name: "Synthetic Member",
  email: "member@example.com",
  rating: 8,
  aipAccess: 1,
};
const cookie = "can_session=synthetic-session";
type FetchCall = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;
const fetchTarget: { fetch: FetchCall } = globalThis;
const fetchSpy = spyOn(fetchTarget, "fetch");
const errorSpy = spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  fetchSpy.mockReset();
  errorSpy.mockClear();
});

afterAll(() => {
  fetchSpy.mockRestore();
  errorSpy.mockRestore();
});

function request(path = "/instr/roster") {
  return new Request(`https://portal.example.com${path}`, {
    headers: { cookie },
  });
}

async function visit(path = "/instr/roster") {
  const { onRequest } = await import("../middleware");
  const incoming = request(path);
  const setCookie = mock(() => {});
  const deleteCookie = mock(() => {});
  const redirect = mock(
    (location: string) =>
      new Response(null, { status: 302, headers: { Location: location } }),
  );
  const locals: App.Locals = { user: null };
  const next = mock(async (rewrite?: unknown) => {
    return new Response(
      rewrite === "/denied" ? "denied" : "protected content",
      {
        status: rewrite === "/denied" ? 403 : 200,
      },
    );
  });
  const context = {
    request: incoming,
    url: new URL(incoming.url),
    locals,
    redirect,
    cookies: { set: setCookie, delete: deleteCookie },
  } as unknown as APIContext;
  const response = await onRequest(context, next);
  if (!(response instanceof Response)) throw new Error("Missing response");
  return { response, locals, next, redirect, setCookie, deleteCookie };
}

function expectSecurityHeaders(response: Response) {
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe(
    "origin-when-cross-origin",
  );
}

describe("session resolution", () => {
  test("accepts the authenticated member and forwards the cookie", async () => {
    fetchSpy.mockResolvedValue(Response.json({ user }));
    expect(await resolveSession({ request: request() })).toEqual({
      state: "authenticated",
      user,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toEqual({ cookie });
  });

  test("accepts the enveloped session response", async () => {
    fetchSpy.mockResolvedValue(Response.json({ status: "ok", data: { user } }));
    expect(await resolveSession({ request: request() })).toEqual({
      state: "authenticated",
      user,
    });
  });

  for (const [name, response] of [
    ["explicit anonymous user", () => Response.json({ user: null })],
    ["authentication rejection", () => Response.json({}, { status: 401 })],
    [
      "authentication rejection with null body",
      () => Response.json(null, { status: 401 }),
    ],
    [
      "authentication rejection without JSON",
      () => new Response("", { status: 401 }),
    ],
    [
      "authentication rejection with malformed error metadata",
      () => Response.json({ error: { toString: null } }, { status: 401 }),
    ],
  ] as const) {
    test(`confirms sign-out for ${name}`, async () => {
      fetchSpy.mockResolvedValue(response());
      expect(await resolveSession({ request: request() })).toEqual({
        state: "signed-out",
      });
    });

    test(`redirects only ${name} to sign-in`, async () => {
      fetchSpy.mockResolvedValue(response());
      const result = await visit();
      expect(result.response.status).toBe(302);
      expect(new URL(result.response.headers.get("Location")!).pathname).toBe(
        "/signin",
      );
      expect(result.next).not.toHaveBeenCalled();
      expect(result.locals.user).toBeNull();
      expect(result.response.headers.get("Set-Cookie")).toBeNull();
      expect(result.setCookie).not.toHaveBeenCalled();
      expect(result.deleteCookie).not.toHaveBeenCalled();
      expectSecurityHeaders(result.response);
    });
  }
});

const failures: Array<{ name: string; respond: () => Promise<Response> }> = [
  ...[201, 202, 206].map((status) => ({
    name: `unexpected HTTP ${status} anonymous response`,
    respond: async () => Response.json({ user: null }, { status }),
  })),
  ...[403, 429, 500, 502, 503, 504].map((status) => ({
    name: `HTTP ${status}`,
    respond: async () =>
      Response.json({ error: "synthetic-failure" }, { status }),
  })),
  {
    name: "transport failure",
    respond: async () => {
      throw new TypeError("Synthetic transport failure");
    },
  },
  {
    name: "timeout",
    respond: async () => {
      throw new DOMException("Synthetic timeout", "TimeoutError");
    },
  },
  { name: "invalid JSON", respond: async () => new Response("{") },
  ...[
    ["missing user", {}],
    ["null body", null],
    ["array body", []],
    ["string body", "invalid"],
    ["number body", 42],
    ["null envelope data", { data: null }],
    ["invalid user", { user: false }],
    ["empty user", { user: {} }],
    ["invalid rating", { user: { ...user, rating: "12" } }],
    ["missing username", { user: { ...user, username: undefined } }],
    ["empty username", { user: { ...user, username: "" } }],
    ["invalid access", { user: { ...user, aipAccess: "5" } }],
  ].map(([name, body]) => ({
    name: String(name),
    respond: async () => Response.json(body),
  })),
];

describe("unavailable sessions", () => {
  for (const failure of failures) {
    test(`classifies ${failure.name} as unavailable`, async () => {
      fetchSpy.mockImplementation(failure.respond);
      expect(await resolveSession({ request: request() })).toEqual({
        state: "unavailable",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test(`returns retryable 503 without sign-in or content for ${failure.name}`, async () => {
      fetchSpy.mockImplementation(failure.respond);
      const result = await visit();
      expect(result.response.status).toBe(503);
      expect(result.response.headers.get("Retry-After")).toBe("5");
      expect(result.response.headers.get("Cache-Control")).toBe("no-store");
      expect(result.response.headers.get("Location")).toBeNull();
      expect(result.response.headers.get("Set-Cookie")).toBeNull();
      expect(await result.response.text()).toBe("");
      expect(result.locals.user).toBeNull();
      expect(result.redirect).not.toHaveBeenCalled();
      expect(result.next).not.toHaveBeenCalled();
      expect(result.setCookie).not.toHaveBeenCalled();
      expect(result.deleteCookie).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expectSecurityHeaders(result.response);
    });
  }

  test("the outbound request retains its five-second abort deadline", async () => {
    const timeout = spyOn(AbortSignal, "timeout");
    try {
      fetchSpy.mockImplementation(async (_input, init) => {
        if (!(init?.signal instanceof AbortSignal)) {
          throw new Error("Missing abort signal");
        }
        throw new DOMException("Synthetic timeout", "TimeoutError");
      });
      expect(await resolveSession({ request: request() })).toEqual({
        state: "unavailable",
      });
      expect(timeout).toHaveBeenCalledWith(5_000);
      expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      timeout.mockRestore();
    }
  });
});

describe("existing middleware guards", () => {
  test("renders for an authenticated instructor", async () => {
    fetchSpy.mockResolvedValue(Response.json({ user }));
    const result = await visit();
    expect(result.response.status).toBe(200);
    expect(result.locals.user).toEqual(user);
    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.redirect).not.toHaveBeenCalled();
    expectSecurityHeaders(result.response);
  });

  test("an instructor still cannot render a SUP page", async () => {
    fetchSpy.mockResolvedValue(Response.json({ user }));
    const result = await visit("/super/prizes");
    expect(result.response.status).toBe(403);
    expect(result.locals.noAccess).toEqual({ kind: "rating", required: 11 });
    expect(result.next).toHaveBeenCalledWith("/denied");
    expect(result.redirect).not.toHaveBeenCalled();
    expectSecurityHeaders(result.response);
  });

  for (const path of ["/healthz", "/api/v1/super/prizes"]) {
    test(`${path} still bypasses page session resolution`, async () => {
      const result = await visit(path);
      expect(result.response.status).toBe(200);
      expect(result.locals.user).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
      expectSecurityHeaders(result.response);
    });
  }
});
