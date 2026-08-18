/**
 * SweatBox 参考数据 —— 现在从 can-db 读，不再从仓库里的 JSON 读。
 *
 * ## 搬了什么，为什么
 *
 * 这个文件原来是 `import.meta.glob` 把 `src/data/sweatbox/` 里 247 个文件打包进
 * 构建产物。那批数据是从 `Sector/` 扇区包和一个商用 AIRAC 周期派生的，不许进公开
 * 仓库 —— 于是这整个仓库被迫是私有的，而私有仓库在 JianyueLab-Org（Free 计划）拿
 * 不到组织 secret，也就部署不了。一份 2.8 MB 的数据锁死了一个站点的可见性和上线
 * 能力。
 *
 * 现在它在 can-db 里，这个仓库一个字节都不带，于是可以是公开的、可以走共享部署工
 * 作流、可以和另外五个卫星站长得一样。
 *
 * ## 这个文件现在是一个适配器，而适配是刻意留在这一侧的
 *
 * can-db 的形状是给「航行资料」设计的：程序是一张 `procedure` 表带 `kind`，航路点
 * 叫 `ident`。SweatBox 生成器的形状是给「EuroScope 场景」设计的：`sids` 和
 * `stars` 是两个数组，航路点叫 `name`。两者都对，各自服务各自的领域。
 *
 * 翻译发生在这里，而不是在 can-db 里加一个 `?shape=sweatbox`，也不是去改
 * `SweatboxGenerator.vue`：
 *
 *  - 改 can-db 等于让一个通用资料服务知道它某一个消费者的界面长什么样。
 *  - 改岛屿等于动那 1518 行里的取数逻辑，而那份代码的正确性是靠它生成出来的场景
 *    验证的，不是靠类型验证的。
 *
 * 一个适配器、一处、有注释，是这三条里唯一可逆的。
 *
 * **服务端专用**，绝不能被岛屿 import。
 */
import type { APIContext } from "astro";
import { CAN_DB_ORIGIN } from "@/lib/config";
import type {
  AirwayGraph,
  SweatboxAirport,
  SweatboxFix,
  SweatboxIndexEntry,
} from "@/lib/sweatbox";

const TIMEOUT_MS = 8_000;

/**
 * can-db 的返回形状，逐字对应它的 json 标签。
 *
 * **索引和详情是两个类型，`stands` 在两边意思不同** —— 索引给的是机位**数量**
 * （选择器用它标注「ZGGG · 520 个机位」），详情给的是机位**本身**。can-db 那边为
 * 此专门分成 `AirportSummary` 和 `AirportDetail` 两个结构，因为让它们共用一个会
 * 撞上同一个 JSON 名字，而 Go 会**静默**地选其中一个。这边照着分，理由相同。
 */
interface DbAirportBase {
  icao: string;
  fir: string | null;
  lat: number;
  lon: number;
  elev: number | null;
  variation: number | null;
}

/** 索引行：机场 + 机位数量。 */
interface DbAirportSummary extends DbAirportBase {
  stands: number;
}

/** 详情：机场 + 跑道、机位、程序。 */
interface DbAirportDetail extends DbAirportBase {
  runways: Array<{
    id: string;
    opposite: string | null;
    hdg: number | null;
    lat: number;
    lon: number;
    endLat: number;
    endLon: number;
  }>;
  stands: Array<{
    name: string;
    lat: number;
    lon: number;
    hdg: number | null;
    span: number | null;
  }>;
  procedures: Array<{
    kind: "sid" | "star";
    name: string;
    runway: string | null;
    points: string[];
  }>;
}

interface DbFix {
  ident: string;
  lat: number;
  lon: number;
  fir: string | null;
}

async function callDb<T>(
  context: Pick<APIContext, "request">,
  path: string,
): Promise<T | null> {
  const headers: Record<string, string> = {};
  const cookie = context.request.headers.get("cookie");
  // cookie 一定要带：can-db 拿它去 can-api 认人。教员（8 级及以上）读得到这批数
  // 据，不需要 ADM 另外授予资料库权限 —— can-db 的 `session.Member.CanRead` 上写
  // 着为什么。
  if (cookie) headers.cookie = cookie;

  let response: Response;
  try {
    response = await fetch(CAN_DB_ORIGIN + path, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`can-db ${path} unreachable:`, error);
    return null;
  }

  if (!response.ok) {
    console.error(`can-db ${path} answered ${response.status}`);
    return null;
  }

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const data = "data" in body ? body.data : body;
  return (data ?? null) as T | null;
}

