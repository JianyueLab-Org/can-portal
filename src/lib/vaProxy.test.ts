import { describe, expect, test } from "bun:test";
import { GET, POST, PATCH, PUT } from "../pages/api/v1/[...path]";
import { CAN_API_ORIGIN, CAN_VA_API_ORIGIN, origin } from "./config";

type Handler = typeof GET;
function context(
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
) {
  const url = new URL(`/api/v1/${path}`, origin());
  const fixture = {
    params: { path },
    url,
    request: new Request(url, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: "{}" }),
    }),
  };
  // The handler reads only these three fields; no Astro runtime is involved.
  return fixture as unknown as Parameters<Handler>[0];
}

async function withFetch(
  run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>,
  session: unknown,
  sessionStatus = 200,
) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${CAN_API_ORIGIN}/api/v1/auth/session`)
      return Response.json(session, { status: sessionStatus });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const authenticated = (rating: number) => ({
  data: {
    user: {
      username: "100001",
      name: "Supervisor",
      email: "test@example.invalid",
      rating,
      aipAccess: 0,
    },
  },
});

describe("VA management proxy guards", () => {
  test("unknown paths and unsupported delete commands never reach an upstream", async () => {
    await withFetch(async (calls) => {
      expect((await GET(context("va/internal/pilots/100001"))).status).toBe(
        404,
      );
      expect(
        (await POST(context("va/staff/aircraft-types/B738/delete", "POST")))
          .status,
      ).toBe(404);
      expect(
        (await PATCH(context("va/staff/aircraft-types", "PATCH"))).status,
      ).toBe(405);
      expect(calls).toHaveLength(0);
    }, authenticated(11));
  });

  test.each([undefined, "null", "https://foreign.invalid"])(
    "unsafe Origin %s fails before resolving identity",
    async (sentOrigin) => {
      await withFetch(async (calls) => {
        const headers: Record<string, string> = {};
        if (sentOrigin !== undefined) headers.origin = sentOrigin;
        expect(
          (await PUT(context("va/staff/airports/ZBAA/tier", "PUT", headers)))
            .status,
        ).toBe(403);
        expect(calls).toHaveLength(0);
      }, authenticated(11));
    },
  );

  test("bearer credentials cannot be silently converted into cookie access", async () => {
    await withFetch(async (calls) => {
      expect(
        (
          await GET(
            context("va/staff/aircraft-types", "GET", {
              authorization: "Bearer token",
              cookie: "can_session=member",
            }),
          )
        ).status,
      ).toBe(403);
      expect(calls).toHaveLength(0);
    }, authenticated(11));
  });

  test("signed-out, lower-rated and unavailable identities cannot reach VA", async () => {
    for (const [body, status, expected] of [
      [{ data: { user: null } }, 200, 401],
      [authenticated(8), 200, 403],
      [{ error: "unavailable" }, 503, 503],
    ] as const) {
      await withFetch(
        async (calls) => {
          expect((await GET(context("va/staff/aircraft-types"))).status).toBe(
            expected,
          );
          expect(calls).toHaveLength(1);
          expect(calls[0]?.url).toBe(`${CAN_API_ORIGIN}/api/v1/auth/session`);
        },
        body,
        status,
      );
    }
  });

  test("SUP writes forward cookie and validated Origin to the VA upstream", async () => {
    await withFetch(async (calls) => {
      const response = await PUT(
        context("va/staff/airports/ZBAA/tier", "PUT", {
          origin: origin(),
          cookie: "can_session=supervisor",
          "content-type": "application/json",
        }),
      );
      expect(response.status).toBe(204);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.url).toBe(
        `${CAN_VA_API_ORIGIN}/api/v1/va/staff/airports/ZBAA/tier`,
      );
      const forwarded = new Headers(calls[1]?.init?.headers);
      expect(forwarded.get("cookie")).toBe("can_session=supervisor");
      expect(forwarded.get("origin")).toBe(origin());
      expect(forwarded.has("authorization")).toBe(false);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }, authenticated(11));
  });
});
