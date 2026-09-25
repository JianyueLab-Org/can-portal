/**
 * 一个机场的整摞管制席位，给活动的席位面板用。
 *
 * **它是一个本站端点，不是 `src/pages/api/v1/[...path].ts` 里的一条白名单。** 那个反
 * 代打的是 can-api；这条数据在 **can-db**，而 can-db 没有 Ingress（它服务的是有许可限
 * 制的航行资料，只在集群内监听）。所以和 SweatBox 的参考数据走同一条路：服务端取、翻
 * 好形状再给岛屿，`src/server/positionStack.ts` 上写着翻译里的三处判断。
 *
 * **`activities.astro` 和这个目录能并存**，Astro 两种都认。放在 `/super/activities/`
 * 底下是为了让中间件那道 `/super` → SUP 的门自动盖住它 —— 换个路径就得自己记得配。
 *
 * 鉴权和 `/instr/sweatbox/*` 一样：本地这道检查是**便利**，真正拦住数据的是 can-db 的
 * 会话判断。写在这里是为了让一个不够格的人拿到 403 而不是一段空 JSON —— 后者看起来像
 * 「这个机场没有席位」。
 */
import type { APIRoute } from "astro";
import { readAirportStack } from "@/server/positionStack";
import { RATING_SUP } from "@/lib/config";
import { isValidIcao, normalizeIcao } from "@/lib/activities";

export const GET: APIRoute = async (context) => {
  const rating = context.locals.user?.rating;
  if (typeof rating !== "number" || rating < RATING_SUP) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const icao = normalizeIcao(context.params.icao);
  if (!isValidIcao(icao)) {
    return new Response(JSON.stringify({ error: "invalidIcao" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stack = await readAirportStack(context, icao);
  // **上游读不到给 502，读到了但是空的给 200。** 这两件事在界面上要说不同的话：一个是
  // 「再试一次」，一个是「这个场在扇区包里没有席位，自己填吧」。从前 `addAllPositions`
  // 把两者都变成了同一句「操作失败」。
  if (!stack) {
    return new Response(JSON.stringify({ error: "unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(stack), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 和机场详情、航路同一个时长：席位表只有在有人重导一次扇区包之后才会动，而排
      // 班的人在同一批机场之间反复开合是常态。
      "Cache-Control": "private, max-age=3600",
      // 回答随「隐藏 NAIP」那枚 cookie 变（`src/lib/naip.ts`）；地址不变，所以缓存必须按它分。
      Vary: "Cookie",
    },
  });
};
