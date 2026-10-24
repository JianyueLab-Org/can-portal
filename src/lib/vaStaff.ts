/**
 * 虚拟航空平台管理页（`/super/airlines`）的线上形状和表单规则。
 *
 * 浏览器安全：不 import `src/server` 下的任何东西。形状照 can-va-api 的
 * `/api/v1/va/staff/*` 契约写。规则放在这里，`bun test` 钉得住。
 */

export type AirlineStatus = "active" | "suspended" | "closed";
export type StatusFilter = "all" | AirlineStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "active",
  "suspended",
  "closed",
];

export interface Application {
  id: number;
  applicant: string;
  name: string;
  icao: string;
  iata: string | null;
  telephony: string;
  description: string;
  hubIcao: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reason: string | null;
  airlineId: number | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface Airline {
  id: number;
  icao: string;
  iata: string | null;
  name: string;
  telephony: string;
  status: AirlineStatus;
  joinMode: "open" | "application" | "invite";
  hubs: string[];
  memberCount: number;
  description: string;
  owner: string | null;
  allowOfflinePireps: boolean;
  allowFreeFlights: boolean;
  createdAt: string;
  balance?: number;
  negativeSince?: string | null;
}

export interface LedgerEntry {
  id: number;
  amount: number;
  kind: string;
  actor: string | null;
  note: string | null;
  createdAt: string;
}

export interface Param {
  key: string;
  value: number;
}

export interface ParamChange {
  key: string;
  old: number;
  new: number;
  actor: string;
  at: string;
}

export interface Page<T> {
  items: T[];
  next: number | string | null;
}

export const PARAMS_LOG_PAGE_SIZE = 20;

const BASE = "/api/v1/va/staff";

export function applicationsPath(): string {
  return `${BASE}/applications?status=pending`;
}

export function approvePath(id: number): string {
  return `${BASE}/applications/${id}/approve`;
}

export function airlinesPath(filter: StatusFilter): string {
  return filter === "all"
    ? `${BASE}/airlines`
    : `${BASE}/airlines?status=${filter}`;
}

export function reinstatePath(id: number): string {
  return `${BASE}/airlines/${id}/reinstate`;
}

export function paramsPath(): string {
  return `${BASE}/params`;
}

export function paramPath(key: string): string {
  return `${BASE}/params/${encodeURIComponent(key)}`;
}

export function paramsLogPath(before: number | string | null): string {
  const query = new URLSearchParams({ limit: String(PARAMS_LOG_PAGE_SIZE) });
  if (before !== null) query.set("before", String(before));
  return `${BASE}/params/log?${query}`;
}

export function importPath(): string {
  return `${BASE}/airports/import`;
}

/** 需要在对话框里填东西的动作。批准和恢复不需要，直接发。 */
export type StaffAction = "reject" | "suspend" | "close" | "owner" | "adjust";

export interface ActionFields {
  reason: string;
  username: string;
  /** 带符号的额度，单位是 credit，最多两位小数。 */
  amount: string;
  note: string;
}

export function emptyFields(): ActionFields {
  return { reason: "", username: "", amount: "", note: "" };
}

export type ActionRequest =
  | {
      ok: true;
      method: "POST" | "PUT";
      path: string;
      body: Record<string, unknown>;
    }
  | { ok: false; error: string };

/**
 * 对话框动作的请求。`id` 对 reject 是申请 id，其余是航空公司 id。
 * 失败值是 `vaAirlines.errors` 下的键。
 */
export function actionRequest(
  action: StaffAction,
  id: number,
  fields: ActionFields,
): ActionRequest {
  const reason = fields.reason.trim();
  switch (action) {
    case "reject":
      if (!reason) return { ok: false, error: "reasonRequired" };
      return {
        ok: true,
        method: "POST",
        path: `${BASE}/applications/${id}/reject`,
        body: { reason },
      };
    case "suspend":
    case "close":
      if (!reason) return { ok: false, error: "reasonRequired" };
      return {
        ok: true,
        method: "POST",
        path: `${BASE}/airlines/${id}/${action}`,
        body: { reason },
      };
    case "owner": {
      const username = fields.username.trim();
      if (!username) return { ok: false, error: "usernameRequired" };
      return {
        ok: true,
        method: "PUT",
        path: `${BASE}/airlines/${id}/owner`,
        body: { username },
      };
    }
    case "adjust": {
      const amount = parseMoney(fields.amount);
      if (amount === null) return { ok: false, error: "amount" };
      const note = fields.note.trim();
      if (!note) return { ok: false, error: "noteRequired" };
      return {
        ok: true,
        method: "POST",
        path: `${BASE}/airlines/${id}/adjustments`,
        body: { amount, note },
      };
    }
  }
}

/** credit 文本 → 带符号的分（minor units）。0、超过两位小数、不安全的整数返回 null。 */
export function parseMoney(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  const match = /^([+-]?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const minor =
    Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor === 0) return null;
  return match[1] === "-" ? -minor : minor;
}

/** 分 → `1,234.56`。固定 en-US，四种语言下都是阿拉伯数字加逗号。 */
export function formatMoney(minor: number): string {
  return (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 参数值：非负十进制数，可带小数，不收科学计数法。 */
export function parseParamValue(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** RFC 3339 → `YYYY-MM-DD HH:MMZ`（UTC）。 */
export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

const ERROR_KEYS: Record<string, string> = {
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  bad_origin: "badOrigin",
  not_found: "notFound",
  bad_request: "badRequest",
  code_taken: "codeTaken",
  airport_unavailable: "airportUnavailable",
  not_pending: "notPending",
  not_active: "notActive",
  not_suspended: "notSuspended",
  no_owner: "noOwner",
  already_closed: "alreadyClosed",
  import_running: "importRunning",
  // 本站反代和 `api()` 自己的码。
  network: "network",
  unreachable: "unreachable",
  not_allowed: "notAllowed",
  method_not_allowed: "notAllowed",
};

/** 页面认得的错误码。 */
export const ERROR_CODES: readonly string[] = Object.keys(ERROR_KEYS);

/**
 * 错误码 → `vaAirlines.errors` 下的键。走 `Object.hasOwn`，理由同反代的 `lookup()`。
 */
export function errorKey(code: string): string {
  const key = Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : undefined;
  return key ?? "actionFailed";
}
