/**
 * 一条路径要几级，以及不够时的原因。
 *
 * 中间件（`src/middleware.ts`）按它决定是否渲染 `NoAccess`。和侧栏
 * （`src/lib/nav.ts`）用同一组 can-ui 常量：两处对同一个页面给出不同答案，会做出
 * 一个「看得见但进不去」或者「进得去但找不到入口」的菜单。
 *
 * **这是便利，不是边界。** 真正的判断在 can-api 每条路由自己的守卫上。
 */
import type { NoAccessReason } from "@jianyuelab-org/can-ui";
import {
  RATING_ADMIN,
  RATING_INSTRUCTOR,
  RATING_SUP,
} from "@jianyuelab-org/can-ui/sites";

/** 中间件改写到的页面。直接打开它会被送回 `/`。 */
export const DENIED_PATH = "/denied";

/**
 * 先长后短：ADM 的两条必须排在 `/super` 前面，否则会先被 `/super` 以 11 匹配上。
 *
 * - `/super/aip-access`：资料库授权，列着持有人名单。ADM。
 * - `/super/developers`：开发者授权，列着谁注册了应用。ADM。
 * - `/super/*`：SUP（发积分、配奖品、晋升审批都是 SUP 起）。
 * - `/instr/*`：教员。
 */
const FLOORS: ReadonlyArray<{ prefix: string; rating: number }> = [
  { prefix: "/super/aip-access", rating: RATING_ADMIN },
  { prefix: "/super/developers", rating: RATING_ADMIN },
  { prefix: "/super", rating: RATING_SUP },
  { prefix: "/instr", rating: RATING_INSTRUCTOR },
];

/** 进这个站的最低门槛。首页、404、`/denied` 按它判。 */
export const SITE_FLOOR = RATING_INSTRUCTOR;

export function requiredRating(pathname: string): number {
  return (
    FLOORS.find((floor) => pathname.startsWith(floor.prefix))?.rating ??
    SITE_FLOOR
  );
}

/** 不够格时的原因；够格时是 null。 */
export function noAccessReason(
  pathname: string,
  rating: number,
): NoAccessReason | null {
  const required = requiredRating(pathname);
  return rating < required ? { kind: "rating", required } : null;
}
