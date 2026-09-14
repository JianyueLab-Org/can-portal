/**
 * 一个机场从放行到区调的整摞管制席位，翻成活动排班要的形状。
 *
 * ## 为什么不在这边按呼号拼
 *
 * 开一场活动要开的席位，从前是人一个一个填：机场 + 席位类型 → `ZBAA_TWR`，频率自己
 * 查。**那个拼法对大场是错的**，而错得没有任何提示：
 *
 *  - 浦东的进近是 `ZSSS_APP`（虹桥进近管浦东），`ZSPD_APP` 这个呼号不存在。
 *  - 石家庄没有自己的区调，管它的是 `ZBAA_W_CTR` → `ZBAA_CTR` → `ZBPE_CTR`。
 *  - 桃园的区调全姓 `TPE_`，一个不姓 `RCTP`。
 *
 * 拼出来的呼号**看起来完全正常**，于是一场活动会开在一个不存在的席位上，直到当天没
 * 人能连上去。can-db 的 `/api/v1/aip/airports/{icao}/positions` 是照扇区包的 owner 链
 * 解出来的，那条规则在那边定义一次 —— 这里只做形状翻译。
 *
 * ## 翻译里有三处判断，都是这一侧的事实决定的
 *
 * **`DEP` 并进 `APP`。** can-db 有六层，活动的 `ActivityFacility` 只有五个
 * （DEL/GND/TWR/APP/CTR），因为它是全站通用的席位编号，不是为扇区包定义的。呼号原样
 * 保留 —— `RJTT_DEP` 进来还是 `RJTT_DEP`，只是归在进近那一格里。改
 * `ActivityFacility` 要连着 can-api 的 schema、报名控件、详情页分组一起改，而这里只
 * 是一个显示分组。
 *
 * **同一呼号的多个频率合成一行。** can-db 刻意不合并（`RJTT_TWR` 三行三个频率是真数
 * 据），而 `activityPosition` 上是 `@@unique([activityId, callsign])` —— **一场活动
 * 里一个呼号只能开一次**。三行全勾会是一个成功两个 409，所以在这里按呼号合并，频率
 * 摆成一组让人挑。合并发生在这边而不是那边，因为「一场活动里呼号唯一」是 can-api 的
 * 约束，不是航行资料的性质。
 *
 * **频率保留三位小数。** `isValidFrequency` 要 `118.000`–`136.975` 这个写法；线上六
 * 层席位的频率是 118.000–135.900，没有一行超范围、也没有一行三位小数放不下。
 *
 * **服务端专用**，绝不能被岛屿 import。
 */
import type { APIContext } from "astro";
import { callDb } from "@/server/canDb";
import {
  DEFAULT_FACILITY_MIN_RATING,
  isValidCallsign,
  type ActivityFacility,
} from "@/lib/activities";
import type { AirportStack, StackSeat } from "@/lib/positionStack";

/** can-db 回包里这一侧读得到的字段。其余的（二次雷达码段、可见点）刻意不取。 */
export interface DbAirportPosition {
  callsign: string;
  freqMhz: number | null;
  identifier: string | null;
  facility: string;
  source: "prefix" | "chain" | "fallback";
  rank: number | null;
  primary: boolean;
}

export interface DbAirportStack {
  icao: string;
  hasChain: boolean;
  hasEnroute: boolean;
  positions: DbAirportPosition[];
}

/**
 * can-db 的六层 → 全站的五个 `ActivityFacility`。
 *
 * 表里没有的一律丢掉而不是兜底成某一层：can-db 只返回这六层，多出来的一种意味着上
 * 游加了新席位类型，那时该有人来决定它归哪一格，而不是让它悄悄变成进近。
 */
const FACILITY_OF: Record<string, ActivityFacility> = {
  DEL: 2,
  GND: 3,
  TWR: 4,
  APP: 5,
  DEP: 5,
  CTR: 6,
};

export async function readAirportStack(
  context: Pick<APIContext, "request">,
  icao: string,
): Promise<AirportStack | null> {
  const stack = await callDb<DbAirportStack>(
    context,
    `/api/v1/aip/airports/${encodeURIComponent(icao)}/positions`,
  );
  if (!stack) return null;
  return toStack(stack, icao);
}

/**
 * can-db 的回包 → 这一侧的形状。取数之外的全部判断都在这里，**所以它是导出的**：
 * 上面那个函数要一个网络，这个不要，而会静默出错的是这一段 —— 一个开错席位的活动
 * 不会报任何错，只会在当天发现没人连得上。`positionStack.test.ts` 钉着它。
 */
export function toStack(stack: DbAirportStack, icao: string): AirportStack {
  // 按 (层, 呼号) 合并。Map 保序，而 can-db 已经按「从下往上、每层 primary 在前」排
  // 好了 —— 所以插入顺序就是要显示的顺序，这边一次都不用再排。
  const merged = new Map<string, StackSeat>();
  for (const p of stack.positions ?? []) {
    const facility = FACILITY_OF[p.facility];
    if (facility === undefined) continue;
    // 呼号过不了本站的校验就不摆出来 —— 摆出来也只会在提交时被 can-api 400，而那时
    // 人已经勾了它。线上 888 行席位最长 11 字符，这一条今天一行都拦不掉。
    if (!isValidCallsign(p.callsign)) continue;

    const key = `${facility}:${p.callsign}`;
    const freq = p.freqMhz === null ? null : p.freqMhz.toFixed(3);
    const existing = merged.get(key);
    if (existing) {
      if (freq && !existing.frequencies.includes(freq)) {
        existing.frequencies.push(freq);
      }
      // primary 在 can-db 那边标的是**一行**，而这里一个呼号可能有好几行。
      existing.primary ||= p.primary;
      continue;
    }
    merged.set(key, {
      facility,
      callsign: p.callsign,
      frequencies: freq ? [freq] : [],
      minRating: DEFAULT_FACILITY_MIN_RATING[facility],
      primary: p.primary,
      own: p.callsign.split("_")[0] === icao,
      source: p.source,
    });
  }

  return {
    icao: stack.icao,
    hasChain: stack.hasChain,
    hasEnroute: stack.hasEnroute,
    seats: [...merged.values()],
  };
}
