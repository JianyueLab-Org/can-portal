/**
 * 抽奖管理页的线上形状和表单规则。
 *
 * 浏览器安全：不 import `src/server` 下的任何东西。形状照 can-api 的
 * `/api/v1/super/lottery` 契约写 —— camelCase，时间是 RFC3339，状态 0 草稿 /
 * 1 进行中 / 2 已开奖 / 3 已取消。规则放在这里而不是岛屿里，是为了让 `bun test`
 * 钉得住它们。
 */

export const LOTTERY_DRAFT = 0;
export const LOTTERY_OPEN = 1;
export const LOTTERY_DRAWN = 2;
export const LOTTERY_CANCELLED = 3;

/** 状态值到 `lottery.manage.status.*` 的键。 */
export const LOTTERY_STATUS: Record<number, string> = {
  [LOTTERY_DRAFT]: "draft",
  [LOTTERY_OPEN]: "open",
  [LOTTERY_DRAWN]: "drawn",
  [LOTTERY_CANCELLED]: "cancelled",
};

/**
 * `title` 是 schema 上的 VarChar(120)。`description` 是 Text，2000 和活动说明
 * 同一个数。`count` 的上限和奖品库存上限（`LIMITS.stock`）一致。
 */
export const LOTTERY_LIMITS = {
  title: 120,
  description: 2000,
  count: 100_000,
} as const;

export interface LotteryPrize {
  prizeId: number;
  name: string;
  count: number;
}

export interface LotterySummary {
  id: number;
  title: string;
  description: string | null;
  closesAt: string;
  drawnAt: string | null;
  status: number;
  entryCount: number;
  entered: boolean;
  prizes: LotteryPrize[];
}

export interface LotteryWinner {
  username: string;
  prizeId: number;
  prizeName: string;
}

export interface LotteryEntry {
  username: string;
  createdAt: string;
  prizeId: number | null;
}

export interface SuperLotteryDetail extends LotterySummary {
  winners: LotteryWinner[];
  /** 调用者自己中了什么。管理页不读它，所以不约束形状。 */
  won: unknown;
  entries: LotteryEntry[];
}

/** `/api/v1/super/prize` 里这一页用得到的字段。 */
export interface ShopPrize {
  id: number;
  name: string;
  stock: number;
}

export interface LotteryForm {
  title: string;
  description: string;
  /** `datetime-local` 的值，不带时区。 */
  closesAt: string;
  /** `"zulu"` 或 `"local"`。是 string 而不是联合类型，因为 `Select` 回传 string。 */
  timezone: string;
  /** prizeId → 输入框里的数量。空串和 "0" 表示不选。 */
  counts: Record<number, string>;
}

export type LotteryFormErrors = Partial<
  Record<"title" | "description" | "closesAt" | "prizes", string>
>;

export interface LotteryBody {
  title: string;
  description: string | null;
  closesAt: string;
  prizes: Array<{ prizeId: number; count: number }>;
}

export interface PickerRow {
  prizeId: number;
  name: string;
  /** null 表示这件奖品已经不在商店里了（草稿里还挂着它）。 */
  stock: number | null;
}

export function emptyForm(): LotteryForm {
  return {
    title: "",
    description: "",
    closesAt: "",
    timezone: "zulu",
    counts: {},
  };
}

/** 不带时区的 `datetime-local` 值，按选定的时区读成一个绝对时刻。 */
export function toInstant(value: string, timezone: string): Date {
  if (!value) return new Date(Number.NaN);
  const text = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? `${value}:00`
    : value;
  return new Date(timezone === "zulu" ? `${text}Z` : text);
}

/** 一个 ISO 时刻，写成 `datetime-local` 要的 Zulu `YYYY-MM-DDTHH:mm`。 */
export function toZuluInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16);
}

/** 把一期草稿装回表单。编辑一律用 Zulu，和活动编辑一致。 */
export function formFromLottery(lottery: LotterySummary): LotteryForm {
  const counts: Record<number, string> = {};
  for (const prize of lottery.prizes) {
    counts[prize.prizeId] = String(prize.count);
  }
  return {
    title: lottery.title,
    description: lottery.description ?? "",
    closesAt: toZuluInput(lottery.closesAt),
    timezone: "zulu",
    counts,
  };
}

function isBlank(value: string | undefined): boolean {
  const text = (value ?? "").trim();
  return text === "" || text === "0";
}

/** 填了数量的奖品，按 prizeId 升序。不校验数量本身 —— 那是 validateLottery 的事。 */
export function selectedPrizes(
  counts: Record<number, string>,
): Array<{ prizeId: number; count: number }> {
  return Object.entries(counts)
    .filter(([, value]) => !isBlank(value))
    .map(([id, value]) => ({
      prizeId: Number(id),
      count: Number(value.trim()),
    }))
    .sort((a, b) => a.prizeId - b.prizeId);
}

