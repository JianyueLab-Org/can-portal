/**
 * 投票管理页的线上形状、请求、错误归类和表单规则。
 *
 * 浏览器安全：不 import `src/server` 下的任何东西。形状照 can-api 的
 * `/api/v1/super/poll` 契约写 —— camelCase，时间是 RFC 3339 UTC。任何地方都
 * 没有投票人。社区只存了 SHA-256，群名找不回来，所以社区只显示平台和短哈希。
 */
import { api, type ApiFailure, type ApiResult } from "@/lib/canApi";

export type PollPlatform = "global" | "qq" | "discord";
export type PollStatusFilter = "all" | "open" | "closed";
export type PollPlatformFilter = "all" | PollPlatform;

export const POLL_STATUS_FILTERS: PollStatusFilter[] = [
  "all",
  "open",
  "closed",
];
export const POLL_PLATFORM_FILTERS: PollPlatformFilter[] = [
  "all",
  "global",
  "qq",
  "discord",
];

export const POLL_PAGE_SIZE = 50;

/** 和成员表单同一套上限，照 can-api 的 `store.NormalizePollInput`。 */
export const POLL_TITLE_MAX = 200;
export const POLL_OPTION_MAX = 100;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 10;
export const POLL_DURATION_MIN = 1;
export const POLL_DURATION_MAX = 10080;
export const POLL_DURATION_DEFAULT = 1440;
/** 分钟：1 小时、6 小时、1 天、3 天、7 天。 */
export const POLL_DURATION_PRESETS = [60, 360, 1440, 4320, 10080] as const;

export interface StaffPollSummary {
  id: number;
  title: string;
  platform: PollPlatform;
  /** 全站投票是 null。 */
  communityHash: string | null;
  official: boolean;
  /** 创建人的 CAN ID，或注销后的占位符。 */
  createdBy: string;
  createdAt: string;
  closesAt: string;
  closedAt: string | null;
  closed: boolean;
  voteCount: number;
}

export interface StaffPollOption {
  number: number;
  text: string;
  votes: number;
}

export interface StaffPoll extends StaffPollSummary {
  options: StaffPollOption[];
}

/**
 * `GET /api/v1/super/poll/{id}` 多给的参与情况。活跃成员 = 帐号未注销且
 * rating ≥ 1，按请求那一刻算，已结束的投票也一样。不再活跃的成员的选票不计入
 * `active*`，仍计入 `votes`。
 */
export interface StaffPollDetailOption extends StaffPollOption {
  activeVotes: number;
}

export interface StaffPollDetail extends StaffPoll {
  options: StaffPollDetailOption[];
  activeMembers: number;
  activeVoters: number;
}

