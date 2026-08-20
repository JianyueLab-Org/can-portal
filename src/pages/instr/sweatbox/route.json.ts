/**
 * 一条城市对航路，供生成器填 `$FP` 用。
 *
 * **它取代了 `airways.json`。** 那个端点把全国航路网整张图（134 KB）发给浏览器，
 * 由岛屿自己跑 A*；现在规划整个在 can-db 里做，这边一次问一对。为什么要搬过去，
 * `src/server/sweatboxData.ts` 的 `readRoute` 上写着 —— 一句话是那两份实现从来没
 * 有一致过，而不一致的方式都不会报错。
 *
 * **Astro 的路由里静态段胜过动态段**，所以这个文件接的是
 * `/instr/sweatbox/route.json`，隔壁的 `[icao].json.ts` 永远看不到它（否则
 * `route` 会被当成一个机场代号）。在这个目录里加第三个静态文件之前值得知道这
 * 一点 —— 这也正是 `airways.json` 当初能存在的原因。
 *
 * 鉴权和隔壁一样：本地这道检查是**便利**，真正拦住数据的是 can-db 的会话判断。
 * 那个文件的头注释写了为什么。
 */
import type { APIRoute } from "astro";
import { readRoute } from "@/server/sweatboxData";
import { RATING_INSTRUCTOR } from "@/lib/config";

const ICAO = /^[A-Z0-9]{4}$/;

export const GET: APIRoute = async (context) => {
  const rating = context.locals.user?.rating;
  if (typeof rating !== "number" || rating < RATING_INSTRUCTOR) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(context.request.url);
  const from = (url.searchParams.get("from") ?? "").toUpperCase();
  const to = (url.searchParams.get("to") ?? "").toUpperCase();
  if (!ICAO.test(from) || !ICAO.test(to)) {
    return new Response(JSON.stringify({ error: "bad_request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const level = Number(url.searchParams.get("level") ?? "0");
  const plan = await readRoute(
    context,
    from,
    to,
    Number.isFinite(level) && level > 0 ? level : 0,
  );

  // **没有航路是一个答案，不是一次失败。** 这一对确实飞不通时 can-db 给 404，这里
  // 给 200 加一个 `null` —— 岛屿据此只填目的地代号，和上游真的挂了走的是同一条退
  // 化路径，但它不该把这两件事记成同一件。
  return new Response(JSON.stringify(plan), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 和机场详情同一个时长：数据只有在有人导入新一期并激活之后才会动，而一个教
      // 员在同一批伙伴机场之间反复重生成是常态。
      "Cache-Control": "private, max-age=3600",
    },
  });
};