/**
 * 校验表单。错误值是 `lottery.manage.errors` 下的键。
 *
 * `closesAt` 必须晚于现在，和 can-api 的规则相同 —— 在这里先判，省一次往返。
 */
export function validateLottery(
  form: LotteryForm,
  now: Date,
): LotteryFormErrors {
  const errors: LotteryFormErrors = {};

  const title = form.title.trim();
  if (!title) errors.title = "titleRequired";
  else if (title.length > LOTTERY_LIMITS.title) errors.title = "titleLength";

  if (form.description.trim().length > LOTTERY_LIMITS.description) {
    errors.description = "descriptionLength";
  }

  const closesAt = toInstant(form.closesAt, form.timezone);
  if (Number.isNaN(closesAt.getTime())) errors.closesAt = "closesAtRequired";
  else if (closesAt.getTime() <= now.getTime())
    errors.closesAt = "closesAtPast";

  const picked = selectedPrizes(form.counts);
  const badCount = picked.some(
    (p) =>
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > LOTTERY_LIMITS.count,
  );
  if (badCount) errors.prizes = "count";
  else if (picked.length === 0) errors.prizes = "prizesRequired";

  return errors;
}

export function hasErrors(errors: LotteryFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * 请求体。不要直接序列化表单：表单里的数量是 `<input>` 绑的字符串，can-api
 * 那边是 Go 的 int —— `rewards.ts` 的 `prizeBody` 记着这一条出过的事。
 */
export function lotteryBody(form: LotteryForm): LotteryBody {
  const description = form.description.trim();
  return {
    title: form.title.trim(),
    description: description || null,
    closesAt: toInstant(form.closesAt, form.timezone).toISOString(),
    prizes: selectedPrizes(form.counts),
  };
}

/** 数量超过当前库存的奖品。只是提示：草稿可以先存，发布时 can-api 才扣库存。 */
export function shortfalls(
  shop: ShopPrize[],
  counts: Record<number, string>,
): number[] {
  const stock = new Map(shop.map((p) => [p.id, p.stock]));
  return selectedPrizes(counts)
    .filter((p) => {
      const available = stock.get(p.prizeId);
      return available !== undefined && p.count > available;
    })
    .map((p) => p.prizeId);
}

/**
 * 选择器的行：商店里的奖品按商店顺序，再加上草稿里挂着、商店里已经没有的那几件。
 * 后者不列出来就没法把数量清掉，草稿会一直带着一件发布不了的奖品。
 */
export function pickerRows(
  shop: ShopPrize[],
  current: LotteryPrize[],
): PickerRow[] {
  const rows: PickerRow[] = shop.map((p) => ({
    prizeId: p.id,
    name: p.name,
    stock: p.stock,
  }));
  const known = new Set(shop.map((p) => p.id));
  for (const prize of current) {
    if (!known.has(prize.prizeId)) {
      rows.push({ prizeId: prize.prizeId, name: prize.name, stock: null });
    }
  }
  return rows;
}

/** 一期抽奖一共送出几件。 */
export function unitsOf(prizes: LotteryPrize[]): number {
  return prizes.reduce((sum, p) => sum + p.count, 0);
}

/** 只有草稿能改、能发布。 */
export function canEdit(status: number): boolean {
  return status === LOTTERY_DRAFT;
}

/** 草稿和进行中的可以取消；已开奖、已取消的不行。 */
export function canCancel(status: number): boolean {
  return status === LOTTERY_DRAFT || status === LOTTERY_OPEN;
}

/** 截止时间是否已经过了。发布一份过期的草稿等于立刻开一次没人报名的奖。 */
export function hasClosed(closesAt: string, now: Date): boolean {
  return new Date(closesAt).getTime() <= now.getTime();
}

const ERROR_KEYS: Record<string, string> = {
  invalid_request: "invalidRequest",
  lottery_not_found: "notFound",
  insufficient_stock: "insufficientStock",
  not_draft: "notDraft",
  not_cancellable: "notCancellable",
  // 控制器裁定（覆盖任务简报）：发布一份 closesAt 已过的草稿时 can-api 答
  // 409 `lottery_closed`。`lottery.manage.errors.publishExpired` 这个词典键
  // 留给任务 2 补。
  lottery_closed: "publishExpired",
  network: "network",
};

/**
 * can-api 的错误码 → `lottery.manage.errors` 下的键。
 *
 * 走 `Object.hasOwn`：`ERROR_KEYS["toString"]` 会拿到一个函数，理由和反代的
 * `lookup()` 一样。
 */
export function errorKey(code: string): string {
  const key = Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : undefined;
  return key ?? "actionFailed";
}
