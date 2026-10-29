import { afterEach, describe, expect, test } from "bun:test";
import { getMessages, LOCALES } from "./i18n";
import {
  POLL_DRAFT_ERRORS,
  POLL_DURATION_MAX,
  POLL_ERROR_KINDS,
  POLL_OPTION_MAX,
  POLL_TITLE_MAX,
  classifyPollError,
  closeStaffPoll,
  createOfficialPoll,
  deleteStaffPoll,
  getStaffPoll,
  isPollOpen,
  listStaffPolls,
  memberShare,
  optionPercent,
  pageCount,
  pollTurnout,
  pollListPath,
  shortHash,
  validatePollDraft,
  type StaffPoll,
  type StaffPollDetail,
  type StaffPollSummary,
} from "./polls";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

function summary(overrides: Partial<StaffPollSummary> = {}): StaffPollSummary {
  return {
    id: 7,
    title: "Next fly-in airport",
    platform: "qq",
    communityHash:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    official: false,
    createdBy: "1000001",
    createdAt: "2026-10-28T12:00:00Z",
    closesAt: "2026-10-29T12:00:00Z",
    closedAt: null,
    closed: false,
    voteCount: 3,
    ...overrides,
  };
}

function poll(overrides: Partial<StaffPoll> = {}): StaffPoll {
  return {
    ...summary(),
    options: [
      { number: 1, text: "ZGGG", votes: 2 },
      { number: 2, text: "ZSPD", votes: 1 },
    ],
    ...overrides,
  };
}

function detail(overrides: Partial<StaffPollDetail> = {}): StaffPollDetail {
  return {
    ...summary(),
    options: [
      { number: 1, text: "ZGGG", votes: 2, activeVotes: 1 },
      { number: 2, text: "ZSPD", votes: 1, activeVotes: 1 },
    ],
    activeMembers: 3,
    activeVoters: 2,
    ...overrides,
  };
}

function envelope(data: unknown) {
  return { status: 200, data, timestamp: "2026-10-29T00:00:00Z" };
}

describe("wire shape", () => {
  test("list sends the filters and reads the page", async () => {
    const page = { polls: [summary()], total: 51, page: 2, pageSize: 50 };
    const calls = mockFetch(200, envelope(page));
    expect(
      await listStaffPolls({ status: "open", platform: "discord", page: 2 }),
    ).toEqual({ ok: true, data: page });
    expect(calls[0]).toEqual({
      url: "/api/v1/super/poll?status=open&platform=discord&page=2",
      method: "GET",
      body: undefined,
    });
  });

  test("list without polls is an invalid response", async () => {
    mockFetch(200, envelope({}));
    const result = await listStaffPolls({
      status: "all",
      platform: "all",
      page: 1,
    });
    expect(result.ok).toBe(false);
  });

  test("detail unwraps data.poll with the active-member counts", async () => {
    const calls = mockFetch(200, envelope({ poll: detail() }));
    expect(await getStaffPoll(7)).toEqual({ ok: true, data: detail() });
    expect(calls[0].url).toBe("/api/v1/super/poll/7");
  });

  test("detail without the active-member counts is an invalid response", async () => {
    mockFetch(200, envelope({ poll: poll() }));
    expect((await getStaffPoll(7)).ok).toBe(false);
    const noVoters: Partial<StaffPollDetail> = detail();
    delete noVoters.activeVoters;
    mockFetch(200, envelope({ poll: noVoters }));
    expect((await getStaffPoll(7)).ok).toBe(false);
  });

  test("create posts exactly title, options and durationMinutes", async () => {
    const created = poll({
      platform: "global",
      communityHash: null,
      official: true,
    });
    const calls = mockFetch(201, envelope({ poll: created }));
    const draft = { title: "T", options: ["A", "B"], durationMinutes: 60 };
    expect(await createOfficialPoll(draft)).toEqual({
      ok: true,
      data: created,
    });
    expect(calls[0]).toEqual({
      url: "/api/v1/super/poll",
      method: "POST",
      body: draft,
    });
  });

  test("close posts to /close", async () => {
    const closed = poll({ closed: true, closedAt: "2026-10-29T01:00:00Z" });
    const calls = mockFetch(200, envelope({ poll: closed }));
    expect(await closeStaffPoll(7)).toEqual({ ok: true, data: closed });
    expect(calls[0]).toMatchObject({
      url: "/api/v1/super/poll/7/close",
      method: "POST",
    });
  });

  test("delete sends DELETE and requires deleted: true", async () => {
    const calls = mockFetch(200, envelope({ deleted: true }));
    expect(await deleteStaffPoll(7)).toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(calls[0]).toMatchObject({
      url: "/api/v1/super/poll/7",
      method: "DELETE",
    });
    mockFetch(200, envelope({}));
    expect((await deleteStaffPoll(7)).ok).toBe(false);
  });

  test("errors pass through", async () => {
    mockFetch(409, { error: "poll_closed", message: "closed" });
    const result = await closeStaffPoll(7);
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: "poll_closed",
    });
  });

  test("list path encodes every filter", () => {
    expect(pollListPath({ status: "all", platform: "all", page: 1 })).toBe(
      "/api/v1/super/poll?status=all&platform=all&page=1",
    );
  });
});

