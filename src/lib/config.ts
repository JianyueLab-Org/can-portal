/**
 * 这个站要知道的三个地址，集中在一处。
 *
 * 和 can-controller / can-efb 的同名文件几乎一样，是有意抄的而不是抽包共用：
 * 几个卫星站点各自部署、各自有自己的默认值，把它们绑成一个包意味着改 EFB 的默
 * 认端口会顺手改掉这里的。
 *
 * can-dev 当年把 can-api 的地址和同意页的地址塞进同一个 `CAN_ISSUER`，结果是
 * 改其中一个的人以为自己改完了。这里从一开始就分开命名。
 */

function clean(value: string | undefined): string {
  return (value || "").replace(/\/+$/, "");
}

/**
 * can-api 的 origin。数据全部来自它。
 *
 * `PUBLIC_` 前缀让 Astro 把它内联进客户端包 —— 它是主机名，不是密钥。但**浏
 * 览器其实用不到它**：岛屿走本站的同源反代（见
 * `src/pages/api/v1/[...path].ts`），那样就不需要 can-api 那边为
 * portal.ceruleanavi.net 开一条 CORS。真正用它的是 SSR 和那个反代。
 *
 * 兜底成生产地址而不是空串：can-web 的 `src/server/canApi.ts` 记着这一条的代
 * 价 —— 空串在浏览器里能解析成同源相对地址，在服务端却是 `ERR_INVALID_URL`，
 * 而且每一个请求都失败，日志看起来像是 can-api 挂了，其实只是没人设过这个
 * 变量。
 */
export const CAN_API_ORIGIN =
  clean(process.env.CAN_API_ORIGIN) ||
  clean(import.meta.env.PUBLIC_CAN_API_ORIGIN) ||
  "https://api.ceruleanavi.net";

/**
 * can-web 的 origin。指登录页，以及那些**没有**跟着搬过来的页面。
 *
 * 这个站自己没有登录页，也不该有：会话由 can-api 签在父域上，主站上登录过的成
 * 员到这里本来就带着 cookie。
 *
 * 侧栏底部那一排跨站链接也走它 —— 花名册（公开那一份）、活动、积分兑换、处理
 * 结果公示的**成员视角**都还在主站。这个站搬走的是那几件事的**管理端**，不是
 * 它们本身。
 */
export const CAN_WEB_ORIGIN =
  clean(process.env.CAN_WEB_ORIGIN) ||
  clean(import.meta.env.PUBLIC_CAN_WEB_ORIGIN) ||
  "https://ceruleanavi.net";

/**
 * can-db 的 API，SweatBox 参考数据和活动席位面板的整摞席位都从它来。
 *
 * **配的是集群内地址，不是公网主机名。** can-db 有 Ingress
 * （`api-db.ceruleanavi.net`），但这个站和 can-database 一样走集群内的 Service：
 * 同一个集群，少一跳，也不依赖隧道。兜底值是 localhost 而不是某个 https 地址：写
 * 一个公网地址当兜底，会让「忘了配」悄悄变成「打到了别的东西上」。
 *
 * 这是**服务端专用**的值，只有 `src/server/canDb.ts` 读它，`sweatboxData.ts` 和
 * `positionStack.ts` 都经由它。岛屿打的是本站的 `/instr/sweatbox/*` 和
 * `/super/activities/*.json`。
 */
export const CAN_DB_ORIGIN =
  clean(process.env.CAN_DB_ORIGIN) || "http://127.0.0.1:8080";

/**
 * 本站自己的 origin，写操作的 Origin 头要和它比对。
 *
 * 必须是**显式配置**的值，不能从 `Host` 头推：这个站跑在 TLS 终止的反代后面，
 * 推出来的是 `http://…`，浏览器发的是 `https://…`，永远对不上。
 * `astro.config.mjs` 里关掉 `checkOrigin` 正是这个原因，而这里是补上的那一半。
 */
export function origin(): string {
  return (
    clean(process.env.PUBLIC_ORIGIN) ||
    clean(import.meta.env.PUBLIC_ORIGIN) ||
    "https://portal.ceruleanavi.net"
  );
}

/**
 * 登录去哪儿。
 *
 * **现在带 callbackUrl 了。** 从前这里写着「不带」，理由是 can-web 的 `/signin`
 * 只接受站内绝对路径 —— 那是一道防开放重定向的检查，把跨站地址传过去只会被丢
 * 掉、回落到 `/pilots`，于是成员登录完停在主站还得自己走回来。
 *
 * can-web 现在有一份显式白名单（`src/lib/callbackUrl.ts`，配一套只测「必须被拒
 * 的输入」的测试），这个域在名单上。
 */
export function signInUrl(returnTo?: URL): string {
  const base = `${CAN_WEB_ORIGIN}/signin`;
  if (!returnTo) return base;
  // 用 origin() 而不是 returnTo.origin：这个站跑在 TLS 终止的反代后面，请求 URL
  // 的 origin 推出来是 http://，那既配不上 can-web 白名单里的 https://（于是被
  // 拒、回落 /pilots，白做一场），也会把成员从 https 降到 http。
  //
  // 片段（#...）不带：它本来就不会发到服务端。
  const target = `${origin()}${returnTo.pathname}${returnTo.search}`;
  return `${base}?callbackUrl=${encodeURIComponent(target)}`;
}

/** 主站上某个页面的绝对地址。侧栏的跨站链接都由它拼。 */
export function webUrl(path: string): string {
  return `${CAN_WEB_ORIGIN}${path}`;
}