/**
 * 机场索引 —— 生成器的机场选择器。
 *
 * `runways` 在 `SweatboxIndexEntry` 的类型里有，但**索引这一层从来没人读它**（岛
 * 屿读的是加载后那份详情的 `runways`）。所以这里给空数组而不是为它多查一次：造一
 * 个没人看的值，下一个人会以为它有意义。
 */
export async function readIndex(
  context: Pick<APIContext, "request">,
): Promise<{ airports: SweatboxIndexEntry[] }> {
  const rows = await callDb<DbAirportSummary[]>(
    context,
    "/api/v1/aip/airports",
  );
  if (!rows) return { airports: [] };

  return {
    airports: rows.map((a) => ({
      icao: a.icao,
      fir: a.fir ?? "",
      elev: a.elev,
      runways: [],
      stands: a.stands,
    })),
  };
}

/**
 * 一个机场的全部。
 *
 * 三处翻译：
 *
 *  - `procedures[]` 按 `kind` 拆成 `sids` / `stars`。
 *  - `runway` 在 can-db 里可以是 null（程序不按跑道发布时），生成器的类型要
 *    string —— 空串。它读这个字段是拿来和跑道号比对的，null 和 "" 都匹配不上，所
 *    以这一步不丢信息。
 *  - **`magVar` 给 null。** 生成器的类型里有这个字段（NavData 的逐机场磁差），但
 *    整个仓库里**没有一行代码读它** —— 只有类型定义和那批已经删掉的 JSON。所以
 *    can-db 没存它，这里也不编一个。真要用的那天，它该从导航数据来，而那批数据本
 *    身还没搬进 can-db（见 can-db 的 AGENTS.md「还没做的事」）。
 */
export async function readAirport(
  context: Pick<APIContext, "request">,
  icao: string,
): Promise<SweatboxAirport | null> {
  const a = await callDb<DbAirportDetail>(
    context,
    `/api/v1/aip/airports/${encodeURIComponent(icao)}`,
  );
  if (!a) return null;

  return {
    icao: a.icao,
    fir: a.fir ?? "",
    lat: a.lat,
    lon: a.lon,
    elev: a.elev,
    variation: a.variation,
    magVar: null,
    runways: a.runways.map((r) => ({
      id: r.id,
      opposite: r.opposite ?? "",
      hdg: r.hdg ?? 0,
      lat: r.lat,
      lon: r.lon,
      endLat: r.endLat,
      endLon: r.endLon,
    })),
    // `span` is **omitted when unknown, never zeroed**. It is the maximum
    // wingspan a stand accepts, so 0 does not mean "unrecorded" — it means
    // "fits nothing", which is the opposite. `SweatboxStand.span` is optional
    // precisely because the ground plugin does not publish one for every
    // stand; a golden diff against the pre-migration files caught this on 75
    // airports, where every unrecorded stand had become a zero-span one.
    //
    // `hdg` is not optional in that type and the packages always publish it, so
    // the fallback there is unreachable rather than lossy — it exists only
    // because can-db's column is nullable.
    stands: a.stands.map((st) => ({
      name: st.name,
      lat: st.lat,
      lon: st.lon,
      hdg: st.hdg ?? 0,
      ...(st.span === null || st.span === undefined ? {} : { span: st.span }),
    })),
    sids: a.procedures
      .filter((p) => p.kind === "sid")
      .map((p) => ({ name: p.name, runway: p.runway ?? "", points: p.points })),
    stars: a.procedures
      .filter((p) => p.kind === "star")
      .map((p) => ({ name: p.name, runway: p.runway ?? "", points: p.points })),
  };
}

/**
 * 一个 FIR 的全部航路点。
 *
 * can-db 叫 `ident`，生成器叫 `name`。改名而不是让两边统一，是因为「统一」意味着
 * 动其中一个的公开形状：can-db 的 `ident` 是航图术语，生成器的 `name` 是它自己
 * 十几处代码里的字段名。
 */
export async function readFirFixes(
  context: Pick<APIContext, "request">,
  fir: string,
): Promise<SweatboxFix[]> {
  const rows = await callDb<DbFix[]>(
    context,
    `/api/v1/aip/fixes?fir=${encodeURIComponent(fir)}`,
  );
  if (!rows) return [];
  return rows.map((f) => ({ name: f.ident, lat: f.lat, lon: f.lon }));
}

/** 全国航路网。can-db 的形状和生成器的已经一致，原样过。 */
export async function readAirways(
  context: Pick<APIContext, "request">,
): Promise<AirwayGraph> {
  const graph = await callDb<AirwayGraph>(context, "/api/v1/aip/airways");
  return graph ?? { fixes: {}, segments: [] };
}
