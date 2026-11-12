import { expect, spyOn, test } from "bun:test";
import { createContext } from "astro/middleware";
import { POST } from "../pages/api/v1/[...path]";
import { origin } from "./config";

const cookies = [
  "can_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly",
  "can_refresh=; Path=/; Max-Age=0; HttpOnly",
];

for (const withCookies of [true, false]) {
  for (const withCache of [true, false]) {
    test(`proxy preserves response with cookies=${withCookies}, cache=${withCache}`, async () => {
      const headers = new Headers({
        "content-type": "application/octet-stream",
        "x-private": "not-for-browser",
      });
      if (withCookies) {
        for (const cookie of cookies) headers.append("set-cookie", cookie);
      }
      if (withCache) headers.set("cache-control", "private, max-age=12");
      const bytes = new Uint8Array([0, 255, 42]);
      const upstream = new Response(bytes, { status: 202, headers });
      // Replace only the network boundary; exercise real Headers, streams and handler.
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(upstream);
      try {
        const path = "auth/signout";
        const response = await POST(
          createContext({
            request: new Request(`${origin()}/api/v1/${path}`, {
              method: "POST",
              headers: { origin: origin(), cookie: "can_session=member" },
            }),
            params: { path },
            defaultLocale: "en-us",
          }),
        );
        expect(response.headers.getSetCookie()).toEqual(
          withCookies ? cookies : [],
        );
        expect(response.status).toBe(202);
        expect(response.body).toBe(upstream.body);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        expect(response.headers.get("content-type")).toBe(
          "application/octet-stream",
        );
        expect(response.headers.get("cache-control")).toBe(
          withCache ? "private, max-age=12" : "private, no-store",
        );
        expect(response.headers.has("x-private")).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  }
}