describe("classifyPollError", () => {
  const f = (error: string, status = 400) => ({
    ok: false as const,
    status,
    error,
    message: "",
  });

  test.each([
    ["poll_not_found", 404, "notFound"],
    ["poll_closed", 409, "closed"],
    ["invalid_poll", 400, "invalid"],
    ["invalid_request", 400, "invalid"],
    ["unauthorized", 401, "sessionExpired"],
    ["forbidden", 403, "forbidden"],
    ["network", 0, "network"],
    ["internal_error", 500, "failed"],
    ["http_error", 401, "sessionExpired"],
    ["http_error", 403, "forbidden"],
    ["toString", 500, "failed"],
  ])("%s (%i) → %s", (code, status, kind) => {
    expect(classifyPollError(f(code, status))).toBe(kind as never);
  });
});

describe("validatePollDraft", () => {
  const ok = { title: "T", options: ["A", "B"], durationMinutes: 60 };

  test("trims and drops blank rows", () => {
    expect(
      validatePollDraft({
        title: "  T ",
        options: [" A ", "", "  ", "B"],
        durationMinutes: 60,
      }),
    ).toEqual({ ok: true, draft: ok });
  });

  test("title boundaries in code points", () => {
    expect(validatePollDraft({ ...ok, title: " " })).toEqual({
      ok: false,
      errors: { title: "titleRequired" },
    });
    expect(
      validatePollDraft({ ...ok, title: "😀".repeat(POLL_TITLE_MAX) }).ok,
    ).toBe(true);
    expect(
      validatePollDraft({ ...ok, title: "x".repeat(POLL_TITLE_MAX + 1) }),
    ).toEqual({ ok: false, errors: { title: "titleTooLong" } });
  });

  test("option boundaries", () => {
    const err = (options: string[]) => {
      const result = validatePollDraft({ ...ok, options });
      return result.ok ? null : (result.errors.options ?? null);
    };
    expect(err(["A"])).toBe("optionsTooFew");
    expect(err(Array.from({ length: 10 }, (_, i) => `O${i}`))).toBeNull();
    expect(err(Array.from({ length: 11 }, (_, i) => `O${i}`))).toBe(
      "optionsTooMany",
    );
    expect(err(["A", "x".repeat(POLL_OPTION_MAX)])).toBeNull();
    expect(err(["A", "x".repeat(POLL_OPTION_MAX + 1)])).toBe("optionTooLong");
    expect(err(["A", " A"])).toBe("optionDuplicate");
    expect(err(["A", "a"])).toBeNull();
  });

  test.each([
    [0, false],
    [1, true],
    [POLL_DURATION_MAX, true],
    [POLL_DURATION_MAX + 1, false],
    [1.5, false],
    [Number.NaN, false],
  ])("duration %d → ok %p", (durationMinutes, valid) => {
    const result = validatePollDraft({ ...ok, durationMinutes });
    expect(result.ok).toBe(valid);
    if (!result.ok) expect(result.errors.duration).toBe("durationRange");
  });
});

describe("helpers", () => {
  test("shortHash is the first 8 hex characters", () => {
    expect(shortHash(summary().communityHash)).toBe("01234567");
    expect(shortHash(null)).toBeNull();
  });

  test("isPollOpen checks the clock", () => {
    const now = Date.parse("2026-10-29T00:00:00Z");
    expect(isPollOpen(summary(), now)).toBe(true);
    expect(isPollOpen(summary({ closed: true }), now)).toBe(false);
    expect(isPollOpen(summary(), Date.parse("2026-10-30T00:00:00Z"))).toBe(
      false,
    );
  });

  test("pageCount and optionPercent", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(optionPercent(1, 3)).toBe(33);
    expect(optionPercent(0, 0)).toBe(0);
  });

  test("memberShare rounds to one decimal, half up", () => {
    expect(memberShare(1, 3)).toBe(33.3);
    expect(memberShare(2, 3)).toBe(66.7);
    expect(memberShare(1, 16)).toBe(6.3);
    expect(memberShare(1, 8)).toBe(12.5);
    expect(memberShare(3, 3)).toBe(100);
    expect(memberShare(0, 3)).toBe(0);
  });

  test("memberShare is 0 without active members", () => {
    expect(memberShare(0, 0)).toBe(0);
    expect(memberShare(2, 0)).toBe(0);
  });

  test("pollTurnout shares each option and the not-voted rest", () => {
    expect(pollTurnout(detail())).toEqual({
      activeMembers: 3,
      options: [
        { number: 1, text: "ZGGG", activeVotes: 1, share: 33.3 },
        { number: 2, text: "ZSPD", activeVotes: 1, share: 33.3 },
      ],
      notVoted: 1,
      notVotedShare: 33.3,
    });
  });

  test("pollTurnout with no active members is all zero", () => {
    const turnout = pollTurnout(
      detail({
        activeMembers: 0,
        activeVoters: 0,
        options: [{ number: 1, text: "ZGGG", votes: 4, activeVotes: 0 }],
      }),
    );
    expect(turnout.options[0].share).toBe(0);
    expect(turnout.notVoted).toBe(0);
    expect(turnout.notVotedShare).toBe(0);
  });
});

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

describe("polls.manage dictionary", () => {
  test("exists in every locale with the same keys", () => {
    const reference = keys(getMessages("zh-cn", "polls.manage"));
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keys(getMessages(locale, "polls.manage"))).toEqual(reference);
    }
  });

  test("carries every error and the sidebar name", () => {
    for (const locale of LOCALES) {
      const errors = getMessages(locale, "polls.manage.errors");
      for (const kind of [...POLL_ERROR_KINDS, "load"]) {
        expect(typeof errors[kind]).toBe("string");
      }
      const form = getMessages(locale, "polls.manage.form.errors");
      for (const key of POLL_DRAFT_ERRORS) {
        expect(typeof form[key]).toBe("string");
      }
      expect(typeof getMessages(locale, "frame").pollsManage).toBe("string");
    }
  });
});
