/**
 * The feedback disclosure board: what a case must contain before it can be
 * published, and how its public reference is spelled.
 *
 * Browser-safe and shared, so the form explains the same rules the API
 * enforces — the pattern `@/lib/activities`, `@/lib/flightplan` and
 * `@/lib/rewards` already follow.
 */

export const CASE_DRAFT = 0;
export const CASE_PUBLISHED = 1;

export const CASE_STATUS: Record<number, string> = {
  [CASE_DRAFT]: "draft",
  [CASE_PUBLISHED]: "published",
};

export const LIMITS = {
  title: 160,
  summary: 2000,
  result: 2000,
  /** More than this on one case and it is a list, not a decision. */
  handlers: 10,
} as const;

/**
 * 案件编号（`FB-2026-0007`）不在这里发。
 *
 * 这里原本有一对 `formatCaseCode`／`parseCaseSequence`，写好了却从来没有人调
 * 用 —— 表单里没有编号这一栏，而 can-api 把 `code` 当必填，于是「新建案件」
 * 从上线那天起每一次都是 400，这块板子没能建成过一条案件。
 *
 * 补法是把发号交给 can-api，不是把这两个函数接上：`feedbackCase.code` 是唯一
 * 键，而按序号发号要先知道今年最大的那个是几 —— 浏览器只能照着自己手上那份
 * 列表猜，两个 SUP 同时新建就撞号。约束在哪边，发号就该在哪边，而且要在同一
 * 个事务里。格式因此也只写在那边一处。
 */

export interface CaseInput {
  title: string;
  summary: string;
  result: string;
  subject: string;
  handlers: string[];
}

export type CaseErrors = Partial<Record<keyof CaseInput, string>>;

/**
 * Validate a case. Error values are i18n keys under `feedback.manage.errors`.
 *
 * A handler is required even for a draft: a decision nobody is named against
 * is exactly what this board exists to stop.
 */
export function validateCase(input: CaseInput): CaseErrors {
  const errors: CaseErrors = {};

  const title = input.title.trim();
  if (!title) errors.title = "titleRequired";
  else if (title.length > LIMITS.title) errors.title = "titleLength";

  const summary = input.summary.trim();
  if (!summary) errors.summary = "summaryRequired";
  else if (summary.length > LIMITS.summary) errors.summary = "summaryLength";

  const result = input.result.trim();
  if (!result) errors.result = "resultRequired";
  else if (result.length > LIMITS.result) errors.result = "resultLength";

  if (!input.handlers.length) errors.handlers = "handlerRequired";
  else if (input.handlers.length > LIMITS.handlers)
    errors.handlers = "handlerCount";

  return errors;
}

export function hasErrors(errors: CaseErrors): boolean {
  return Object.keys(errors).length > 0;
}
