/**
 * 一个机场整摞管制席位的形状，浏览器和服务端共用。
 *
 * 取数和翻译在 `src/server/positionStack.ts`（它读集群内的 can-db，岛屿打不到）；这
 * 里只有类型，和 `lib/sweatbox.ts` 对 `server/sweatboxData.ts` 是同一种分法。
 *
 * 这一摞是**扇区包的 owner 链**解出来的，不是按呼号前缀拼的 —— 为什么必须如此，见那
 * 个文件的头注释（一句话：浦东的进近姓 ZSSS，石家庄没有自己的区调）。
 */
import type { ActivityFacility } from "@/lib/activities";

/** 这一层是怎么来的。界面上只在不是 `chain` 时说话。 */
export type StackSource = "prefix" | "chain" | "fallback";

/** 一个可以一键开出来的席位。 */
export interface StackSeat {
  facility: ActivityFacility;
  callsign: string;
  /** 这个呼号的全部频率，头一个是默认。空数组 = 这个席位没有登记频率。 */
  frequencies: string[];
  minRating: number;
  /**
   * 默认勾上的那一个。规则（本场优先、不分扇区的优先、再比 top-down 的 rank）在
   * can-db 那边定义一次。
   *
   * **can-db 的每一层恰好标一个，这边的进近那一格可能有两个** —— `DEP` 并进来了，
   * 而它在那边是自己的一层。那是对的：一场有离场席位的活动，进近和离场都该默认开。
   */
  primary: boolean;
  /** 呼号的头一段就是这个机场吗。false 的那些要在界面上说出来。 */
  own: boolean;
  source: StackSource;
}

export interface AirportStack {
  icao: string;
  /** 这一摞是扇区链给的，还是只能按呼号前缀猜的。 */
  hasChain: boolean;
  /** 这一摞里有没有区调。**显式给** —— 「没有区调」和「没查出来」在界面上一样。 */
  hasEnroute: boolean;
  seats: StackSeat[];
}
