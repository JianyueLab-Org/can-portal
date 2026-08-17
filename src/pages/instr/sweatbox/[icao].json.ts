/**
 * 某一个机场的跑道、机位和所在 FIR 的航路点，供 SweatBox 生成器用。
 *
 * **这不是一条 API 路由，也不是 can-api 的。** 这个仓库遵守的规矩是
 * `/api/v1/...` 属于 can-api、本站一条都不实现；这里给出的是一份**构建产物**
 * —— `scripts/build-sweatbox.mjs` 从扇区包里提取出来的 JSON —— 上游没有一个
 * can-api 端点可以让它去转发。它放在这里而不是 `public/` 只有一个理由：这份数据
 * 是 AIRAC 派生的，而 `public/` 下的东西谁猜到路径谁就能取。
 *
 * ## 这个站上唯一一处本地鉴权，以及为什么这次它不算例外
 *
 * 在 can-web 上，这段注释写的是「这是『守卫是便利、边界在上游』的例外，因为上
 * 游根本不存在」。搬到这里之后那句话仍然成立，但少了一半的份量：这个站的中间件
 * 已经按 rating 把不够教员的人整个挡在门外了（`src/middleware.ts`，`/instr` 前
 * 缀要 8 级），所以能走到这个端点的请求本来就过了同一道门。
 *
 * 下面这道检查因此是**第二道**而不是唯一一道，但它必须留着：中间件对
 * `/api/` 前缀放行，将来若有人把这两个端点挪到那底下（看起来很合理，它们确实是
 * 数据接口），第一道门就没了 —— 而这一行会让那次搬动仍然是安全的。它读的
 * `rating` 是 can-api 每个请求解出来的，从来不是这里算的。
 */
import type { APIRoute } from "astro";
import { readAirport, readFirFixes } from "@/server/sweatboxData";
import { RATING_INSTRUCTOR } from "@/lib/config";

export const GET: APIRoute = async ({ params, locals }) => {
  const rating = locals.user?.rating;
  if (typeof rating !== "number" || rating < RATING_INSTRUCTOR) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const icao = (params.icao ?? "").toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const airport = await readAirport(icao);
  if (!airport) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fixes = await readFirFixes(airport.fir);

  return new Response(JSON.stringify({ airport, fixes }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 这份数据只有在有人重跑构建脚本并提交之后才会动，所以缓存一节课的时长
      // 不花什么代价，而它省掉了教员在两个机场之间来回切时反复取 500 个机位。
      "Cache-Control": "private, max-age=3600",
    },
  });
};
