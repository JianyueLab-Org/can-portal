/**
 * 全国航路网，供生成器的航路规划用。
 *
 * 形状和理由都和隔壁的 `[icao].json.ts` 一样 —— 一份构建产物，挡在一道教员检查
 * 后面，不是 API 路由也不是 can-api 的。为什么这道检查留在本地，读那个文件的
 * 头注释。
 *
 * **Astro 的路由里静态段胜过动态段**，所以这个文件接的是
 * `/instr/sweatbox/airways.json`，`[icao].json.ts` 永远看不到它。在这个目录里加
 * 第二个静态文件之前值得知道这一点：这个顺序是 Astro 定的，不是这个目录声明
 * 的，一个恰好叫 `AIRWAYS` 的机场会被它挡住。
 *
 * 它是全国一份而不是每个 FIR 一份，因为一条从 ZGGG 到 ZBAA 的航路要穿过四个
 * FIR；在边界上切开的图，最远只能规划到它那一格的边缘。134 KB，页面加载时取一
 * 次，之后每个机场复用。
 */
import type { APIRoute } from "astro";
import { readAirways } from "@/server/sweatboxData";
import { RATING_INSTRUCTOR } from "@/lib/config";

export const GET: APIRoute = async ({ locals }) => {
  const rating = locals.user?.rating;
  if (typeof rating !== "number" || rating < RATING_INSTRUCTOR) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(await readAirways()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 航路网只有在有人重跑构建脚本并提交之后才会动，所以缓存一节课的时长不花
      // 什么代价。
      "Cache-Control": "private, max-age=3600",
    },
  });
};
