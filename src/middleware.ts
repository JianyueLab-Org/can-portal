import { defineMiddleware } from "astro:middleware";
import { resolveSession } from "@/server/canApi";
import { signInUrl } from "@/lib/config";
import { DENIED_PATH, noAccessReason } from "@/lib/access";

/**
 * 每个请求先问一次 can-api「你是谁」，答案放进 `Astro.locals.user`。
 *
 * **这个站整站都要登录，而且整站都要评级** —— 后半句是它和另外六个站的区别。
 *
 * 没登录：重定向到 **can-web** 的登录页。这个站自己没有登录页；会话由 can-api 在
 * 父域上签发。`signInUrl()` 把当前地址当 callbackUrl 带过去。
 *
 * 评级不够：在成员请求的地址上渲染 can-ui 的 `NoAccess`，状态码 403。
 * 门槛表在 `src/lib/access.ts`，和侧栏用同一组 can-ui 常量。
 * `next(DENIED_PATH)` 是改写，不是跳转：地址栏不变，中间件不再跑一遍，
 * `locals` 带到 `src/pages/denied.astro`。那一页说明缺哪一级，列出他还能去的站。
 *
 * **这仍然是便利，不是边界。** 真正的判断在 can-api 每条路由自己的守卫上，还有
 * 每个 handler 内部按 division 的那一层。把门槛改小不会放开任何数据，只会让人看
 * 见一组点下去必然 403 的页面。
 */

/**
 * 不问会话、也不重定向的两条路径。
 *
 * - `/api/` 是本站的反代，它自己有白名单，而且它的调用方要的是状态码不是
 *   302 —— 把一个 fetch 重定向到登录页，岛屿拿到的会是一段 HTML，然后它会试
 *   着把 `<!doctype html>` 当 JSON 解析。
 * - `/healthz` 是探活，理由写在那个文件里：它必须能在 can-api 挂掉时照样回
 *   200，否则上游一抖，kubelet 就会把这边的 Pod 一起滚掉。
 */
function isUnguarded(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/healthz";
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isUnguarded(pathname)) {
    context.locals.user = null;
    return withSecurityHeaders(await next());
  }

  const user = await resolveSession(context);
  context.locals.user = user;

  if (!user) {
    return withSecurityHeaders(context.redirect(signInUrl(context.url)));
  }

  const reason = noAccessReason(pathname, user.rating);
  if (reason) {
    context.locals.noAccess = reason;
    return withSecurityHeaders(await next(DENIED_PATH));
  }

  return withSecurityHeaders(await next());
});

/**
 * 和几个兄弟站一致的安全头。
 *
 * 用函数包一层而不是在 `next()` 之后就地设置：上面那个重定向是提前返回的，内联
 * 写法会让它成为唯一一个什么头都没有的响应 —— can-web 正是被这一条咬过。
 */
function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "origin-when-cross-origin");
  return response;
}
