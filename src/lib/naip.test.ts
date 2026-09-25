import { describe, expect, test } from "bun:test";
import {
  hideNaipFromCookieHeader,
  NAIP_COOKIE,
  withUnrestricted,
} from "./naip";

describe("hideNaipFromCookieHeader", () => {
  test("defaults to hiding", () => {
    expect(hideNaipFromCookieHeader(null)).toBe(true);
    expect(hideNaipFromCookieHeader("session=abc")).toBe(true);
  });
  test("only an explicit 0 shows NAIP", () => {
    expect(hideNaipFromCookieHeader(`a=1; ${NAIP_COOKIE}=0`)).toBe(false);
    expect(hideNaipFromCookieHeader(`${NAIP_COOKIE}=1`)).toBe(true);
    expect(hideNaipFromCookieHeader(`${NAIP_COOKIE}=junk`)).toBe(true);
  });
});

describe("withUnrestricted", () => {
  test("appends to a bare path or an existing query", () => {
    expect(withUnrestricted("/api/v1/aip/airports")).toBe(
      "/api/v1/aip/airports?unrestricted=1",
    );
    expect(withUnrestricted("/api/v1/aip/route?from=ZBAA&to=ZSSS")).toBe(
      "/api/v1/aip/route?from=ZBAA&to=ZSSS&unrestricted=1",
    );
  });
});
