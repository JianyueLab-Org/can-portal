/**
 * 活动与积分规则，UI 与服务端共用。
 *
 * Browser-safe（不 import prisma）——活动面板对未登录访客可见，报名控件也要在
 * 客户端判断当前用户能选哪些身份。真正的写操作仍由服务端守卫强制，见
 * `src/pages/api/v1/activity/*` 与 `src/server/withSup.ts`。
 *
 * 积分只在「活动结束、SUP/ADM 确认到场」时发放，报名本身不给分；发放的数值在
 * 结算时快照写入 `activityRegistration.pointsAwarded`，因此日后调整下面的公式
 * 不会改动已结算的历史余额。
 */

/** 报名身份。0 飞行员 · 1 管制员 · 2 SUP（带队/监督，不积分）。 */
export type ActivityRole = 0 | 1 | 2;

export const ROLE = { pilot: 0, controller: 1, sup: 2 } as const;

/**
 * 活动管理端的门槛（11 = SUP，见 ratingTrans）——建活动、勾到场、结算发分，以及
 * 在 ATC 预约看板上撤销他人的预约，只有 SUP/ADM 能做。想改门槛只改这里，UI 从
 * 常量读取，服务端（can-api 的 `WithSup` / `MinSupRating`）据此强制。
 *
 * 它**不再**是"选 SUP 身份报名"的门槛：SUP 是工作身份而非报名身份，can-api 的
 * `/api/v1/activity/register` 只接受飞行员与管制员，见 `registrableRoles`。
 */
export const MIN_SUP_RATING = 11;

/**
 * 活动简述的长度上限。`activity.description` 是 TEXT（64 KB），超长的请求会在
 * 数据库层抛错变成 500——在路由里先挡下来，UI 也据此限制输入。
 */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** 航路串的长度上限，与飞行计划里的 `route` 同量级。 */
export const MAX_ROUTE_LENGTH = 1000;

/** 单场活动最多开几条航线／几个席位。纯粹是防手滑批量灌数据的上限。 */
export const MAX_ROUTES_PER_ACTIVITY = 20;
export const MAX_POSITIONS_PER_ACTIVITY = 60;

/**
 * 每参加一次活动可得的积分。飞行员/管制员按大纲；SUP 为带队/监督身份，不积分。
 */
export const POINTS: Record<
  ActivityRole,
  { casual: number; professional: number }
> = {
  0: { casual: 2, professional: 5 }, // 飞行员
  1: { casual: 5, professional: 8 }, // 管制员
  2: { casual: 0, professional: 0 }, // SUP —— 不积分
};

/**
 * 活动时间的两种写法，两者始终一起展示。
 *
 * Zulu 是活动对外公布的口径（带 `Z` 后缀），本地时间由浏览器时区自动换算——用户
 * 不需要选，也不需要自己心算。拼接由词典里的 `timeWithLocal` 完成，避免把中英文
 * 连接词写死在组件里。
 */
const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatZulu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
}

export function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 结束时间是否合法。`activity.endsAt` 可空（见 schema），有值时唯一的规则是
 * 必须晚于开始时间。
 *
 * 刻意不设时长上限：连续数周的 tour 型活动是常见玩法，写死一个上限只会把它们
 * 挡在外面。写错年份这类手滑由管理端的「Zulu / 本地时间」预览暴露——两个时间
 * 都摆在眼前，比一条武断的规则更管用。
 */
