# Manual Points Adjustment (can-portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/super/points` to can-portal. SUP/ADM grant and deduct a member's points, see the balance before and after, and reverse a manual entry once.

**Architecture:** An Astro shell page mounts one Vue island, `ManagePoints.vue`. The island calls can-api through this site's same-origin proxy allow-list. Form rules, wire types, paths and error mapping live in `src/lib/points.ts`, where `bun test` covers them. Strings go in a new `points.manage` namespace in all four dictionaries.

**Tech Stack:** Astro 7 SSR, Vue 3 `<script setup>`, `@jianyuelab-org/can-ui` 27.3.0, Tailwind v4, Bun (`bun test`, `bunx prettier`), vue-tsc.

**Spec:** `/Users/jhl/Documents/Dev/CeruleanAviationNetwork/docs/superpowers/specs/2026-10-07-manual-points-design.md` (section "can-portal")

## Global Constraints

- The page is `src/pages/super/points.astro` with the island `src/components/ManagePoints.vue`. Strings from namespace `points.manage`.
- `/super` is already gated at rating 11 (`src/lib/access.ts` `FLOORS`). Do not add a `FLOORS` row.
- SUP (11) and ADM (12) have identical rights. can-api guard: `WithSup`.
- Amount input bound: `1 ≤ |amount| ≤ 1000000`, non-zero integer. No business cap.
- A deduction may take the balance below zero. The confirmation shows it in red and does not block it.
- An operator cannot adjust their own points. Submit is disabled when the selected member is the signed-in user.
- Every entry has a public description (required, trimmed, 1–255 chars) and an internal note (optional, ≤ 255 chars, empty becomes null).
- The member sees the amount and the public description. The member never sees the operator or the note.
- Entries are append-only. A mistake is corrected by reversing it. A manual entry can be reversed once. A reversal cannot be reversed.
- `reference`: `crypto.randomUUID()` generated when the form opens, reused on retry, replaced after success.
- Envelope `{status, data, timestamp}`. Errors unenveloped `{error, message}`. All routes `WithSup`.
- `GET /api/v1/super/points/balance?username=` → `{username, balance}`. `404 not_found` if the user does not exist.
- `POST /api/v1/super/points/adjust` body `{username, amount, detail, note?, reference}` → `201 {entry: ManualEntry, balance}`. Duplicate `reference`: the existing row, `200`.
  - `400 invalid_amount` (amount not a non-zero integer or `|amount| > 1000000`), `400 invalid_detail` (trimmed detail not 1–255 chars), `400 invalid_request` (reference not a UUID), `403 self_adjust`, `404 not_found`.
- `POST /api/v1/super/points/{id}/reverse` body `{note?}` → `201 {entry: ManualEntry, balance}`.
  - `404 not_found` (id missing or `source ≠ "manual"`), `409 not_reversible` (row is itself a reversal), `409 already_reversed`, `403 self_adjust` (entry's member is the caller).
  - The new row: `amount = -original`, `reverses = id`, `reference = rev-<id>`, `detail = 撤销：<original detail>` truncated to 255.
- `GET /api/v1/super/points/manual?username=&cursor=&limit=` → `{entries: [ManualEntry], nextCursor | null}`. Rows with `source = "manual"`, newest first. `limit` default 50, max 100.
- `ManualEntry { id, username, amount, detail, note | null, operator, createdAt, reverses | null, reversedBy | null }`.
- Every error code above maps to a localised message.
- Member picker: `/api/v1/super/members?q=`, same as `AipAccess.vue` (debounced, stale responses dropped, `data.members`).
- Confirmations are in-page `Dialog`s, not `window.confirm`. Follow `ManageLottery.vue`.
- No database credential and no Secret. All data comes from can-api via `src/pages/api/v1/[...path].ts`. Every new proxy entry carries a `who`.
- User-facing strings exist in all four locales: `zh-cn`, `zh-tw`, `en-us`, `ja-jp`. Code comments follow the surrounding files (Chinese).
- `CLAUDE.md` is a symlink to `AGENTS.md`. Edit `AGENTS.md`.
- Use `bun` / `bunx` only for JS. The dictionary insert uses `python3` because the four JSON files round-trip through `json.dumps(..., ensure_ascii=False, indent=2)` byte for byte (checked on 2026-10-07).
- Gate: `bun run lint` (prettier check + `astro check` + vue-tsc + `bun test`) and `bun run build`. Run `bunx prettier --write <changed files>` before `lint`.
- Scratch files, if any, go in `can-portal/.temp/` (already in `.gitignore`), never `/tmp`. Delete it when done.
- Commits: Conventional Commits, on branch `feat/manual-points` in can-portal, each ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit text states what changed. No rationale, no emoji.
- Commit signing uses a YubiKey and can hang waiting for a touch. Run `git commit` under a timeout. If it hangs, commit with `--no-gpg-sign` and report that.
- Push practice, checked in `git log --first-parent main`: the lottery page (`174d71a`…`074cab4`) was committed and pushed straight to `main`; the five later changes (#22–#26) went through PR branches. This plan follows current practice: work on `feat/manual-points`, push the branch, open a PR with `gh pr create`. Merging to `main` deploys. The root pointer moves only after the merge.
- Do not merge the PR until can-api's points routes are deployed and its `db push` has landed (spec "Order": can-api, can-ui, can-web, then can-portal).

## File Structure

| File                                      | Action | Responsibility                                                                                 |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `src/lib/points.ts`                       | Create | Wire types, limits, form rules, sign toggle, body builders, paths, entry state, error mapping. |
| `src/lib/points.test.ts`                  | Create | `bun test` coverage of `points.ts`.                                                            |
| `src/lib/proxyAllowList.test.ts`          | Modify | Coverage of the four points entries and their neighbours.                                      |
| `src/pages/api/v1/[...path].ts`           | Modify | Allow-list the four points routes; name `ManagePoints.vue` on `super/members`.                 |
| `src/lib/pointsMessages.test.ts`          | Create | Dictionary parity across the four locales for `points.manage`, plus nav and home-card keys.    |
| `language/{zh-cn,zh-tw,en-us,ja-jp}.json` | Modify | `points.manage` namespace, `frame.pointsManage`, `portal.cards.points`.                        |
| `src/components/ManagePoints.vue`         | Create | The island: adjustment form, confirmation dialog, history table, reverse dialog.               |
| `src/pages/super/points.astro`            | Create | Astro shell; passes `sessionUserId`.                                                           |
| `src/lib/nav.ts`                          | Modify | Sidebar entry in the SUP list.                                                                 |
| `src/pages/index.astro`                   | Modify | Home card in the SUP group.                                                                    |
| `src/lib/access.test.ts`                  | Modify | Pin `/super/points` at rating 11.                                                              |
| `AGENTS.md`, `README.md`                  | Modify | Page tables; page count; dictionary note.                                                      |

---

### Task 0: Branch

**Files:** none.

- [ ] **Step 1: Create the branch from an up-to-date `main`**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git checkout main
git pull --ff-only origin main
git checkout -b feat/manual-points
git status --short --branch
```

Expected: `## feat/manual-points`, no other changes. Every commit in Tasks 1–5 lands on this branch.

---

### Task 1: Points form rules and wire types

**Files:**

- Create: `src/lib/points.ts`
- Test: `src/lib/points.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (all exported from `@/lib/points`):
  - `POINTS_LIMITS = { amount: 1_000_000, detail: 255, note: 255 } as const`
  - `HISTORY_PAGE_SIZE = 50`
  - `type Direction = "grant" | "deduct"`
  - `type EntryState = "active" | "reversed" | "reversal"`
  - `interface ManualEntry { id: number; username: string; amount: number; detail: string; note: string | null; operator: string; createdAt: string; reverses: number | null; reversedBy: number | null }`
  - `interface PointsBalance { username: string; balance: number }`
  - `interface AdjustResult { entry: ManualEntry; balance: number }`
  - `type Cursor = string | number`
  - `interface ManualPage { entries: ManualEntry[]; nextCursor: Cursor | null }`
  - `interface AdjustForm { username: string; direction: Direction; amount: string; detail: string; note: string }`
  - `type AdjustFormErrors = Partial<Record<"username" | "amount" | "detail" | "note", string>>`
  - `interface AdjustBody { username: string; amount: number; detail: string; note?: string; reference: string }`
  - `interface ReverseBody { note?: string }`
  - `emptyAdjustForm(): AdjustForm`
  - `newReference(): string`
  - `charCount(text: string): number`
  - `parseAmount(text: string): number | null`
  - `signedAmount(form: AdjustForm): number | null`
  - `isSelf(username: string, sessionUser: string): boolean`
  - `validateAdjust(form: AdjustForm, sessionUser: string): AdjustFormErrors`
  - `hasErrors(errors: AdjustFormErrors): boolean`
  - `adjustBody(form: AdjustForm, reference: string): AdjustBody`
  - `validateReverseNote(note: string): string | undefined`
  - `reverseBody(note: string): ReverseBody`
  - `projectedBalance(balance: number, amount: number): number`
  - `formatPoints(value: number): string`
  - `formatSigned(value: number): string`
  - `isReplay(entry: ManualEntry, body: AdjustBody): boolean`
  - `entryState(entry: ManualEntry): EntryState`
  - `canReverse(entry: ManualEntry, sessionUser: string): boolean`
  - `balancePath(username: string): string`
  - `manualPath(query: { username: string; cursor: Cursor | null; limit: number }): string`
  - `reversePath(id: number): string`
  - `mergeEntries(existing: ManualEntry[], incoming: ManualEntry[]): ManualEntry[]`
  - `errorKey(code: string): string` (returns a key under `points.manage.errors`)

- [ ] **Step 1: Write the failing test**

Create `src/lib/points.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  HISTORY_PAGE_SIZE,
  POINTS_LIMITS,
  adjustBody,
  balancePath,
  canReverse,
  charCount,
  emptyAdjustForm,
  entryState,
  errorKey,
  formatPoints,
  formatSigned,
  hasErrors,
  isReplay,
  isSelf,
  manualPath,
  mergeEntries,
  newReference,
  parseAmount,
  projectedBalance,
  reverseBody,
  reversePath,
  signedAmount,
  validateAdjust,
  validateReverseNote,
  type AdjustForm,
  type ManualEntry,
} from "./points";

const ME = "1001";
const REF = "3f1c2b8e-9d4a-4c1e-8b7f-2a6d5e4c3b21";

function form(overrides: Partial<AdjustForm> = {}): AdjustForm {
  return {
    ...emptyAdjustForm(),
    username: "2002",
    amount: "100",
    detail: "活动补发",
    ...overrides,
  };
}

function entry(overrides: Partial<ManualEntry> = {}): ManualEntry {
  return {
    id: 9,
    username: "2002",
    amount: 100,
    detail: "活动补发",
    note: null,
    operator: ME,
    createdAt: "2026-10-07T12:00:00Z",
    reverses: null,
    reversedBy: null,
    ...overrides,
  };
}

describe("limits", () => {
  test("match the can-api contract", () => {
    expect(POINTS_LIMITS).toEqual({
      amount: 1_000_000,
      detail: 255,
      note: 255,
    });
    expect(HISTORY_PAGE_SIZE).toBe(50);
  });
});

describe("emptyAdjustForm", () => {
  test("starts as a grant with nothing filled", () => {
    expect(emptyAdjustForm()).toEqual({
      username: "",
      direction: "grant",
      amount: "",
      detail: "",
      note: "",
    });
  });
});

describe("newReference", () => {
  test("is a v4 UUID and differs per call", () => {
    const a = newReference();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newReference()).not.toBe(a);
  });
});

