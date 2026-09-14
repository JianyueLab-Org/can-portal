/**
 * 向 can-db 要数据的那一个出口。
 *
 * **只有一个函数，但它必须只有一份。** 这个站从 can-db 读两类东西 —— SweatBox 的
 * 参考数据，和活动排班要的整摞席位 —— 而它们共用的不是「取数」这个动作，是三条各
 * 自踩过坑的规矩：
 *
 *  - **cookie 一定要带。** can-db 自己不认人，它拿这个 cookie 去问 can-api。漏掉它
 *    的症状是 401，而 401 看起来像「这个成员没权限」，不像「请求没带凭证」。
 *  - **超时要短。** 这两处都是页面上一次点击等着的请求；上游卡住时一个 8 秒的超时
 *    换来一句「暂时读不到」，没有超时换来的是一个转到底的加载圈。
 *  - **失败返回 null，不抛。** 调用方都有退化路径（生成器只填目的地、席位面板回到
 *    手填），而那条退化路径必须是**调用方**选的，不是这里替它决定。
 *
 * 拆出来之前这段代码在 `sweatboxData.ts` 里，名字也绑着 SweatBox。第二个消费者出现
 * 时照抄一份是最省事的写法，也正是这个仓库里 `radarTypes.ts` 那类「两份从来没有一
 * 致过」的来源。
 *
 * **服务端专用**，绝不能被岛屿 import：`CAN_DB_ORIGIN` 是集群内地址，浏览器打不到，
 * 而且这个仓库的岛屿一律走本站的端点。
 */
import type { APIContext } from "astro";
import { CAN_DB_ORIGIN } from "@/lib/config";

const TIMEOUT_MS = 8_000;

export async function callDb<T>(
  context: Pick<APIContext, "request">,
  path: string,
): Promise<T | null> {
  const headers: Record<string, string> = {};
  const cookie = context.request.headers.get("cookie");
  // 教员（8 级及以上）读得到这批数据，不需要 ADM 另外授予资料库权限 —— can-db 的
  // `session.Member.CanRead` 上写着为什么。
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
  // can-db 的回包是 `{data: …}`，但健康检查那类直接给裸对象。两种都收。
  const data = "data" in body ? body.data : body;
  return (data ?? null) as T | null;
}