export interface StaffPollPage {
  polls: StaffPollSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PollDraft {
  title: string;
  options: string[];
  durationMinutes: number;
}

export interface PollQuery {
  status: PollStatusFilter;
  platform: PollPlatformFilter;
  page: number;
}

export function pollListPath(query: PollQuery): string {
  const params = new URLSearchParams({
    status: query.status,
    platform: query.platform,
    page: String(query.page),
  });
  return `/api/v1/super/poll?${params.toString()}`;
}

function invalidResponse(what: string): ApiFailure {
  return {
    ok: false,
    status: 200,
    error: "invalid_response",
    message: `${what} missing from response`,
  };
}

export async function listStaffPolls(
  query: PollQuery,
): Promise<ApiResult<StaffPollPage>> {
  const result = await api<Partial<StaffPollPage> | null>(pollListPath(query));
  if (!result.ok) return result;
  const data = result.data;
  if (!data || !Array.isArray(data.polls)) return invalidResponse("polls");
  return {
    ok: true,
    data: {
      polls: data.polls,
      total: Number(data.total ?? data.polls.length),
      page: Number(data.page ?? query.page),
      pageSize: Number(data.pageSize ?? POLL_PAGE_SIZE),
    },
  };
}

async function pollRequest(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<StaffPoll>> {
  const result = await api<{ poll?: StaffPoll } | null>(path, init);
  if (!result.ok) return result;
  const poll = result.data?.poll;
  if (!poll) return invalidResponse("poll");
  return { ok: true, data: poll };
}

export async function getStaffPoll(
  id: number,
): Promise<ApiResult<StaffPoll | StaffPollDetail>> {
  return pollRequest(`/api/v1/super/poll/${id}`);
}

/**
 * 详情带不带参与情况。can-api 还没滚完时会有旧副本回不带这些字段的详情；
 * 那时详情照常打开，只是不显示参与情况。
 */
export function hasTurnout(
  poll: StaffPoll | StaffPollDetail,
): poll is StaffPollDetail {
  const candidate = poll as Partial<StaffPollDetail>;
  return (
    typeof candidate.activeMembers === "number" &&
    typeof candidate.activeVoters === "number" &&
    Array.isArray(candidate.options) &&
    candidate.options.every((option) => typeof option.activeVotes === "number")
  );
}

/** 官方投票：全站范围，can-api 记下创建人。 */
export function createOfficialPoll(
  draft: PollDraft,
): Promise<ApiResult<StaffPoll>> {
  return pollRequest("/api/v1/super/poll", {
    method: "POST",
    body: JSON.stringify({
      title: draft.title,
      options: draft.options,
      durationMinutes: draft.durationMinutes,
    }),
  });
}

export function closeStaffPoll(id: number): Promise<ApiResult<StaffPoll>> {
  return pollRequest(`/api/v1/super/poll/${id}/close`, { method: "POST" });
}

/** 删除投票连同选项和全部选票，不可恢复。 */
export async function deleteStaffPoll(
  id: number,
): Promise<ApiResult<{ deleted: true }>> {
  const result = await api<{ deleted?: boolean } | null>(
    `/api/v1/super/poll/${id}`,
    { method: "DELETE" },
  );
  if (!result.ok) return result;
  if (result.data?.deleted !== true) return invalidResponse("deleted");
  return { ok: true, data: { deleted: true } };
}

/** `polls.manage.errors` 下岛屿会显示的 can-api 失败。 */
export const POLL_ERROR_KINDS = [
  "notFound",
  "closed",
  "invalid",
  "sessionExpired",
  "forbidden",
  "network",
  "failed",
] as const;

export type PollErrorKind = (typeof POLL_ERROR_KINDS)[number];

export function classifyPollError(failure: ApiFailure): PollErrorKind {
  switch (failure.error) {
    case "poll_not_found":
      return "notFound";
    case "poll_closed":
      return "closed";
    case "invalid_poll":
    case "invalid_request":
      return "invalid";
    case "unauthorized":
      return "sessionExpired";
    case "forbidden":
      return "forbidden";
    case "network":
      return "network";
  }
  if (failure.status === 401) return "sessionExpired";
  if (failure.status === 403) return "forbidden";
  if (failure.status === 404) return "notFound";
  return "failed";
}

/** 列表上显示的社区短哈希：前 8 位十六进制。 */
export function shortHash(hash: string | null): string | null {
  return hash ? hash.slice(0, 8) : null;
}

/** `closed` 是列表取回时算的；页面开久了，再看一眼时钟。 */
export function isPollOpen(
  poll: Pick<StaffPollSummary, "closed" | "closesAt">,
  now: number = Date.now(),
): boolean {
  return !poll.closed && Date.parse(poll.closesAt) > now;
}

export function pageCount(total: number, pageSize: number): number {
  if (!(total > 0) || !(pageSize > 0)) return 1;
  return Math.ceil(total / pageSize);
}

/** 整数百分比；没人投票时是 0。 */
export function optionPercent(votes: number, total: number): number {
  if (!(total > 0) || !(votes > 0)) return 0;
  return Math.round((votes / total) * 100);
}

/** 占活跃成员的百分比，保留一位小数，四舍五入；没有活跃成员时是 0。 */
export function memberShare(count: number, activeMembers: number): number {
  if (!(activeMembers > 0) || !(count > 0)) return 0;
  return Math.round((count * 1000) / activeMembers) / 10;
}

export interface PollTurnoutOption {
  number: number;
  text: string;
  activeVotes: number;
  share: number;
}

export interface PollTurnout {
  activeMembers: number;
  options: PollTurnoutOption[];
  notVoted: number;
  notVotedShare: number;
}

/** 每个选项和未投票的人各占当前活跃成员的多少。 */
export function pollTurnout(poll: StaffPollDetail): PollTurnout {
  const notVoted = Math.max(0, poll.activeMembers - poll.activeVoters);
  return {
    activeMembers: poll.activeMembers,
    options: poll.options.map((option) => ({
      number: option.number,
      text: option.text,
      activeVotes: option.activeVotes,
      share: memberShare(option.activeVotes, poll.activeMembers),
    })),
    notVoted,
    notVotedShare: memberShare(notVoted, poll.activeMembers),
  };
}

/** `polls.manage.form.errors` 下的键。 */
export type PollDraftError =
  | "titleRequired"
  | "titleTooLong"
  | "optionsTooFew"
  | "optionsTooMany"
  | "optionTooLong"
  | "optionDuplicate"
  | "durationRange";

export const POLL_DRAFT_ERRORS: PollDraftError[] = [
  "titleRequired",
  "titleTooLong",
  "optionsTooFew",
  "optionsTooMany",
  "optionTooLong",
  "optionDuplicate",
  "durationRange",
];

export interface PollDraftErrors {
  title?: PollDraftError;
  options?: PollDraftError;
  duration?: PollDraftError;
}

export type PollDraftCheck =
  { ok: true; draft: PollDraft } | { ok: false; errors: PollDraftErrors };

/** 按码点计长，和 can-api 数 rune 一致。 */
function codePoints(value: string): number {
  return [...value].length;
}

/**
 * 校验新建表单并给出请求体。标题和选项去首尾空白，空行丢掉；去空白后完全相同
 * 的选项算重复，和服务端一致。
 */
export function validatePollDraft(input: {
  title: string;
  options: string[];
  durationMinutes: number;
}): PollDraftCheck {
  const errors: PollDraftErrors = {};

  const title = input.title.trim();
  if (!title) errors.title = "titleRequired";
  else if (codePoints(title) > POLL_TITLE_MAX) errors.title = "titleTooLong";

  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < POLL_OPTIONS_MIN) errors.options = "optionsTooFew";
  else if (options.length > POLL_OPTIONS_MAX) errors.options = "optionsTooMany";
  else if (options.some((o) => codePoints(o) > POLL_OPTION_MAX))
    errors.options = "optionTooLong";
  else if (new Set(options).size !== options.length)
    errors.options = "optionDuplicate";

  const duration = input.durationMinutes;
  if (
    !Number.isInteger(duration) ||
    duration < POLL_DURATION_MIN ||
    duration > POLL_DURATION_MAX
  )
    errors.duration = "durationRange";

  if (errors.title || errors.options || errors.duration)
    return { ok: false, errors };
  return { ok: true, draft: { title, options, durationMinutes: duration } };
}