describe("charCount", () => {
  test("counts code points, not UTF-16 units", () => {
    expect(charCount("abc")).toBe(3);
    expect(charCount("积分")).toBe(2);
    expect(charCount("😀")).toBe(1);
  });
});

describe("parseAmount", () => {
  test("accepts whole numbers from 1 to 1000000", () => {
    expect(parseAmount("1")).toBe(1);
    expect(parseAmount(" 250 ")).toBe(250);
    expect(parseAmount("1000000")).toBe(1_000_000);
  });

  test("rejects zero, signs, decimals, exponents and anything above the bound", () => {
    for (const bad of [
      "",
      " ",
      "0",
      "00",
      "-5",
      "+5",
      "1.5",
      "1e3",
      "abc",
      "1000001",
    ]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("signedAmount", () => {
  test("the toggle sets the sign", () => {
    expect(signedAmount(form({ direction: "grant", amount: "30" }))).toBe(30);
    expect(signedAmount(form({ direction: "deduct", amount: "30" }))).toBe(-30);
  });

  test("an invalid amount has no signed value", () => {
    expect(signedAmount(form({ amount: "0" }))).toBeNull();
    expect(signedAmount(form({ direction: "deduct", amount: "" }))).toBeNull();
  });
});

describe("isSelf", () => {
  test("compares trimmed usernames and never matches an empty one", () => {
    expect(isSelf("1001", ME)).toBe(true);
    expect(isSelf(" 1001 ", ME)).toBe(true);
    expect(isSelf("2002", ME)).toBe(false);
    expect(isSelf("", "")).toBe(false);
    expect(isSelf("1001", "")).toBe(false);
  });
});

describe("validateAdjust", () => {
  test("accepts a complete grant and a complete deduction", () => {
    expect(validateAdjust(form(), ME)).toEqual({});
    expect(validateAdjust(form({ direction: "deduct" }), ME)).toEqual({});
    expect(hasErrors(validateAdjust(form(), ME))).toBe(false);
  });

  test("requires a member who is not the operator", () => {
    expect(validateAdjust(form({ username: "" }), ME).username).toBe(
      "memberRequired",
    );
    expect(validateAdjust(form({ username: ME }), ME).username).toBe(
      "selfAdjust",
    );
  });

  test("requires an amount inside the bound", () => {
    expect(validateAdjust(form({ amount: "  " }), ME).amount).toBe(
      "amountRequired",
    );
    expect(validateAdjust(form({ amount: "0" }), ME).amount).toBe("amount");
    expect(validateAdjust(form({ amount: "1000001" }), ME).amount).toBe(
      "amount",
    );
    expect(validateAdjust(form({ amount: "1.5" }), ME).amount).toBe("amount");
  });

  test("requires a public description of 1 to 255 characters", () => {
    expect(validateAdjust(form({ detail: "   " }), ME).detail).toBe(
      "detailRequired",
    );
    expect(validateAdjust(form({ detail: "x".repeat(256) }), ME).detail).toBe(
      "detailLength",
    );
    expect(
      validateAdjust(form({ detail: "x".repeat(255) }), ME).detail,
    ).toBeUndefined();
    expect(
      validateAdjust(form({ detail: "😀".repeat(255) }), ME).detail,
    ).toBeUndefined();
  });

  test("caps the internal note at 255 characters", () => {
    expect(validateAdjust(form({ note: "x".repeat(256) }), ME).note).toBe(
      "noteLength",
    );
    expect(
      validateAdjust(form({ note: "x".repeat(255) }), ME).note,
    ).toBeUndefined();
  });
});

describe("adjustBody", () => {
  test("sends a signed number, trimmed text and no note when blank", () => {
    const body = adjustBody(
      form({
        direction: "deduct",
        amount: " 30 ",
        detail: " 误发 ",
        note: "  ",
      }),
      REF,
    );
    expect(body).toEqual({
      username: "2002",
      amount: -30,
      detail: "误发",
      reference: REF,
    });
    expect("note" in body).toBe(false);
  });

  test("keeps a non-blank note, trimmed", () => {
    expect(adjustBody(form({ note: " 工单 42 " }), REF).note).toBe("工单 42");
  });

  test("refuses an invalid amount", () => {
    expect(() => adjustBody(form({ amount: "0" }), REF)).toThrow();
  });
});

describe("reverse note", () => {
  test("is optional and capped at 255 characters", () => {
    expect(validateReverseNote("")).toBeUndefined();
    expect(validateReverseNote("x".repeat(255))).toBeUndefined();
    expect(validateReverseNote("x".repeat(256))).toBe("noteLength");
  });

  test("a blank note is left out of the body", () => {
    expect(reverseBody("  ")).toEqual({});
    expect(reverseBody(" 重复发放 ")).toEqual({ note: "重复发放" });
  });
});

describe("balances and numbers", () => {
  test("projects the balance, negative allowed", () => {
    expect(projectedBalance(50, 30)).toBe(80);
    expect(projectedBalance(50, -80)).toBe(-30);
  });

  test("formats with grouping and an explicit plus sign", () => {
    expect(formatPoints(1234567)).toBe("1,234,567");
    expect(formatPoints(-30)).toBe("-30");
    expect(formatSigned(1000)).toBe("+1,000");
    expect(formatSigned(-5)).toBe("-5");
    expect(formatSigned(0)).toBe("0");
  });
});

describe("isReplay", () => {
  const body = adjustBody(form(), REF);

  test("the entry that was asked for is not a replay", () => {
    expect(isReplay(entry(), body)).toBe(false);
  });

  test("an entry that differs from the request is a replay", () => {
    expect(isReplay(entry({ amount: 50 }), body)).toBe(true);
    expect(isReplay(entry({ username: "3003" }), body)).toBe(true);
    expect(isReplay(entry({ detail: "别的说明" }), body)).toBe(true);
  });
});

describe("entryState / canReverse", () => {
  test("classifies entries", () => {
    expect(entryState(entry())).toBe("active");
    expect(entryState(entry({ reversedBy: 12 }))).toBe("reversed");
    expect(entryState(entry({ reverses: 3, amount: -100 }))).toBe("reversal");
  });

  test("only an active entry of another member can be reversed", () => {
    expect(canReverse(entry(), ME)).toBe(true);
    expect(canReverse(entry({ reversedBy: 12 }), ME)).toBe(false);
    expect(canReverse(entry({ reverses: 3 }), ME)).toBe(false);
    expect(canReverse(entry({ username: ME }), ME)).toBe(false);
  });
});

describe("paths", () => {
  test("balance", () => {
    expect(balancePath("2002")).toBe(
      "/api/v1/super/points/balance?username=2002",
    );
  });

  test("history leaves out a blank filter and a missing cursor", () => {
    expect(manualPath({ username: "", cursor: null, limit: 50 })).toBe(
      "/api/v1/super/points/manual?limit=50",
    );
    expect(manualPath({ username: " 2002 ", cursor: "abc", limit: 50 })).toBe(
      "/api/v1/super/points/manual?username=2002&cursor=abc&limit=50",
    );
    expect(manualPath({ username: "", cursor: 42, limit: 100 })).toBe(
      "/api/v1/super/points/manual?cursor=42&limit=100",
    );
  });

  test("reverse", () => {
    expect(reversePath(9)).toBe("/api/v1/super/points/9/reverse");
  });
});

describe("mergeEntries", () => {
  test("appends the next page and drops rows already shown", () => {
    const merged = mergeEntries(
      [entry({ id: 9 }), entry({ id: 8 })],
      [entry({ id: 8 }), entry({ id: 7 })],
    );
    expect(merged.map((e) => e.id)).toEqual([9, 8, 7]);
  });
});

describe("errorKey", () => {
  test("maps every documented can-api code", () => {
    expect(errorKey("invalid_amount")).toBe("invalidAmount");
    expect(errorKey("invalid_detail")).toBe("invalidDetail");
    expect(errorKey("invalid_request")).toBe("invalidRequest");
    expect(errorKey("self_adjust")).toBe("selfAdjust");
    expect(errorKey("not_found")).toBe("notFound");
    expect(errorKey("not_reversible")).toBe("notReversible");
    expect(errorKey("already_reversed")).toBe("alreadyReversed");
    expect(errorKey("network")).toBe("network");
  });

  test("falls back for anything else, prototype names included", () => {
    expect(errorKey("http_error")).toBe("actionFailed");
    expect(errorKey("toString")).toBe("actionFailed");
    expect(errorKey("__proto__")).toBe("actionFailed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/points.test.ts`
Expected: FAIL with `Cannot find module './points'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/points.ts`:

```ts
/**
 * 积分手动调整页的线上形状和表单规则。
 *
 * 浏览器安全：不 import `src/server` 下的任何东西。形状照 can-api 的
 * `/api/v1/super/points/*` 契约写 —— camelCase，时间是 RFC3339。规则放在这里
 * 而不是岛屿里，是为了让 `bun test` 钉得住它们。
 */

/** 金额上下界、说明和备注长度，和 can-api 的校验同一组数。 */
export const POINTS_LIMITS = {
  amount: 1_000_000,
  detail: 255,
  note: 255,
} as const;

/** 历史记录每页条数。can-api 默认 50，上限 100。 */
export const HISTORY_PAGE_SIZE = 50;

/** 发放或扣除。表单上是一个开关，金额框里永远是正数。 */
export type Direction = "grant" | "deduct";

/** 一行记录的状态：有效、已被撤销、它本身是一笔撤销。 */
export type EntryState = "active" | "reversed" | "reversal";

export interface ManualEntry {
  id: number;
  username: string;
  /** 带符号。扣除和撤销是负数。 */
  amount: number;
  /** 公开说明，成员看得到。 */
  detail: string;
  /** 内部备注，成员看不到。 */
  note: string | null;
  /** 操作人的 CAN ID。 */
  operator: string;
  createdAt: string;
  /** 这一行撤销的是哪一行。 */
  reverses: number | null;
  /** 撤销这一行的是哪一行。 */
  reversedBy: number | null;
}

export interface PointsBalance {
  username: string;
  balance: number;
}

/** adjust 和 reverse 的响应：新记录，以及入账后的余额。 */
export interface AdjustResult {
  entry: ManualEntry;
  balance: number;
}

/** 游标对这一侧是不透明的：原样拿到，原样送回。 */
export type Cursor = string | number;

export interface ManualPage {
  entries: ManualEntry[];
  nextCursor: Cursor | null;
}

export interface AdjustForm {
  /** 选中的成员；空串表示还没选。 */
  username: string;
  direction: Direction;
  /** 输入框里的正整数，字符串。 */
  amount: string;
  detail: string;
  note: string;
}

export type AdjustFormErrors = Partial<
  Record<"username" | "amount" | "detail" | "note", string>
>;

export interface AdjustBody {
  username: string;
  amount: number;
  detail: string;
  note?: string;
  reference: string;
}

export interface ReverseBody {
  note?: string;
}

export function emptyAdjustForm(): AdjustForm {
  return {
    username: "",
    direction: "grant",
    amount: "",
    detail: "",
    note: "",
  };
}

/** 幂等键。表单打开时生成，失败重试沿用，成功后换新。 */
export function newReference(): string {
  return crypto.randomUUID();
}

/** 按码点数字符，和 Go 的 rune 计数一致；`.length` 会把一个 emoji 数成两个。 */
export function charCount(text: string): number {
  return [...text].length;
}

/** 输入框里的正整数。不是 1 到上限之间的整数时返回 null。 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  if (value < 1 || value > POINTS_LIMITS.amount) return null;
  return value;
}

/** 开关决定符号。金额无效时返回 null。 */
export function signedAmount(form: AdjustForm): number | null {
  const value = parseAmount(form.amount);
  if (value === null) return null;
  return form.direction === "deduct" ? -value : value;
}

/** 是不是在调整自己。会话读不出用户名时一律当作不是 —— can-api 那道 `self_adjust` 才是边界。 */
export function isSelf(username: string, sessionUser: string): boolean {
  const a = username.trim();
  const b = sessionUser.trim();
  return a !== "" && a === b;
}

/**
 * 校验表单。错误值是 `points.manage.errors` 下的键。
 *
 * 规则和 can-api 相同，在这里先判，省一次往返。
 */
export function validateAdjust(
  form: AdjustForm,
  sessionUser: string,
): AdjustFormErrors {
  const errors: AdjustFormErrors = {};

  if (!form.username.trim()) errors.username = "memberRequired";
  else if (isSelf(form.username, sessionUser)) errors.username = "selfAdjust";

  if (!form.amount.trim()) errors.amount = "amountRequired";
  else if (parseAmount(form.amount) === null) errors.amount = "amount";

  const detail = form.detail.trim();
  if (!detail) errors.detail = "detailRequired";
  else if (charCount(detail) > POINTS_LIMITS.detail)
    errors.detail = "detailLength";

  if (charCount(form.note.trim()) > POINTS_LIMITS.note)
    errors.note = "noteLength";

  return errors;
}

export function hasErrors(errors: AdjustFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * 请求体。只在 validateAdjust 通过之后调用。
 *
 * 金额以带符号的数字送出 —— 表单里是 `<input>` 绑的字符串，can-api 那边是
 * Go 的 int。空备注不送这个键，can-api 把缺省和空串都存成 null。
 */
export function adjustBody(form: AdjustForm, reference: string): AdjustBody {
  const amount = signedAmount(form);
  if (amount === null) throw new Error("adjustBody: invalid amount");
  const note = form.note.trim();
  return {
    username: form.username.trim(),
    amount,
    detail: form.detail.trim(),
    ...(note ? { note } : {}),
    reference,
  };
}

/** 撤销时的内部备注。返回 `points.manage.errors` 下的键，合法时 undefined。 */
export function validateReverseNote(note: string): string | undefined {
  return charCount(note.trim()) > POINTS_LIMITS.note ? "noteLength" : undefined;
}

export function reverseBody(note: string): ReverseBody {
  const trimmed = note.trim();
  return trimmed ? { note: trimmed } : {};
}

/** 入账后的余额。可以是负数，扣除不受余额限制。 */
export function projectedBalance(balance: number, amount: number): number {
  return balance + amount;
}

/** 千分位。固定 en-US：积分在四种语言下都写成阿拉伯数字加逗号。 */
export function formatPoints(value: number): string {
  return value.toLocaleString("en-US");
}

/** 带符号的金额：正数显式加 `+`。 */
export function formatSigned(value: number): string {
  return value > 0 ? `+${formatPoints(value)}` : formatPoints(value);
}

/**
 * 返回的记录是不是一次重放。
 *
 * 重复的 reference 会让 can-api 返回原来那一行（200）。如果重试前改过表单，那
 * 一行和这次提交的不一样 —— 什么都没有新记，界面必须说出来。
 */
export function isReplay(entry: ManualEntry, body: AdjustBody): boolean {
  return (
    entry.username !== body.username ||
    entry.amount !== body.amount ||
    entry.detail !== body.detail
  );
}

export function entryState(entry: ManualEntry): EntryState {
  if (entry.reverses !== null) return "reversal";
  if (entry.reversedBy !== null) return "reversed";
  return "active";
}

/** 只有有效的、不是自己的记录能撤销。撤销记录本身不能再撤销。 */
export function canReverse(entry: ManualEntry, sessionUser: string): boolean {
  return entryState(entry) === "active" && !isSelf(entry.username, sessionUser);
}

export function balancePath(username: string): string {
  const query = new URLSearchParams({ username: username.trim() });
  return `/api/v1/super/points/balance?${query}`;
}

export function manualPath(query: {
  username: string;
  cursor: Cursor | null;
  limit: number;
}): string {
  const params = new URLSearchParams();
  const username = query.username.trim();
  if (username) params.set("username", username);
  if (query.cursor !== null) params.set("cursor", String(query.cursor));
  params.set("limit", String(query.limit));
  return `/api/v1/super/points/manual?${params}`;
}

export function reversePath(id: number): string {
  return `/api/v1/super/points/${id}/reverse`;
}

/**
 * 接上下一页。按 id 去重：两次翻页之间有人新记了一笔，游标那一侧的边界会往后
 * 挪，同一行可能在两页里各出现一次。
 */
export function mergeEntries(
  existing: ManualEntry[],
  incoming: ManualEntry[],
): ManualEntry[] {
  const seen = new Set(existing.map((e) => e.id));
  return [...existing, ...incoming.filter((e) => !seen.has(e.id))];
}

const ERROR_KEYS: Record<string, string> = {
  invalid_amount: "invalidAmount",
  invalid_detail: "invalidDetail",
  invalid_request: "invalidRequest",
  self_adjust: "selfAdjust",
  not_found: "notFound",
  not_reversible: "notReversible",
  already_reversed: "alreadyReversed",
  network: "network",
};

/**
 * can-api 的错误码 → `points.manage.errors` 下的键。
 *
 * 走 `Object.hasOwn`：`ERROR_KEYS["toString"]` 会拿到一个函数，理由和反代的
 * `lookup()` 一样。
 */
export function errorKey(code: string): string {
  const key = Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : undefined;
  return key ?? "actionFailed";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/points.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the gate**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
bunx prettier --write src/lib/points.ts src/lib/points.test.ts
bun run lint
```

Expected: prettier check passes, `astro check` 0 errors, vue-tsc clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git add src/lib/points.ts src/lib/points.test.ts
git commit -m "feat(points): add form rules and wire types for manual adjustments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Proxy allow-list for the points routes

**Files:**

- Modify: `src/pages/api/v1/[...path].ts` (`ALLOW_LIST`: the `super/members` entry and a new block after `super/lottery`; `ALLOW_PATTERNS`: a new entry after the `super\/lottery\/…\/(publish|cancel)` entry)
- Test: `src/lib/proxyAllowList.test.ts`

**Interfaces:**

- Consumes: `lookup(path: string): Allowed | undefined` from `src/pages/api/v1/[...path].ts`.
- Produces: the browser can call, same-origin:
  - `GET /api/v1/super/points/balance`
  - `POST /api/v1/super/points/adjust`
  - `GET /api/v1/super/points/manual`
  - `POST /api/v1/super/points/{id}/reverse`

  No other points path or method is forwarded.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/proxyAllowList.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/proxyAllowList.test.ts`
Expected: FAIL in "积分调整" — `expect(received).toEqual(expected)` with received `undefined`.

- [ ] **Step 3: Name the page on the member search entry**

In `ALLOW_LIST`, replace:

```ts
  "super/members": {
    methods: ["GET"],
    who: "ManageFeedback.vue 成员搜索 / AipAccess.vue 挑人授权",
  },
```

with:

```ts
  "super/members": {
    methods: ["GET"],
    who: "ManageFeedback.vue 成员搜索 / AipAccess.vue 挑人授权 / ManagePoints.vue 挑人调积分",
  },
```

- [ ] **Step 4: Add the three exact entries**

In `ALLOW_LIST`, directly after the `"super/lottery"` entry, add:

```ts
  // 积分手动调整（`/super/points`）。can-api 那边四条都是 `WithSup`。撤销在下面
  // 的模式里。
  "super/points/balance": {
    methods: ["GET"],
    who: "ManagePoints.vue 选中成员后读余额",
  },
  "super/points/adjust": {
    methods: ["POST"],
    who: "ManagePoints.vue 发放 / 扣除",
  },
  "super/points/manual": {
    methods: ["GET"],
    who: "ManagePoints.vue 调整记录（按成员筛选、游标翻页）",
  },
```

- [ ] **Step 5: Add the reverse pattern**

In `ALLOW_PATTERNS`, directly after the `super\/lottery\/[0-9]{1,20}\/(publish|cancel)` entry, add:

```ts
  {
    // 只有 reverse 一个动作，写死而不是 `[a-z]+`。
    test: /^super\/points\/[0-9]{1,20}\/reverse$/,
    methods: ["POST"],
    who: "ManagePoints.vue 撤销一笔手动调整",
  },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/proxyAllowList.test.ts`
Expected: PASS, both describe blocks green.

- [ ] **Step 7: Run the gate**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
bunx prettier --write "src/pages/api/v1/[...path].ts" src/lib/proxyAllowList.test.ts
bun run lint
```

Expected: passes.

- [ ] **Step 8: Commit**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git add "src/pages/api/v1/[...path].ts" src/lib/proxyAllowList.test.ts
git commit -m "feat(proxy): forward the super points routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dictionary strings in four locales

**Files:**

- Modify: `language/zh-cn.json`, `language/zh-tw.json`, `language/en-us.json`, `language/ja-jp.json`
- Test: `src/lib/pointsMessages.test.ts`

**Interfaces:**

- Consumes: `errorKey(code)` from Task 1 (`@/lib/points`); `getMessages(locale, namespace)` and `LOCALES` from `@/lib/i18n`.
- Produces:
  - Namespace `points.manage` (read with `getMessages(locale, "points.manage")`). Keys used by Task 4: `title`, `description`, `loading`, `close`, `timeWithLocal`, `form.*`, `confirm.*`, `reverse.*`, `history.*` (incl. `history.columns.*`, `history.status.{active,reversed,reversal}`), `done.*`, `errors.*`.
  - `frame.pointsManage` (sidebar, Task 5).
  - `portal.cards.points` (home card, Task 5).

- [ ] **Step 1: Write the failing test**

Create `src/lib/pointsMessages.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { getMessages, LOCALES } from "./i18n";
import { errorKey } from "./points";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

/** 岛屿会显示的每一个错误键：表单校验的、can-api 错误码映射的、页面自己的。 */
const ERROR_KEYS = [
  "load",
  "balance",
  "memberRequired",
  "amountRequired",
  "amount",
  "detailRequired",
  "detailLength",
  "noteLength",
  "selfAdjust",
  ...[
    "invalid_amount",
    "invalid_detail",
    "invalid_request",
    "self_adjust",
    "not_found",
    "not_reversible",
    "already_reversed",
    "network",
    "anything_else",
  ].map(errorKey),
];

describe("points.manage dictionary", () => {
  test("exists in every locale with the same keys", () => {
    const reference = keys(getMessages("zh-cn", "points.manage"));
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      expect(keys(getMessages(locale, "points.manage"))).toEqual(reference);
    }
  });

  test("carries every error the page can show", () => {
    for (const locale of LOCALES) {
      const errors = getMessages(locale, "points.manage.errors");
      for (const key of ERROR_KEYS) {
        expect(typeof errors[key]).toBe("string");
      }
    }
  });

  test("carries a label for every entry state", () => {
    for (const locale of LOCALES) {
      const status = getMessages(locale, "points.manage.history.status");
      for (const key of ["active", "reversed", "reversal"]) {
        expect(typeof status[key]).toBe("string");
      }
    }
  });

  test("names the page in the sidebar and on the home page", () => {
    for (const locale of LOCALES) {
      expect(typeof getMessages(locale, "frame").pointsManage).toBe("string");
      expect(typeof getMessages(locale, "portal.cards").points).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/pointsMessages.test.ts`
Expected: FAIL — `expect(received).toBeGreaterThan(0)` with received `0`.

- [ ] **Step 3: Insert the strings**

The script inserts `points` after `lottery`, `frame.pointsManage` after `frame.lotteryManage`, and `portal.cards.points` after `portal.cards.lottery`.

Run from the repository root:

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
python3 - <<'PY'
import json

def insert_after(d, after, key, value):
    out = {}
    for k, v in d.items():
        out[k] = v
        if k == after:
            out[key] = value
    if key not in out:
        out[key] = value
    return out

STRINGS = {
  "zh-cn": {
    "frame": "积分调整",
    "card": "为成员手动发放或扣除积分，撤销误操作。",
    "manage": {
      "title": "积分调整",
      "description": "手动为成员发放或扣除积分。每笔记录只追加不修改，记错了就撤销。",
      "loading": "加载中…",
      "close": "关闭",
      "timeWithLocal": "{zulu} · 本地 {local}",
      "form": {"title": "调整积分", "help": "成员会看到金额和公开说明，看不到操作人和内部备注。", "search": "搜索成员", "searchPlaceholder": "CAN ID 或姓名…", "noMatches": "没有匹配的成员。", "select": "选择", "change": "更换成员", "balance": "当前余额 {balance}", "balanceLoading": "正在读取余额…", "direction": "方向", "grant": "发放", "deduct": "扣除", "amount": "积分", "amountHint": "1 到 1,000,000 之间的整数。", "detail": "公开说明", "detailHint": "成员会在积分明细里看到这段话。", "note": "内部备注（可选）", "noteHint": "只有 SUP 和 ADM 看得到。", "submit": "检查并提交"},
      "confirm": {"title": "确认调整", "member": "成员", "amount": "金额", "balance": "余额", "unknownBalance": "—", "negative": "调整后余额为负数。", "action": "确认调整", "keep": "返回"},
      "reverse": {"title": "撤销调整", "body": "撤销 #{id}？系统会记一笔 {amount} 的反向记录，原记录保留。", "note": "内部备注（可选）", "action": "确认撤销", "keep": "返回"},
      "history": {"title": "调整记录", "filter": "按成员筛选", "filterPlaceholder": "CAN ID", "apply": "筛选", "clear": "清除", "empty": "还没有手动调整记录", "emptyHint": "上面提交的调整会出现在这里。", "more": "加载更多", "columns": {"time": "时间", "member": "成员", "amount": "金额", "detail": "公开说明", "note": "内部备注", "operator": "操作人", "status": "状态"}, "status": {"active": "有效", "reversed": "已撤销", "reversal": "撤销记录"}, "reversedBy": "由 #{id} 撤销", "reverses": "撤销 #{id}", "reverseAction": "撤销"},
      "done": {"adjusted": "已为 {member} 记入 {amount}，当前余额 {balance}。", "replayed": "这笔请求之前已经记入（{amount}），没有重复入账。请先核对下方记录。", "reversed": "已撤销 #{id}，{member} 当前余额 {balance}。"},
      "errors": {"load": "无法加载调整记录。", "balance": "无法读取该成员的余额。", "memberRequired": "请先选择成员。", "amountRequired": "请填写积分。", "amount": "积分必须是 1 到 1,000,000 之间的整数。", "detailRequired": "请填写公开说明。", "detailLength": "公开说明不能超过 255 个字符。", "noteLength": "内部备注不能超过 255 个字符。", "selfAdjust": "不能调整自己的积分。", "invalidAmount": "积分必须是 1 到 1,000,000 之间的非零整数。", "invalidDetail": "公开说明必须是 1 到 255 个字符。", "invalidRequest": "请求有误，请刷新页面后重试。", "notFound": "成员或记录不存在。", "notReversible": "撤销记录不能再撤销。", "alreadyReversed": "这笔调整已经被撤销过了。", "network": "网络连接失败，请稍后再试。已填写的内容会保留，重试不会重复入账。", "actionFailed": "操作失败，请稍后重试。"}
    }
  },
  "zh-tw": {
    "frame": "積分調整",
    "card": "為成員手動發放或扣除積分，撤銷誤操作。",
    "manage": {
      "title": "積分調整",
      "description": "手動為成員發放或扣除積分。每筆紀錄只追加不修改，記錯了就撤銷。",
      "loading": "載入中…",
      "close": "關閉",
      "timeWithLocal": "{zulu} · 本地 {local}",
      "form": {"title": "調整積分", "help": "成員會看到金額和公開說明，看不到操作人和內部備註。", "search": "搜尋成員", "searchPlaceholder": "CAN ID 或姓名…", "noMatches": "沒有符合的成員。", "select": "選擇", "change": "更換成員", "balance": "目前餘額 {balance}", "balanceLoading": "正在讀取餘額…", "direction": "方向", "grant": "發放", "deduct": "扣除", "amount": "積分", "amountHint": "1 到 1,000,000 之間的整數。", "detail": "公開說明", "detailHint": "成員會在積分明細裡看到這段話。", "note": "內部備註（選填）", "noteHint": "只有 SUP 和 ADM 看得到。", "submit": "檢查並送出"},
      "confirm": {"title": "確認調整", "member": "成員", "amount": "金額", "balance": "餘額", "unknownBalance": "—", "negative": "調整後餘額為負數。", "action": "確認調整", "keep": "返回"},
      "reverse": {"title": "撤銷調整", "body": "撤銷 #{id}？系統會記一筆 {amount} 的反向紀錄，原紀錄保留。", "note": "內部備註（選填）", "action": "確認撤銷", "keep": "返回"},
      "history": {"title": "調整紀錄", "filter": "依成員篩選", "filterPlaceholder": "CAN ID", "apply": "篩選", "clear": "清除", "empty": "還沒有手動調整紀錄", "emptyHint": "上面送出的調整會出現在這裡。", "more": "載入更多", "columns": {"time": "時間", "member": "成員", "amount": "金額", "detail": "公開說明", "note": "內部備註", "operator": "操作人", "status": "狀態"}, "status": {"active": "有效", "reversed": "已撤銷", "reversal": "撤銷紀錄"}, "reversedBy": "由 #{id} 撤銷", "reverses": "撤銷 #{id}", "reverseAction": "撤銷"},
      "done": {"adjusted": "已為 {member} 記入 {amount}，目前餘額 {balance}。", "replayed": "這筆請求先前已經記入（{amount}），沒有重複入帳。請先核對下方紀錄。", "reversed": "已撤銷 #{id}，{member} 目前餘額 {balance}。"},
      "errors": {"load": "無法載入調整紀錄。", "balance": "無法讀取該成員的餘額。", "memberRequired": "請先選擇成員。", "amountRequired": "請填寫積分。", "amount": "積分必須是 1 到 1,000,000 之間的整數。", "detailRequired": "請填寫公開說明。", "detailLength": "公開說明不能超過 255 個字元。", "noteLength": "內部備註不能超過 255 個字元。", "selfAdjust": "不能調整自己的積分。", "invalidAmount": "積分必須是 1 到 1,000,000 之間的非零整數。", "invalidDetail": "公開說明必須是 1 到 255 個字元。", "invalidRequest": "請求有誤，請重新整理頁面後重試。", "notFound": "成員或紀錄不存在。", "notReversible": "撤銷紀錄不能再撤銷。", "alreadyReversed": "這筆調整已經被撤銷過了。", "network": "網路連線失敗，請稍後再試。已填寫的內容會保留，重試不會重複入帳。", "actionFailed": "操作失敗，請稍後重試。"}
    }
  },
  "en-us": {
    "frame": "Points adjustment",
    "card": "Grant or deduct member points by hand, and reverse mistakes.",
    "manage": {
      "title": "Points adjustment",
      "description": "Grant or deduct points by hand. Entries are never edited; a mistake is reversed.",
      "loading": "Loading…",
      "close": "Close",
      "timeWithLocal": "{zulu} · local {local}",
      "form": {"title": "Adjust points", "help": "The member sees the amount and the public description, not the operator or the internal note.", "search": "Find member", "searchPlaceholder": "CAN ID or name…", "noMatches": "No matching members.", "select": "Select", "change": "Change member", "balance": "Balance {balance}", "balanceLoading": "Loading balance…", "direction": "Direction", "grant": "Grant", "deduct": "Deduct", "amount": "Points", "amountHint": "A whole number from 1 to 1,000,000.", "detail": "Public description", "detailHint": "Shown to the member in their points history.", "note": "Internal note (optional)", "noteHint": "Only SUP and ADM can see this.", "submit": "Review"},
      "confirm": {"title": "Confirm adjustment", "member": "Member", "amount": "Amount", "balance": "Balance", "unknownBalance": "—", "negative": "The balance will be negative after this adjustment.", "action": "Confirm", "keep": "Back"},
      "reverse": {"title": "Reverse adjustment", "body": "Reverse #{id}? A matching entry of {amount} is recorded. The original stays.", "note": "Internal note (optional)", "action": "Reverse", "keep": "Back"},
      "history": {"title": "Adjustments", "filter": "Filter by member", "filterPlaceholder": "CAN ID", "apply": "Filter", "clear": "Clear", "empty": "No manual adjustments yet", "emptyHint": "Adjustments submitted above appear here.", "more": "Load more", "columns": {"time": "Time", "member": "Member", "amount": "Amount", "detail": "Public description", "note": "Internal note", "operator": "Operator", "status": "Status"}, "status": {"active": "Active", "reversed": "Reversed", "reversal": "Reversal"}, "reversedBy": "Reversed by #{id}", "reverses": "Reverses #{id}", "reverseAction": "Reverse"},
      "done": {"adjusted": "Recorded {amount} for {member}. Balance is now {balance}.", "replayed": "This request was already recorded earlier ({amount}). Nothing was added twice. Check the history below.", "reversed": "Reversed #{id}. {member}'s balance is now {balance}."},
      "errors": {"load": "Could not load the adjustments.", "balance": "Could not load this member's balance.", "memberRequired": "Select a member first.", "amountRequired": "Enter the points.", "amount": "Points must be a whole number from 1 to 1,000,000.", "detailRequired": "Enter a public description.", "detailLength": "The public description must be at most 255 characters.", "noteLength": "The internal note must be at most 255 characters.", "selfAdjust": "You cannot adjust your own points.", "invalidAmount": "Points must be a non-zero whole number up to 1,000,000.", "invalidDetail": "The public description must be 1 to 255 characters.", "invalidRequest": "The request was invalid. Reload the page and try again.", "notFound": "The member or entry does not exist.", "notReversible": "A reversal cannot be reversed.", "alreadyReversed": "This adjustment has already been reversed.", "network": "Network error. Try again later. The form is kept, and retrying will not record it twice.", "actionFailed": "Something went wrong. Try again later."}
    }
  },
  "ja-jp": {
    "frame": "ポイント調整",
    "card": "メンバーのポイントを手動で付与・減算し、誤りを取り消します。",
    "manage": {
      "title": "ポイント調整",
      "description": "メンバーのポイントを手動で付与・減算します。記録は変更せず、誤りは取り消しで直します。",
      "loading": "読み込み中…",
      "close": "閉じる",
      "timeWithLocal": "{zulu} · 現地 {local}",
      "form": {"title": "ポイントを調整", "help": "メンバーには金額と公開説明が表示されます。操作者と内部メモは表示されません。", "search": "メンバーを検索", "searchPlaceholder": "CAN ID または氏名…", "noMatches": "該当するメンバーはいません。", "select": "選択", "change": "メンバーを変更", "balance": "現在の残高 {balance}", "balanceLoading": "残高を読み込み中…", "direction": "種類", "grant": "付与", "deduct": "減算", "amount": "ポイント", "amountHint": "1 から 1,000,000 までの整数。", "detail": "公開説明", "detailHint": "メンバーのポイント履歴に表示されます。", "note": "内部メモ（任意）", "noteHint": "SUP と ADM だけが閲覧できます。", "submit": "確認へ"},
      "confirm": {"title": "調整の確認", "member": "メンバー", "amount": "金額", "balance": "残高", "unknownBalance": "—", "negative": "調整後の残高はマイナスになります。", "action": "調整する", "keep": "戻る"},
      "reverse": {"title": "調整の取り消し", "body": "#{id} を取り消しますか？{amount} の反対の記録が追加され、元の記録は残ります。", "note": "内部メモ（任意）", "action": "取り消す", "keep": "戻る"},
      "history": {"title": "調整履歴", "filter": "メンバーで絞り込み", "filterPlaceholder": "CAN ID", "apply": "絞り込む", "clear": "クリア", "empty": "手動調整の記録はまだありません", "emptyHint": "上で送信した調整がここに表示されます。", "more": "さらに読み込む", "columns": {"time": "日時", "member": "メンバー", "amount": "金額", "detail": "公開説明", "note": "内部メモ", "operator": "操作者", "status": "状態"}, "status": {"active": "有効", "reversed": "取り消し済み", "reversal": "取り消し記録"}, "reversedBy": "#{id} で取り消し", "reverses": "#{id} の取り消し", "reverseAction": "取り消す"},
      "done": {"adjusted": "{member} に {amount} を記録しました。現在の残高は {balance} です。", "replayed": "この操作は以前に記録済みです（{amount}）。二重には記録されていません。下の履歴を確認してください。", "reversed": "#{id} を取り消しました。{member} の現在の残高は {balance} です。"},
      "errors": {"load": "調整履歴を読み込めませんでした。", "balance": "このメンバーの残高を読み込めませんでした。", "memberRequired": "先にメンバーを選んでください。", "amountRequired": "ポイントを入力してください。", "amount": "ポイントは 1 から 1,000,000 までの整数にしてください。", "detailRequired": "公開説明を入力してください。", "detailLength": "公開説明は 255 文字以内にしてください。", "noteLength": "内部メモは 255 文字以内にしてください。", "selfAdjust": "自分のポイントは調整できません。", "invalidAmount": "ポイントは 1,000,000 以下の 0 以外の整数にしてください。", "invalidDetail": "公開説明は 1〜255 文字にしてください。", "invalidRequest": "リクエストが不正です。ページを再読み込みしてからお試しください。", "notFound": "メンバーまたは記録が存在しません。", "notReversible": "取り消し記録は取り消せません。", "alreadyReversed": "この調整はすでに取り消されています。", "network": "ネットワークに接続できません。入力内容は保持され、再試行しても二重には記録されません。", "actionFailed": "操作に失敗しました。しばらくしてからお試しください。"}
    }
  }
}

for locale, s in STRINGS.items():
    path = f"language/{locale}.json"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data["frame"] = insert_after(data["frame"], "lotteryManage", "pointsManage", s["frame"])
    data["portal"]["cards"] = insert_after(data["portal"]["cards"], "lottery", "points", s["card"])
    data = insert_after(data, "lottery", "points", {"manage": s["manage"]})
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
PY
git diff --stat language/
```

Expected: four files changed, insertions only (no deletions).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/pointsMessages.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the gate**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
bunx prettier --write language/*.json src/lib/pointsMessages.test.ts
git diff --stat language/
bun run lint
```

Expected: prettier leaves the JSON unchanged (same `--stat` as Step 3). `lint` passes.

- [ ] **Step 6: Commit**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git add language/zh-cn.json language/zh-tw.json language/en-us.json language/ja-jp.json src/lib/pointsMessages.test.ts
git commit -m "feat(points): add points.manage strings in four locales

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `/super/points` page

**Files:**

- Create: `src/components/ManagePoints.vue`
- Create: `src/pages/super/points.astro`

**Interfaces:**

- Consumes:
  - From `@/lib/points` (Task 1): `POINTS_LIMITS`, `HISTORY_PAGE_SIZE`, `adjustBody`, `balancePath`, `canReverse`, `emptyAdjustForm`, `entryState`, `errorKey`, `formatPoints`, `formatSigned`, `hasErrors`, `isReplay`, `isSelf`, `manualPath`, `mergeEntries`, `newReference`, `projectedBalance`, `reverseBody`, `reversePath`, `signedAmount`, `validateAdjust`, `validateReverseNote`, types `AdjustForm`, `AdjustFormErrors`, `AdjustResult`, `Cursor`, `Direction`, `EntryState`, `ManualEntry`, `ManualPage`, `PointsBalance`.
  - From `@/lib/canApi`: `api<T>(path, init): Promise<ApiResult<T>>` (unwraps the envelope, returns `{ok:false, status, error, message}` on failure, `error: "network"` on a fetch failure), `apiFetch(path, init): Promise<Response>`, `unwrapList<T>(data, key): T[]`.
  - From `@/lib/activities`: `formatZulu(iso: string): string`, `formatLocal(iso: string): string`.
  - From `@/lib/tools`: `ratingShort(value: RatingRef | null | undefined): string`, type `RatingRef`.
  - From `@jianyuelab-org/can-ui`: `AlertBox`, `Badge`, `Button`, `Card`, `DataTable`, `Dialog`, `Input`, `PageHeader`, `Segmented`, `Textarea`.
  - Dictionary namespace `points.manage` (Task 3).
  - Proxy routes (Task 2).
  - `Astro.locals.user?.username` (set by `src/middleware.ts`).
- Produces: the page at `/super/points`. Task 5 links it.

- [ ] **Step 1: Create the Astro shell**

Create `src/pages/super/points.astro`:

```astro
---
import AppLayout from "@/layouts/AppLayout.astro";
import ManagePoints from "@/components/ManagePoints.vue";
import { getLocale, getMessages } from "@/lib/i18n";

/**
 * 积分手动调整 —— SUP/ADM（`/super/*` 前缀，中间件按 11 级判）。
 *
 * `sessionUserId` 只用来在选中自己时禁用提交、在自己的记录上禁用撤销。边界是
 * can-api 的 `self_adjust`。
 */
const locale = getLocale(Astro.cookies);
const messages = getMessages(locale, "points.manage");
const sessionUserId = Astro.locals.user?.username ?? "";
---

<AppLayout title="积分调整 · Cerulean Aviation Network">
  <ManagePoints messages={messages} sessionUserId={sessionUserId} client:load />
</AppLayout>
```

- [ ] **Step 2: Create the island**

Create `src/components/ManagePoints.vue`:

```vue
<script setup lang="ts">
/**
 * 积分手动调整。SUP/ADM。
 *
 * 上半是调整表单，下半是手动调整记录。记录只追加：记错了就撤销，撤销本身是一
 * 笔反向记录，每笔只能撤销一次，撤销记录不能再撤销。
 *
 * **reference 是幂等键。** 页面打开时生成一个 UUID；提交失败后重试沿用同一个，
 * 成功后换新。一次超时的请求可能已经入账，带着同一个 reference 重试，can-api 返
 * 回原来那一行而不是再记一笔。返回的那一行和这次提交的不一样时（重试前改过表
 * 单），页面如实说出来，见 `isReplay`。
 *
 * **不能调整自己。** 选中的是自己时提交按钮禁用，自己的记录上撤销按钮禁用。边界
 * 是 can-api 的 `self_adjust`，这里只是提前说。
 *
 * 确认在页内 `Dialog` 里做，不用 `window.confirm` —— 理由见 ManageActivities.vue
 * 的 `cancelTarget`。余额变负不拦，只标红。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import { formatLocal, formatZulu } from "@/lib/activities";
import { ratingShort, type RatingRef } from "@/lib/tools";
import {
  HISTORY_PAGE_SIZE,
  POINTS_LIMITS,
  adjustBody,
  balancePath,
  canReverse,
  emptyAdjustForm,
  entryState,
  errorKey,
  formatPoints,
  formatSigned,
  hasErrors,
  isReplay,
  isSelf,
  manualPath,
  mergeEntries,
  newReference,
  projectedBalance,
  reverseBody,
  reversePath,
  signedAmount,
  validateAdjust,
  validateReverseNote,
  type AdjustForm,
  type AdjustFormErrors,
  type AdjustResult,
  type Cursor,
  type Direction,
  type EntryState,
  type ManualEntry,
  type ManualPage,
  type PointsBalance,
} from "@/lib/points";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Input,
  PageHeader,
  Segmented,
  Textarea,
} from "@jianyuelab-org/can-ui";
import { api, apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{
  messages: Record<string, unknown>;
  /** 当前操作人的 CAN ID。 */
  sessionUserId: string;
}>();
const t = createTranslator(props.messages);

interface Member {
  username: string;
  name: string;
  rating: RatingRef;
}

const feedback = ref<{
  type: "success" | "warning" | "error";
  text: string;
} | null>(null);

// —— 成员搜索 ——————————————————————————————————————————————

const search = ref("");
const results = ref<Member[]>([]);
const searching = ref(false);

/**
 * 和 AipAccess.vue 同一套：停手 250 ms 再发；每次发都记一个序号，回来的不是最
 * 新那次就丢掉。`/api/v1/super/members` 上限 20 条，是服务端定的。
 */
const SEARCH_DEBOUNCE_MS = 250;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
}

/** 清空搜索，连同还在路上的那次。 */
function resetSearch() {
  clearTimeout(searchTimer);
  searchSeq++;
  search.value = "";
  results.value = [];
  searching.value = false;
}

async function runSearch() {
  const seq = ++searchSeq;
  const query = search.value.trim();
  if (query.length < 2) {
    results.value = [];
    searching.value = false;
    return;
  }

  searching.value = true;
  let found: Member[] = [];
  try {
    const response = await apiFetch(
      `/api/v1/super/members?q=${encodeURIComponent(query)}`,
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok) found = unwrapList<Member>(payload?.data, "members");
  } catch {
    found = [];
  }
  if (seq !== searchSeq) return;
  results.value = found;
  searching.value = false;
}

// —— 选中的成员与余额 ————————————————————————————————————————

const selected = ref<Member | null>(null);
const balance = ref<number | null>(null);
const balanceLoading = ref(false);
const balanceError = ref<string | null>(null);
/** 换人时上一个人的余额可能还在路上；序号对不上就丢掉。 */
let balanceSeq = 0;

const form = ref<AdjustForm>(emptyAdjustForm());
const fieldErrors = ref<AdjustFormErrors>({});
/** 幂等键。见文件头。 */
const reference = ref(newReference());

const confirmOpen = ref(false);
const submitting = ref(false);
/** 对话框里的错误写在对话框里：页面横幅在遮罩后面。 */
const dialogError = ref<string | null>(null);

const selfSelected = computed(() =>
  isSelf(form.value.username, props.sessionUserId),
);

const directionSegments = computed<Array<{ value: Direction; label: string }>>(
  () => [
    { value: "grant", label: t("form.grant") },
    { value: "deduct", label: t("form.deduct") },
  ],
);

const pendingAmount = computed(() => signedAmount(form.value));

const projected = computed(() =>
  balance.value === null || pendingAmount.value === null
    ? null
    : projectedBalance(balance.value, pendingAmount.value),
);

const balanceText = computed(() => {
  if (balanceLoading.value) return t("form.balanceLoading");
  if (balanceError.value) return balanceError.value;
  if (balance.value === null) return "";
  return t("form.balance", { balance: formatPoints(balance.value) });
});

function selectMember(member: Member) {
  selected.value = member;
  form.value.username = member.username;
  fieldErrors.value = {};
  resetSearch();
  void loadBalance(member.username);
}

function changeMember() {
  balanceSeq++;
  selected.value = null;
  form.value.username = "";
  balance.value = null;
  balanceError.value = null;
  balanceLoading.value = false;
}

async function loadBalance(username: string) {
  const seq = ++balanceSeq;
  balanceLoading.value = true;
  balanceError.value = null;
  balance.value = null;
  const result = await api<PointsBalance>(balancePath(username));
  if (seq !== balanceSeq) return;
  balanceLoading.value = false;
  if (!result.ok) {
    balanceError.value =
      result.error === "not_found" ? failure("not_found") : t("errors.balance");
    return;
  }
  balance.value = result.data.balance;
}

function errorText(field: keyof AdjustFormErrors): string | undefined {
  const key = fieldErrors.value[field];
  return key ? t(`errors.${key}`) : undefined;
}

function failure(code: string): string {
  return t(`errors.${errorKey(code)}`);
}

/** 先校验，通过了再打开确认。 */
function review() {
  feedback.value = null;
  const errors = validateAdjust(form.value, props.sessionUserId);
  fieldErrors.value = errors;
  if (hasErrors(errors)) return;
  dialogError.value = null;
  confirmOpen.value = true;
}

async function submit() {
  if (submitting.value) return;
  const body = adjustBody(form.value, reference.value);
  submitting.value = true;
  dialogError.value = null;
  const result = await api<AdjustResult>("/api/v1/super/points/adjust", {
    method: "POST",
    body: JSON.stringify(body),
  });
  submitting.value = false;

  if (!result.ok) {
    // reference 不换：重试必须带同一个。
    dialogError.value = failure(result.error);
    return;
  }

  reference.value = newReference();
  confirmOpen.value = false;
  const { entry, balance: after } = result.data;
  if (selected.value?.username === entry.username) balance.value = after;
  feedback.value = isReplay(entry, body)
    ? {
        type: "warning",
        text: t("done.replayed", { amount: formatSigned(entry.amount) }),
      }
    : {
        type: "success",
        text: t("done.adjusted", {
          member: entry.username,
          amount: formatSigned(entry.amount),
          balance: formatPoints(after),
        }),
      };
  // 成员和方向留着：给同一个人连记几笔是常见操作。
  form.value = {
    ...emptyAdjustForm(),
    username: form.value.username,
    direction: form.value.direction,
  };
  fieldErrors.value = {};
  await loadHistory(true);
}

// —— 调整记录 ————————————————————————————————————————————————

const entries = ref<ManualEntry[]>([]);
const nextCursor = ref<Cursor | null>(null);
const historyLoading = ref(true);
const loadingMore = ref(false);
const historyError = ref<string | null>(null);
const filter = ref("");
const appliedFilter = ref("");
let historySeq = 0;

const columns = computed(() => [
  { key: "createdAt", label: t("history.columns.time") },
  { key: "username", label: t("history.columns.member") },
  {
    key: "amount",
    label: t("history.columns.amount"),
    align: "right" as const,
  },
  { key: "detail", label: t("history.columns.detail") },
  { key: "note", label: t("history.columns.note") },
  { key: "operator", label: t("history.columns.operator") },
  {
    key: "status",
    label: t("history.columns.status"),
    align: "right" as const,
  },
]);

const STATE_VARIANT: Record<EntryState, "success" | "neutral" | "info"> = {
  active: "success",
  reversed: "neutral",
  reversal: "info",
};

/**
 * 读一页。`reset` 从头读，否则接在已有的后面。
 *
 * 接着读而不是换页：撤销记录比原记录新，排在它上面，所以「已撤销」那一行要链
 * 过去的那一行一定已经在表里。
 */
async function loadHistory(reset: boolean) {
  const seq = ++historySeq;
  if (reset) historyLoading.value = true;
  else loadingMore.value = true;
  historyError.value = null;

  const result = await api<ManualPage>(
    manualPath({
      username: appliedFilter.value,
      cursor: reset ? null : nextCursor.value,
      limit: HISTORY_PAGE_SIZE,
    }),
  );
  if (seq !== historySeq) return;
  historyLoading.value = false;
  loadingMore.value = false;

  if (!result.ok) {
    historyError.value = t("errors.load");
    return;
  }
  const page = unwrapList<ManualEntry>(result.data, "entries");
  entries.value = reset ? page : mergeEntries(entries.value, page);
  nextCursor.value = result.data?.nextCursor ?? null;
}

function applyFilter() {
  appliedFilter.value = filter.value.trim();
  void loadHistory(true);
}

function clearFilter() {
  filter.value = "";
  appliedFilter.value = "";
  void loadHistory(true);
}

function formatDate(iso: string): string {
  return t("timeWithLocal", { zulu: formatZulu(iso), local: formatLocal(iso) });
}

/** 已撤销的行变灰。 */
function dim(row: ManualEntry): string {
  return entryState(row) === "reversed" ? "opacity-50" : "";
}

function anchor(id: number): string {
  return `points-entry-${id}`;
}

// —— 撤销 ————————————————————————————————————————————————————

const reverseTarget = ref<ManualEntry | null>(null);
const reverseNote = ref("");
const reverseError = ref<string | null>(null);
const reversing = ref(false);

function askReverse(entry: ManualEntry) {
  reverseTarget.value = entry;
  reverseNote.value = "";
  reverseError.value = null;
}

async function confirmReverse() {
  const target = reverseTarget.value;
  if (reversing.value || !target) return;
  const noteError = validateReverseNote(reverseNote.value);
  if (noteError) {
    reverseError.value = t(`errors.${noteError}`);
    return;
  }

  reversing.value = true;
  reverseError.value = null;
  const result = await api<AdjustResult>(reversePath(target.id), {
    method: "POST",
    body: JSON.stringify(reverseBody(reverseNote.value)),
  });
  reversing.value = false;

  if (!result.ok) {
    reverseError.value = failure(result.error);
    // 别人先撤销了：表里这一行是旧的，刷新让它变灰。
    if (result.error === "already_reversed") void loadHistory(true);
    return;
  }

  reverseTarget.value = null;
  const after = result.data.balance;
  if (selected.value?.username === target.username) balance.value = after;
  feedback.value = {
    type: "success",
    text: t("done.reversed", {
      id: target.id,
      member: target.username,
      balance: formatPoints(after),
    }),
  };
  await loadHistory(true);
}

onMounted(() => loadHistory(true));
onBeforeUnmount(() => clearTimeout(searchTimer));
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="adjustments"
    />

    <AlertBox
      v-if="feedback"
      class="mb-6"
      :variant="feedback.type === 'error' ? 'danger' : feedback.type"
      dismissible
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <!-- 调整 -->
    <Card :title="t('form.title')" :subtitle="t('form.help')" class="mb-6">
      <template v-if="!selected">
        <div class="max-w-sm">
          <Input
            v-model="search"
            type="search"
            name="points-member-search"
            :label="t('form.search')"
            :placeholder="t('form.searchPlaceholder')"
            :error="errorText('username')"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            :spellcheck="false"
            @input="scheduleSearch"
          />
        </div>
        <p v-if="searching" class="mt-3 text-sm text-muted">
          {{ t("loading") }}
        </p>
        <ul v-else-if="results.length" class="mt-3 space-y-1.5">
          <li
            v-for="m in results"
            :key="m.username"
            class="flex flex-wrap items-center gap-3 rounded-control bg-surface-sunken px-3 py-2"
          >
            <span class="font-mono text-sm font-semibold text-ink">{{
              m.username
            }}</span>
            <span class="text-sm text-ink">{{ m.name }}</span>
            <span class="text-xs text-faint">{{ ratingShort(m.rating) }}</span>
            <Button
              size="sm"
              variant="secondary"
              class="ml-auto"
              @click="selectMember(m)"
            >
              {{ t("form.select") }}
            </Button>
          </li>
        </ul>
        <p
          v-else-if="search.trim().length >= 2"
          class="mt-3 text-sm text-muted"
        >
          {{ t("form.noMatches") }}
        </p>
      </template>

      <template v-else>
        <div
          class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-surface-sunken px-3 py-2.5"
        >
          <span class="font-mono text-sm font-semibold text-ink">{{
            selected.username
          }}</span>
          <span class="text-sm text-ink">{{ selected.name }}</span>
          <span class="text-xs text-faint">{{
            ratingShort(selected.rating)
          }}</span>
          <span
            class="tnum text-sm"
            :class="balanceError ? 'text-danger-fg' : 'text-muted'"
          >
            {{ balanceText }}
          </span>
          <Button
            size="sm"
            variant="ghost"
            class="ml-auto"
            @click="changeMember"
          >
            {{ t("form.change") }}
          </Button>
        </div>
        <AlertBox v-if="selfSelected" variant="warning" class="mt-3">
          {{ t("errors.selfAdjust") }}
        </AlertBox>
      </template>

      <form class="mt-5 space-y-4" @submit.prevent="review">
        <div class="space-y-1.5">
          <span class="block text-sm font-medium text-ink">{{
            t("form.direction")
          }}</span>
          <Segmented
            v-model="form.direction"
            :segments="directionSegments"
            :label="t('form.direction')"
          />
        </div>
        <div class="max-w-xs">
          <Input
            v-model="form.amount"
            name="points-amount"
            inputmode="numeric"
            :label="t('form.amount')"
            :hint="t('form.amountHint')"
            :error="errorText('amount')"
            autocomplete="off"
            required
          />
        </div>
        <Textarea
          v-model="form.detail"
          name="points-detail"
          :label="t('form.detail')"
          :hint="t('form.detailHint')"
          :error="errorText('detail')"
          :maxlength="POINTS_LIMITS.detail"
          :rows="2"
          counter
          required
        />
        <Input
          v-model="form.note"
          name="points-note"
          :label="t('form.note')"
          :hint="t('form.noteHint')"
          :error="errorText('note')"
          :maxlength="POINTS_LIMITS.note"
          autocomplete="off"
        />
        <div class="flex justify-end">
          <Button type="submit" :disabled="selfSelected">
            {{ t("form.submit") }}
          </Button>
        </div>
      </form>
    </Card>

    <!-- 调整记录 -->
    <Card :title="t('history.title')" padding="none">
      <div class="p-6">
        <form
          class="mb-4 flex flex-wrap items-end gap-2"
          @submit.prevent="applyFilter"
        >
          <div class="w-48">
            <Input
              v-model="filter"
              name="points-filter"
              :label="t('history.filter')"
              :placeholder="t('history.filterPlaceholder')"
              autocomplete="off"
              autocapitalize="none"
              autocorrect="off"
              :spellcheck="false"
            />
          </div>
          <Button type="submit" variant="secondary">
            {{ t("history.apply") }}
          </Button>
          <Button v-if="appliedFilter" variant="ghost" @click="clearFilter">
            {{ t("history.clear") }}
          </Button>
        </form>

        <AlertBox v-if="historyError" variant="danger" class="mb-4">
          {{ historyError }}
        </AlertBox>

        <DataTable
          :columns="columns"
          :rows="entries"
          row-key="id"
          :loading="historyLoading"
          :loading-label="t('loading')"
          :empty="t('history.empty')"
          :empty-description="t('history.emptyHint')"
          dense
        >
          <template #cell-createdAt="{ row }">
            <span
              :id="anchor(row.id)"
              class="whitespace-normal text-xs"
              :class="dim(row)"
              >{{ formatDate(row.createdAt) }}</span
            >
          </template>
          <template #cell-username="{ row }">
            <span class="font-mono" :class="dim(row)">{{ row.username }}</span>
          </template>
          <template #cell-amount="{ row }">
            <span
              class="tnum font-semibold"
              :class="[
                dim(row),
                row.amount < 0 ? 'text-danger-fg' : 'text-success-fg',
              ]"
              >{{ formatSigned(row.amount) }}</span
            >
          </template>
          <template #cell-detail="{ row }">
            <span
              class="whitespace-normal text-sm text-ink"
              :class="dim(row)"
              >{{ row.detail }}</span
            >
          </template>
          <template #cell-note="{ row }">
            <span
              class="whitespace-normal text-xs text-muted"
              :class="dim(row)"
              >{{ row.note ?? "—" }}</span
            >
          </template>
          <template #cell-operator="{ row }">
            <span class="font-mono text-xs text-muted" :class="dim(row)">{{
              row.operator
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Badge :variant="STATE_VARIANT[entryState(row)]" size="sm">
                {{ t(`history.status.${entryState(row)}`) }}
              </Badge>
              <a
                v-if="row.reversedBy !== null"
                :href="`#${anchor(row.reversedBy)}`"
                class="text-xs text-can underline"
                >{{ t("history.reversedBy", { id: row.reversedBy }) }}</a
              >
              <a
                v-else-if="row.reverses !== null"
                :href="`#${anchor(row.reverses)}`"
                class="text-xs text-can underline"
                >{{ t("history.reverses", { id: row.reverses }) }}</a
              >
              <Button
                v-if="entryState(row) === 'active'"
                size="sm"
                variant="ghost"
                :disabled="!canReverse(row, props.sessionUserId)"
                @click="askReverse(row)"
              >
                {{ t("history.reverseAction") }}
              </Button>
            </div>
          </template>
        </DataTable>

        <div
          v-if="nextCursor !== null && !historyLoading"
          class="mt-4 flex justify-center"
        >
          <Button
            variant="secondary"
            :loading="loadingMore"
            @click="loadHistory(false)"
          >
            {{ t("history.more") }}
          </Button>
        </div>
      </div>
    </Card>

    <!-- 调整确认：成员、带符号金额、余额 → 新余额 -->
    <Dialog
      v-model:open="confirmOpen"
      size="sm"
      :title="t('confirm.title')"
      :close-label="t('close')"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between gap-4">
          <dt class="text-muted">{{ t("confirm.member") }}</dt>
          <dd class="text-right text-ink">
            <span class="font-mono">{{ selected?.username }}</span>
            {{ selected?.name }}
          </dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">{{ t("confirm.amount") }}</dt>
          <dd
            class="tnum font-semibold"
            :class="
              (pendingAmount ?? 0) < 0 ? 'text-danger-fg' : 'text-success-fg'
            "
          >
            {{ pendingAmount === null ? "" : formatSigned(pendingAmount) }}
          </dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">{{ t("confirm.balance") }}</dt>
          <dd class="tnum text-ink">
            {{
              balance === null
                ? t("confirm.unknownBalance")
                : formatPoints(balance)
            }}
            →
            <span
              class="font-semibold"
              :class="
                projected !== null && projected < 0
                  ? 'text-danger-fg'
                  : 'text-ink'
              "
              >{{
                projected === null
                  ? t("confirm.unknownBalance")
                  : formatPoints(projected)
              }}</span
            >
          </dd>
        </div>
      </dl>
      <p
        v-if="projected !== null && projected < 0"
        class="mt-3 text-sm text-danger-fg"
      >
        {{ t("confirm.negative") }}
      </p>
      <p
        class="mt-3 whitespace-pre-line rounded-control bg-surface-sunken px-3 py-2.5 text-sm text-ink"
      >
        {{ form.detail.trim() }}
      </p>
      <template #footer>
        <Button variant="secondary" @click="confirmOpen = false">
          {{ t("confirm.keep") }}
        </Button>
        <Button
          :variant="(pendingAmount ?? 0) < 0 ? 'danger' : 'primary'"
          :loading="submitting"
          @click="submit"
        >
          {{ t("confirm.action") }}
        </Button>
      </template>
    </Dialog>

    <!-- 撤销确认，带可选的内部备注 -->
    <Dialog
      :open="!!reverseTarget"
      size="sm"
      :title="t('reverse.title')"
      :close-label="t('close')"
      @close="reverseTarget = null"
    >
      <AlertBox v-if="reverseError" variant="danger" class="mb-4">{{
        reverseError
      }}</AlertBox>
      <p class="text-sm text-muted">
        {{
          reverseTarget
            ? t("reverse.body", {
                id: reverseTarget.id,
                amount: formatSigned(-reverseTarget.amount),
              })
            : ""
        }}
      </p>
      <p
        class="mt-3 rounded-control bg-surface-sunken px-3 py-2.5 text-sm text-ink"
      >
        <span class="font-mono">{{ reverseTarget?.username }}</span>
        ·
        <span class="tnum">{{
          reverseTarget ? formatSigned(reverseTarget.amount) : ""
        }}</span>
        · {{ reverseTarget?.detail }}
      </p>
      <div class="mt-4">
        <Input
          v-model="reverseNote"
          name="points-reverse-note"
          :label="t('reverse.note')"
          :hint="t('form.noteHint')"
          :maxlength="POINTS_LIMITS.note"
          autocomplete="off"
        />
      </div>
      <template #footer>
        <Button variant="secondary" @click="reverseTarget = null">
          {{ t("reverse.keep") }}
        </Button>
        <Button variant="danger" :loading="reversing" @click="confirmReverse">
          {{ t("reverse.action") }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 3: Run the gate**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
bunx prettier --write src/components/ManagePoints.vue src/pages/super/points.astro
bun run lint
bun run build
```

Expected: `astro check` 0 errors, vue-tsc clean (every imported name is used in the script or the template), tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git add src/components/ManagePoints.vue src/pages/super/points.astro
git commit -m "feat(points): add the /super/points adjustment page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sidebar entry, home card and docs

**Files:**

- Modify: `src/lib/nav.ts` (the `SUP` array)
- Modify: `src/pages/index.astro` (the SUP card group)
- Modify: `src/lib/access.test.ts` (`requiredRating` "/super is SUP" test)
- Modify: `AGENTS.md` (page count line 9; page table; "词典是切出来的" section)
- Modify: `README.md` (the "页面" table)

**Interfaces:**

- Consumes: `frame.pointsManage`, `portal.cards.points` (Task 3); the page from Task 4; `requiredRating(pathname: string): number` from `@/lib/access`.
- Produces: nothing downstream.

- [ ] **Step 1: Pin the rating floor**

In `src/lib/access.test.ts`, in the test `"/super is SUP, /instr is instructor"`, directly after `expect(requiredRating("/super/promotions")).toBe(11);`, add:

```ts
expect(requiredRating("/super/points")).toBe(11);
```

Run: `cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal && bun test src/lib/access.test.ts`
Expected: PASS. The existing `/super` floor already covers the page; the line pins that no `FLOORS` row is needed.

- [ ] **Step 2: Add the sidebar entry**

In `src/lib/nav.ts`, in `SUP`, directly after the `lotteryManage` line, add:

```ts
  // 积分手动调整。和奖品、抽奖同一档（11）：can-api 的路由是 `WithSup`。
  { key: "pointsManage", href: "/super/points", icon: "adjustments" },
```

- [ ] **Step 3: Add the home card**

In `src/pages/index.astro`, in the `rating >= RATING_SUP` array, directly after the `/super/lottery` card, add:

```ts
        {
          href: "/super/points",
          title: tf("pointsManage"),
          body: t("cards.points"),
          group: t("groups.sup"),
        },
```

- [ ] **Step 4: Update the docs**

In `AGENTS.md` (not `CLAUDE.md`, which is a symlink to it):

Replace `一共十一个页面和一张首页：` with `一共十二个页面和一张首页：`.

Add a row to the page table directly after the `/super/lottery` row:

```markdown
| `/super/points` | （新） | `ManagePoints.vue` | 11 |
```

At the end of the "词典是切出来的，不是抄整本" section, directly after the `lottery.manage` paragraph, add:

```markdown
`points.manage` 也只有这个站有。改它直接改这里。
```

In `README.md`, add a row to the "页面" table directly after the `/super/lottery` row:

```markdown
| `/super/points` | 积分调整 —— 手动发放、扣除、撤销 | 11 (SUP) |
```

- [ ] **Step 5: Run the gate**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
bunx prettier --write src/lib/nav.ts src/pages/index.astro src/lib/access.test.ts AGENTS.md README.md
bun run lint
bun run build
ls -l CLAUDE.md
```

Expected: prettier realigns the two markdown tables. `lint` and `build` pass. `ls -l` shows `CLAUDE.md -> AGENTS.md`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git add src/lib/nav.ts src/pages/index.astro src/lib/access.test.ts AGENTS.md README.md
git commit -m "feat(nav): link the points page from the sidebar and home

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Manual browser check (the user runs this)

Prerequisite: can-api with the points routes and the pushed schema. Run it locally and set `CAN_API_ORIGIN` in `.env` to it. The default `https://api.ceruleanavi.net` is production, where an adjustment really changes a member's balance and sends a notification.

Session: localhost does not receive the `.ceruleanavi.net` cookie. Copy `can_session` from `.ceruleanavi.net` to `localhost` in the browser devtools. The account must be rating 11 or higher. A second test account is needed as the member.

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
bun run dev   # http://localhost:4328
```

Check each item. If one fails, fix it in the matching task's files and re-run that task's gate before committing.

- [ ] Sidebar shows "积分调整" below "抽奖管理". The home page shows the card in the SUP group.
- [ ] A rating-8 session opening `/super/points` gets the 403 `NoAccess` page.
- [ ] Searching two or more characters lists members. Selecting one shows the CAN ID, name, rating and "当前余额 N".
- [ ] Selecting yourself shows the warning and the submit button is disabled.
- [ ] Submitting an empty form shows field errors for member, amount and description. No request is sent (Network tab).
- [ ] Amount `0`, `1.5`, `1000001` show the amount error. `1000000` passes.
- [ ] Grant `100`: the confirm dialog shows member, `+100` in green and `N → N+100`. The request body has `amount: 100` and a UUID `reference`.
- [ ] Deduct more than the balance: the dialog shows `-X` and the new balance in red with the negative note. Confirming succeeds.
- [ ] After success the banner shows the new balance, the balance line updates, amount/description/note clear, member and direction stay, and the next request carries a different `reference`.
- [ ] Retry: block the request (devtools offline), confirm, see the network error in the dialog, go online, confirm again. Both requests carry the same `reference`; the history shows one row.
- [ ] Replay: let a request land, block its response (or replay the same body with curl), change the amount, resubmit with the same `reference`. The banner shows the "已经记入" warning, and the history has no second row.
- [ ] History lists time (Zulu and local), member, signed amount, description, note, operator, status. Filter by CAN ID and clear work. "加载更多" appears only when `nextCursor` is not null.
- [ ] Reverse an active row with a note: the row turns grey with "由 #N 撤销"; a new row at the top reads "撤销 #M" with the opposite amount and `撤销：<original detail>`.
- [ ] A reversed row and a reversal row have no reverse button. A row whose member is yourself has the button disabled.
- [ ] Reversing in two tabs: the second shows "这笔调整已经被撤销过了。" and the table refreshes.
- [ ] Switch the language to en-us, zh-tw and ja-jp. No raw key (e.g. `errors.alreadyReversed`) appears anywhere.

---

### Task 7: Rollout

- [ ] **Step 1: Push the branch**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git push -u origin feat/manual-points
```

Expected: the check workflow passes on the branch.

- [ ] **Step 2: Open the PR**

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
gh pr create --base main --head feat/manual-points \
  --title "feat(points): add the /super/points manual adjustment page" \
  --body "$(cat <<'EOF'
Adds `/super/points` for SUP/ADM to grant, deduct and reverse member points.

- `src/lib/points.ts`: wire types, form validation, sign toggle, error mapping. Covered by `bun test`.
- Proxy: `super/points/{balance,adjust,manual}` and `super/points/{id}/reverse`, each with `who`.
- `points.manage` strings in four locales; sidebar entry and home card.

What to check:

- can-api's points routes are deployed and `db push` has landed before merging.
- Submit is disabled when the selected member is yourself.
- The confirmation shows `balance → new balance`; a negative result is red and not blocked.
- A retried request reuses its `reference`; history shows one row.
- Reversed rows are grey and link to the reversing row; reversal rows have no reverse button.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: `gh` prints the PR URL.

- [ ] **Step 3: Merge**

Merge only after can-api's points routes are deployed and its `db push` has landed (spec "Order" steps 1–3). Merging to `main` deploys. Then update the local `main`:

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork/can-portal
git checkout main
git pull --ff-only origin main
```

- [ ] **Step 4: Move the pointer at the root (after the merge)**

The root has unrelated dirty paths (`can-api`, `can-nav/tools/__pycache__`, untracked directories). Stage only the `can-portal` gitlink, pointing at the merged `main`, and commit without a pathspec.

```bash
cd /Users/jhl/Documents/Dev/CeruleanAviationNetwork
git update-index --cacheinfo 160000,$(git -C can-portal rev-parse origin/main),can-portal
git diff --cached --name-only
git commit -m "Bump can-portal for the manual points page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git ls-tree HEAD can-portal
```

Expected: `git diff --cached --name-only` prints only `can-portal`. `git ls-tree` shows the merge commit on `origin/main`. Do not push the root unless asked.

---

## Self-Review

**Spec coverage (spec section "can-portal"):**

| Spec requirement                                                                        | Task                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/pages/super/points.astro` mounts `ManagePoints.vue`; namespace `points.manage`     | 4, 3                                                                      |
| `/super` gated at 11; no `FLOORS` row                                                   | 5 (pinned in `access.test.ts`), no `access.ts` change                     |
| Member picker via `/super/members?q=`, same as `AipAccess.vue`                          | 4 (copied debounce and stale-drop), 2 (`who` updated)                     |
| On select: fetch and show the current balance                                           | 1 (`balancePath`), 2 (proxy), 4 (`loadBalance`)                           |
| Grant/deduct toggle plus positive integer amount; toggle sets the sign                  | 1 (`parseAmount`, `signedAmount`), 4 (`Segmented`)                        |
| Public description required, internal note optional                                     | 1 (`validateAdjust`, `adjustBody`), 4                                     |
| Submit disabled when the selected member is the signed-in user                          | 1 (`isSelf`), 4 (`selfSelected`, `sessionUserId` prop)                    |
| Confirmation: member, signed amount, `balance → new balance`; negative red, not blocked | 1 (`projectedBalance`, `formatSigned`), 4 (confirm dialog)                |
| `reference` from `crypto.randomUUID()` at open, reused on retry, replaced after success | 1 (`newReference`), 4 (`reference` ref, `submit`)                         |
| History table: time, member, amount, description, note, operator, status                | 4 (`columns`)                                                             |
| Filter by member; cursor pagination                                                     | 1 (`manualPath`, `mergeEntries`), 4 (`applyFilter`, `loadHistory(false)`) |
| Reverse button on un-reversed, non-reversal rows; confirmation with optional note       | 1 (`entryState`, `canReverse`, `reverseBody`), 4 (reverse dialog)         |
| Reversed rows greyed and linked to the reversing row                                    | 4 (`dim`, `anchor`, `reversedBy` link)                                    |
| Every error code maps to a localised message                                            | 1 (`errorKey`), 3 (test checks every code in four locales)                |
| Proxy `ALLOW_LIST` three entries with `who`; `ALLOW_PATTERNS` reverse with `who`        | 2                                                                         |
| `proxyAllowList.test.ts` covers the four entries                                        | 2                                                                         |
| `nav.ts` `{ key: "pointsManage", href: "/super/points", icon }`; label; home card       | 5 (icon `adjustments`), 3 (labels)                                        |
| `src/lib/points.ts`: validation, wire types, error mapping; `bun test`                  | 1                                                                         |
| Gate: `bun run lint && bun run build`                                                   | Every task; 4 and 5 run `build`                                           |
| Order: can-portal after can-api, can-ui, can-web; root pointers last                    | 0 (branch), 7 (PR, merge after can-api, pointer after merge)              |

**Placeholder scan:** none. Every code step has full code; every dictionary entry is spelled out for all four locales.

**Type consistency:** `AdjustForm.amount` is a `string` in Task 1 and bound to `Input` in Task 4. `Direction` types both `AdjustForm.direction` and the `Segmented` segments. `errorKey` returns keys that Task 3's test checks in all four locales, and every local validation key (`memberRequired`, `amountRequired`, `amount`, `detailRequired`, `detailLength`, `noteLength`, `selfAdjust`) is in the same list. `STATE_VARIANT` is keyed by `EntryState`, and Task 3 checks `history.status.{active,reversed,reversal}`. The component imports only names Task 1 exports.

**Decisions where the spec is silent:**

- A duplicate `reference` returns the existing row with `200`. This plan assumes the body is the same `{entry, balance}` as `201`. If the form changed between the attempts, `isReplay` shows a warning instead of a success message.
- `nextCursor` has no declared type. It is treated as opaque (`string | number`) and sent back with `String()`.
- "Load more" appends rather than replacing the page, so a reversed row's link target (always newer, so higher in the list) is already rendered.
- Description and note lengths are counted in code points (`[...s].length`). can-api should count runes (`utf8.RuneCountInString`), not bytes, or a 255-character Chinese description passes here and fails there with `invalid_detail`.
- The reverse button is also disabled on rows whose member is the operator, matching the `403 self_adjust` rule on reverse.
- The reverse button sits in the status column, so the table keeps exactly the seven columns the spec lists.
- No can-ui `SITE_PAGES` entry is added. `check:pages` only checks that registered pages exist, and the spec's can-ui step covers only the notification kind.
