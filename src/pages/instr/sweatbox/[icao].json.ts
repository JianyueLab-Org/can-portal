/**
 * 某一个机场的跑道、机位和所在 FIR 的航路点，供 SweatBox 生成器用。
 *
 * **现在是一个组合转发，不再是本地文件。** 数据在 can-db 里；这里把两次上游调用
 * （机场详情 + 那个 FIR 的航路点）合成岛屿一直在读的那一个形状 —— 所以
 * `SweatboxGenerator.vue` 一个字都没改。
 *
 * ## 鉴权：这里不再是边界
 *
 * 从前这个端点自带一道 rating 检查，注释里写着「这是本站唯一一处本地守卫就是边界
 * 的地方，因为上游根本不存在」。**上游现在存在了。** can-db 的 `guard` 按会话判：
 * 教员（8 级及以上）或者持有 `aipAccess` 的人可以读，其余人 403。
 *
 * 下面那道检查因此留着但降了一级 —— 它是**便利**：中间件已经按 `/instr` 前缀挡过
 * 一次 8 级，这一行只是让一个绕过页面直接打这个地址的人拿到一句本地化的 403，而
 * 不是等一次跨服务往返再拿到英文的那句。真正拦住数据的是 can-db。
 *
 * 两处判断用的是同一个常量（`RATING_INSTRUCTOR`），而 can-db 那边独立地也写着 8。
 * 两边不一致时**宽的那一份不会生效** —— 这里放宽只会让请求多走一趟再被拒。
 */
import type { APIRoute } from "astro";
import { readAirport, readFirFixes } from "@/server/sweatboxData";
import { RATING_INSTRUCTOR } from "@/lib/config";

export const GET: APIRoute = async (context) => {
  const rating = context.locals.user?.rating;
  if (typeof rating !== "number" || rating < RATING_INSTRUCTOR) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const icao = (context.params.icao ?? "").toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const airport = await readAirport(context, icao);
  if (!airport) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fixes = await readFirFixes(context, airport.fir);

  return new Response(JSON.stringify({ airport, fixes }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 一节课的时长。数据只有在有人导入新一期并激活之后才会动，而这个缓存省掉的
      // 是教员在两个机场之间来回切时反复取 500 个机位 —— 现在那是两次跨服务调用
      // 而不是两次本地读，所以它比从前更值。
      "Cache-Control": "private, max-age=3600",
    },
  });
};
