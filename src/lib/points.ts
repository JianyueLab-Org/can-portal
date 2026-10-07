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
