/**
 * 等级信息接口
 */
interface Rating {
  id: number;
  short: string;
  long: string;
}

/**
 * 等级数据列表
 */
const ratings: Rating[] = [
  { id: -1, short: "INAC", long: "Inactive" },
  { id: 0, short: "SUS", long: "Suspended" },
  { id: 1, short: "OBS", long: "Observer" },
  { id: 2, short: "S1", long: "Tower Trainee" },
  { id: 3, short: "S2", long: "Tower Controller" },
  { id: 4, short: "S3", long: "Senior Student" },
  { id: 5, short: "C1", long: "Enroute Controller" },
  { id: 6, short: "C2", long: "Senior Controller" },
  { id: 7, short: "C3", long: "Advanced Controller" },
  { id: 8, short: "I1", long: "Instructor" },
  { id: 9, short: "I2", long: "Senior Instructor" },
  { id: 10, short: "I3", long: "Advanced Instructor" },
  { id: 11, short: "SUP", long: "Supervisor" },
  { id: 12, short: "ADM", long: "Administrator" },
];

/**
 * 等级中文翻译映射
 */
const ratingChineseMap: Record<string, string> = {
  Inactive: "未激活",
  Suspended: "已暂停",
  Observer: "观察员",
  "Tower Trainee": "塔台学员",
  "Tower Controller": "塔台管制员",
  "Senior Student": "高级学员",
  "Enroute Controller": "航路管制员",
  "Senior Controller": "中级管制员",
  "Advanced Controller": "高级管制员",
  Instructor: "教员",
  "Senior Instructor": "中级教员",
  "Advanced Instructor": "高级教员",
  Supervisor: "监督员",
  Administrator: "管理员",
};

/**
 * 根据等级 ID、简称或全称获取等级信息
 * @param value - 等级ID、简称或全称
 * @param lang - 语言，可选 'en' 或 'zh'，默认为 'zh'
 * @param returnType - 返回类型，可选 'full'（完整对象）或 'short'（仅简称）或 'long'（仅全称）或 'chinese'（仅中文名称），默认为 'full'
 * @returns 根据returnType返回不同类型的结果
 */
export function ratingTrans(
  value: number | string,
  lang: "en" | "zh" = "zh",
  returnType: "full" | "short" | "long" | "chinese" = "full",
): (Rating & { chinese?: string }) | string | null {
  let rating: Rating | undefined;

  // 根据不同类型的输入查找等级
  if (typeof value === "number") {
    // 按ID查找
    rating = ratings.find((r) => r.id === value);
  } else {
    {
      // 尝试将字符串转换为数字
      {
        const numValue = parseInt(value, 10);
        if (!isNaN(numValue)) {
          // 按ID查找
          rating = ratings.find((r) => r.id === numValue);
        } else {
          // 按简称或全称查找
          rating = ratings.find(
            (r) =>
              r.short.toLowerCase() === value.toLowerCase() ||
              r.long.toLowerCase() === value.toLowerCase(),
          );
        }
      }
    }
  }

  // 如果找不到等级，返回null
  if (!rating) {
    return null;
  }

  // 根据returnType返回不同类型的结果
  switch (returnType) {
    case "short":
      return rating.short;
    case "long":
      return rating.long;
    case "chinese":
      return ratingChineseMap[rating.long] || rating.long;
    case "full":
    default:
      // 根据语言返回不同的结果
      if (lang === "en") {
        return { ...rating };
      } else {
        // 返回包含中文翻译的结果
        return {
          ...rating,
          chinese: ratingChineseMap[rating.long] || rating.long,
        };
      }
  }
}

/**
 * A rating as it arrives from can-api.
 *
 * **It is not one shape.** Most routes render it server-side as
 * `{id, short, long, zh}` — a desktop client has no dictionary to look one up
 * in — while a few answer the bare integer the column holds: `/api/v1/atc/roster`'s
 * `byRegion` does, deliberately, in the same response whose `users` list does not.
 *
 * Reading the wrong one is not a visible failure. `ratingTrans` takes anything
 * that is not a `number` down its string branch and calls `.toLowerCase()` on
 * it, which throws on an object — mid-render, out of a computed, taking the
 * whole table with it rather than rendering one wrong cell. That is what the
 * promotion queue and the promotion desk both did. Funnel every rating that
 * came off the network through `ratingId` before doing anything else with it.
 */
export type RatingRef =
  | number
  | {
      id?: number | null;
      short?: string | null;
      long?: string | null;
      zh?: string | null;
    };

/**
 * The numeric rating, whichever of the two shapes can-api used.
 *
 * Absent or unrecognised gives `NaN`, which `ratingTrans` reports as "Unknown"
 * — a rating outside the table is a data problem, and picking a real rating to
 * stand in for it (0 is Suspended, -1 is Inactive) would hide it.
 */
export function ratingId(value: RatingRef | null | undefined): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && typeof value.id === "number") {
    return value.id;
  }
  return NaN;
}

const divisionRegionMap: Record<string, string> = {
  "1": "PRC",
  "2": "USA",
  "3": "JPN",
  "4": "HK",
};

/**
 * 根据分部区域代码获取英文简称
 * @param regionCode - 分部区域代码 (1, 2, 3, 4)
 * @returns 英文简称 (PRC, USA, JPN, HK)
 */
export function divisionTrans(regionCode: string | number): string {
  const codeStr = regionCode.toString();
  return divisionRegionMap[codeStr] || "Unknown";
}
