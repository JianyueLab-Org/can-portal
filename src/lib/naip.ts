/**
 * 「隐藏 NAIP」—— 全站一个开关。
 *
 * can-db 的每条读路由都认 `?unrestricted=1`：对 aipAccess 3 级（受限可调用）及以上
 * 的成员，它把级别**往下压**到 2，于是 CAAC 的 NAIP 汇编整份不出现；3 级以下是空
 * 转。这个站把它做成一个偏好，而不是每个页面各自一个勾：
 *
 *  - **唯一的真相是一枚 cookie**（`NAIP_COOKIE`）。服务端要在页面加载时就知道它
 *    （SweatBox 的机场清单是 SSR 取的），localStorage 到不了服务端。
 *  - **唯一的出口是 `src/server/canDb.ts` 的 `callDb`**，它读这枚 cookie 并追加参数。
 *    调用方一个都不需要知道这件事。
 *  - **默认隐藏。** 这个站上读 can-db 的东西（SweatBox 场景、活动席位）是给学员和
 *    成员用的，而他们多半没有受限那一档；照着汇编生成的航路是他们查不到依据的航路。
 *    cookie 只有写成 `0` 才算显示 —— 读不懂的值往安全那侧倒。
 *
 * cookie 不带 `Domain`，只落在本站：同一个成员在资料库控制台和 EFB 上各自有各自的
 * 选择，一个站上的勾不该悄悄改掉另一个站的数据范围。
 */

export const NAIP_COOKIE = "can_portal_hide_naip";

/** 3 级（受限可调用）起能取到 NAIP，才有得选。 */
export const AIP_RESTRICTED_CALL = 3;

/** 开关变了之后在 `window` 上发的事件，岛屿据此重取数据。 */
export const NAIP_EVENT = "can:naip-preference";

/** 从一个 `Cookie` 请求头里读偏好。只有明确写着 `0` 才是「显示」。 */
export function hideNaipFromCookieHeader(header: string | null): boolean {
  if (!header) return true;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === NAIP_COOKIE) return rest.join("=").trim() !== "0";
  }
  return true;
}

/** 浏览器侧读。`document.cookie` 在某些上下文里会抛，抛了按默认（隐藏）算。 */
export function readHideNaip(): boolean {
  try {
    return hideNaipFromCookieHeader(document.cookie);
  } catch {
    return true;
  }
}

/** 浏览器侧写，并通知页面上的岛屿重取。 */
export function writeHideNaip(hide: boolean): void {
  try {
    document.cookie =
      `${NAIP_COOKIE}=${hide ? "1" : "0"}; Path=/; Max-Age=31536000; ` +
      "SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  } catch {
    // 写不进去就是写不进去 —— 服务端照旧按默认隐藏，界面上的勾会在下次加载时回来。
  }
  try {
    window.dispatchEvent(new CustomEvent(NAIP_EVENT, { detail: hide }));
  } catch {
    // 没有 window 的环境里不会有岛屿等着它。
  }
}

/** 岛屿订阅开关变化；返回取消订阅的函数。 */
export function onNaipChange(handler: (hide: boolean) => void): () => void {
  const listener = (event: Event) =>
    handler(Boolean((event as CustomEvent<boolean>).detail));
  window.addEventListener(NAIP_EVENT, listener);
  return () => window.removeEventListener(NAIP_EVENT, listener);
}

/** 给一个 can-db 路径追加 `unrestricted=1`（已经有查询串时用 `&`）。 */
export function withUnrestricted(path: string): string {
  return path + (path.includes("?") ? "&" : "?") + "unrestricted=1";
}
