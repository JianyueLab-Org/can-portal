/**
 * 管理操作时间线的查询串。
 *
 * 浏览器安全：不 import `src/server` 下的任何东西。形状照 can-api 的
 * `GET /api/v1/super/audit` 契约写 —— camelCase，`createdAt` 是 RFC3339，
 * `target` / `region` / `nextCursor` 可空。筛选放在这里而不是岛屿里，是为了
 * 让 `bun test` 钉得住「空的不送、游标要送、limit 永远是 50」。
 */

export const AUDIT_PAGE_SIZE = 50;

/** 操作下拉的分组，和词典 `audit.groups` / `audit.actions` 同一套键。 */
export const ACTION_GROUPS: Array<{ group: string; actions: string[] }> = [
  { group: "roster", actions: ["roster.update"] },
  { group: "promotion", actions: ["promotion.raise", "promotion.decide"] },
  { group: "points", actions: ["points.adjust", "points.reverse"] },
  {
    group: "activity",
    actions: [
      "activity.create",
      "activity.update",
      "activity.addRoute",
      "activity.deleteRoute",
      "activity.addPosition",
      "activity.updatePosition",
      "activity.deletePosition",
      "activity.releasePosition",
      "activity.attendance",
      "activity.settle",
      "activity.cancel",
    ],
  },
  {
    group: "prize",
    actions: ["prize.upsert", "prize.delete", "redemption.update"],
  },
  {
    group: "lottery",
    actions: [
      "lottery.create",
      "lottery.update",
      "lottery.publish",
      "lottery.cancel",
    ],
  },
  { group: "feedback", actions: ["feedback.upsert", "feedback.delete"] },
  {
    group: "server",
    actions: ["server.create", "server.update", "server.retire"],
  },
  { group: "access", actions: ["aipAccess.grant", "developer.set"] },
];

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  region: number | null;
  changes: Record<string, unknown>;
  summary: string;
  /** RFC3339 UTC。 */
  createdAt: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: number | null;
}

export function listPath(q: {
  action?: string;
  actor?: string;
  target?: string;
  cursor?: number | null;
}): string {
  const p = new URLSearchParams();
  if (q.action) p.set("action", q.action);
  if (q.actor) p.set("actor", q.actor);
  if (q.target) p.set("target", q.target);
  if (q.cursor) p.set("cursor", String(q.cursor));
  p.set("limit", String(AUDIT_PAGE_SIZE));
  const s = p.toString();
  return s
    ? `/api/v1/super/audit?${s}`
    : `/api/v1/super/audit?limit=${AUDIT_PAGE_SIZE}`;
}