export function isValidActivityEnd(
  startsAt: Date | string,
  endsAt: Date | string,
): boolean {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function pointsFor(role: ActivityRole, professional: boolean): number {
  const rule = POINTS[role];
  return professional ? rule.professional : rule.casual;
}

export function isActivityRole(value: unknown): value is ActivityRole {
  return value === 0 || value === 1 || value === 2;
}

/**
 * 可自助选择的报名身份：只有飞行员与管制员。
 *
 * SUP（2）刻意不在其中。它是带队/监督的工作身份，由管理端在名单上体现，不积分，
 * 也没有任何写入路径能让会员自己选——can-api 的 `/api/v1/activity/register` 对
 * role=2 直接 400 `invalidRole`。此前这里按 rating ≥ 11 把 SUP 放进下拉框，于是
 * 每个 SUP 都能选一个必然报错的身份，而报错文案还落回通用的"报名失败"。
 *
 * 保留 `rating` 形参：调用点按 rating 计算选项是这里唯一的入口，日后若某个身份
 * 重新需要按等级开放，改这一个函数即可。
 */
export function registrableRoles(_rating?: number | undefined): ActivityRole[] {
  return [0, 1];
}

/* ------------------------------------------------------------------ *
 * 管制席位预约
 * ------------------------------------------------------------------ */

/**
 * 可预约的席位类型，编号沿用全站的 facility 编号（见 src/lib/facilities.ts）。
 * OBS/FSS/ATIS 不在其中——它们不是活动里要排班的席位。
 */
export type ActivityFacility = 2 | 3 | 4 | 5 | 6;

export const FACILITY = { del: 2, gnd: 3, twr: 4, app: 5, ctr: 6 } as const;

/** 席位从低到高，UI 的下拉框与详情页的分组顺序都取自这里。 */
export const BOOKABLE_FACILITIES: ActivityFacility[] = [2, 3, 4, 5, 6];

/** facility → 词典键／短代号。短代号就是席位在呼号里的后缀。 */
export const FACILITY_KEYS: Record<ActivityFacility, string> = {
  2: "del",
  3: "gnd",
  4: "twr",
  5: "app",
  6: "ctr",
};

export const FACILITY_CODES: Record<ActivityFacility, string> = {
  2: "DEL",
  3: "GND",
  4: "TWR",
  5: "APP",
  6: "CTR",
};

/**
 * 开席时填入 `activityPosition.minRating` 的默认值（见 ratingTrans 的编号）：
 * DEL/GND 需 S1，TWR 需 S2，APP 需 S3，CTR 需 C1。
 *
 * 只是默认值——真正生效的是每个席位自己存下的 `minRating`，SUP 开席时可以调
 * 高（新人场留给学员）或调低（教学活动带飞）。因此改动这里不会影响已开出的
 * 席位，正如改积分公式不会重写已结算的历史。
 */
export const DEFAULT_FACILITY_MIN_RATING: Record<ActivityFacility, number> = {
  2: 2, // DEL — S1
  3: 2, // GND — S1
  4: 3, // TWR — S2
  5: 4, // APP — S3
  6: 5, // CTR — C1
};

export function isActivityFacility(value: unknown): value is ActivityFacility {
  return (
    value === 2 || value === 3 || value === 4 || value === 5 || value === 6
  );
}

/** 该 rating 能否认领要求 `minRating` 的席位。 */
export function canBookPosition(
  rating: number | undefined,
  minRating: number,
): boolean {
  return typeof rating === "number" && rating >= minRating;
}

/**
 * 机场／管制区代码统一按 4 字母 ICAO 处理：大写、去空格。
 * 服务端与表单共用，免得一个存 "zbaa" 一个存 "ZBAA " 而分成两组。
 */
export function normalizeIcao(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function isValidIcao(value: string): boolean {
  return /^[A-Z]{4}$/.test(value);
}

/** 席位呼号：字母数字加下划线／连字符，长度对齐 schema 的 VarChar(16)。 */
export function normalizeCallsign(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function isValidCallsign(value: string): boolean {
  return /^[A-Z0-9_-]{3,16}$/.test(value);
}

/** 开席时的默认呼号，例如 ZBAA + TWR → ZBAA_TWR。 */
export function defaultCallsign(
  airport: string,
  facility: ActivityFacility,
): string {
  const icao = normalizeIcao(airport);
  return icao ? `${icao}_${FACILITY_CODES[facility]}` : "";
}

/**
 * 频率按 VHF 航空频段校验（118.000–136.975，25 kHz 间隔之外的也放过——8.33 kHz
 * 频道的小数位不是 25 的整数倍）。空频率是允许的：席位可以先开出来，频率等
 * 排班定了再补。
 */
export function isValidFrequency(value: string): boolean {
  if (!/^1[123]\d\.\d{3}$/.test(value)) return false;
  const mhz = Number(value);
  return mhz >= 118 && mhz <= 136.975;
}

/** 席位在详情页里的排序：先按机场，再按席位由低到高。 */
export function comparePositions(
  a: { airport: string; facility: number; callsign: string },
  b: { airport: string; facility: number; callsign: string },
): number {
  return (
    a.airport.localeCompare(b.airport) ||
    a.facility - b.facility ||
    a.callsign.localeCompare(b.callsign)
  );
}
