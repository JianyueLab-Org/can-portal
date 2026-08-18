/**
 * 全国航路网，供生成器的航路规划用。
 *
 * 和隔壁 `[icao].json.ts` 一样，现在是转发而不是本地文件；那个文件的头注释写了鉴
 * 权为什么不再是这一层的事。
 *
 * **Astro 的路由里静态段胜过动态段**，所以这个文件接的是
 * `/instr/sweatbox/airways.json`，`[icao].json.ts` 永远看不到它。在这个目录里加第
 * 二个静态文件之前值得知道这一点。
 *
 * 它是全国一份而不是每个 FIR 一份，因为一条从 ZGGG 到 ZBAA 的航路要穿过四个
 * FIR；在边界上切开的图，最远只能规划到它那一格的边缘。
 */
import type { APIRoute } from "astro";
import { readAirways } from "@/server/sweatboxData";
import { RATING_INSTRUCTOR } from "@/lib/config";

export const GET: APIRoute = async (context) => {
  const rating = context.locals.user?.rating;
  if (typeof rating !== "number" || rating < RATING_INSTRUCTOR) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(await readAirways(context)), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=3600",
    },
  });
};
