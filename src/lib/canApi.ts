/**
 * 岛屿怎么跟 can-api 说话。
 *
 * 浏览器安全：没有密钥，不 import `src/server` 下的任何东西。
 *
 * 和 can-web / can-controller 的同名文件**导出同样的三个东西、同样的签名**
 * （`api`、`apiFetch`、`unwrapList`），这不是巧合：这七个岛屿是从 can-web 原样
 * 搬过来的，接口对齐了，它们就是逐字复制而不是重写 —— 重写它们意味着重新犯一
 * 遍 `unwrapList` 下面记着的那三个错。
 *
 * 有一处**关键差别**：这里打的是**同源**的 `/api/v1/...`，由本站的反代
 * （`src/pages/api/v1/[...path].ts`）转给 can-api，而不是直连
 * api.ceruleanavi.net。理由和 can-controller、can-efb、can-radar 一样：can-api 的
 * `ALLOWED_ORIGINS` 里没有 portal 这个域，加进去要改它的部署环境变量并重启。
 * 同源反代让这个站**今天**就能跑，一行 can-api 都不用动。
 *
 * 代价是路径必须在那份白名单里，收益是这个站不依赖 can-api 的一次部署改动。
 * 路径本身**一个字都没变** —— `/api/v1/...` 是 published contract。
 */

export interface ApiFailure {
  ok: false;
  status: number;
  error: string;
  message: string;
}
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * 调 can-api。
 *
 * 失败**不抛异常**。绝大多数失败是表单填错了，那句话该出现在字段旁边而不是一个
 * 500 页面；真正的网络故障是 status 0，调用方能分得出来。
 */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // 同源请求，cookie 本来就会带上；写出来是为了下一个人不会以为这里漏了
      // 什么。can-web 的同名文件在这里写的是 `include`，因为它直连 can-api。
      credentials: "same-origin",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: "network",
      message: "网络连接失败，请稍后再试。",
    };
  }

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: String(body.error ?? "http_error"),
      message: String(body.message ?? `请求失败（${response.status}）`),
    };
  }

  // can-api 大部分接口包着 {status, data, timestamp}，少数裸奔。有信封就拆掉，
  // 让调用方只面对一种形状。
  const data = "data" in body ? body.data : body;
  return { ok: true, data: data as T };
}

/**
 * 一个可以直接替换 `fetch` 的版本。
 *
 * 签名和返回的 `Response` 都和 `fetch` 一致，所以从 can-web 搬过来的岛屿一个
 * 字都不用改就能继续用自己那套错误处理。
 *
 * 新代码优先用上面的 `api()`：它拆信封，也把失败变成一个值而不是一个要你自己
 * 判 `response.ok` 的对象。
 */
export function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, { ...init, credentials: "same-origin" });
}

/**
 * 从已经拆过信封的 `data` 里取出一个列表。
 *
 * **`data` 不是一种形状。** can-api 大约五分之一的路由直接把值本身放在 `data`
 * 上 —— `data` 就是那个数组 —— 其余的都包在一个名字下面。
 * `/api/v1/super/prize` 给的是 `data: [...]`；隔一行的
 * `/api/v1/super/redemption` 给的是 `data: {redemptions: [...]}`。**这个站同时
 * 调这两条**，就在 `ManagePrizes.vue` 里，相隔十几行。
 *
 * 于是 `list.value = payload.data` 有一半的时候是对的，另一半错得没有任何东西
 * 能发现：网络上下来的东西在 TypeScript 眼里是 `any`，两边仓库的 CI 谁也看不见
 * 谁，对象就这么落进一个声明成数组的 ref。表现出来的不是一个失败的请求，而是
 * 渲染中途从某个 computed 里抛出来的 `.filter is not a function` —— 看起来像
 * 页面坏了，而不是像响应读错了。
 *
 * 所以键名是必填而不是可选，两种形状都能拿到数组。认不出来的形状返回空列表而
 * 不是抛：一张空表还能救，一次渲染中途死掉救不回来。
 */
export function unwrapList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}
