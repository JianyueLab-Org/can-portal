import type { APIContext } from "astro";
import { CAN_API_ORIGIN } from "@/lib/config";

/**
 * 服务端调用 can-api。
 *
 * 和 can-web / can-efb 的同名文件是同一件东西：SSR 的时候没有浏览器替我们带
 * cookie，所以把进来的 `Cookie` 头**原样转发**过去，页面因此能渲染出这名成员
 * 自己的数据。
 *
 * 转发而不是自己解会话，是刻意的：can-api 拥有 token 的格式、密钥和有效期，
 * 这个站只是把凭据递过去再读回答案，两边没有需要保持同步的东西。多存一份
 * `SESSION_SECRET` 等于多一处能签发任何人身份的地方，省下的只是一次内网 HTTP。
 *
 * **服务端专用**，它读请求头，绝不能被岛屿 import。
 */

const ORIGIN = CAN_API_ORIGIN;

/**
 * 短超时是故意的：SSR 页面没法「先渲染个 loading 再说」，所以慢掉的 can-api
 * 必须尽快变成一个降级结果，而不是一个挂到访客放弃为止的请求。
 */
const TIMEOUT_MS = 5_000;

export interface ServerApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  message?: string;
}

export async function callApi<T = unknown>(
  context: Pick<APIContext, "request"> | null,
  path: string,
  init: RequestInit = {},
): Promise<ServerApiResult<T>> {
  const headers: Record<string, string> = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };

  const cookie = context?.request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;

  let response: Response;
  try {
    response = await fetch(ORIGIN + path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`can-api ${path} unreachable:`, error);
    return { ok: false, status: 0, data: null, error: "unreachable" };
  }

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const errorBody = body ?? {};
    return {
      ok: false,
      status: response.status,
      data: null,
      error:
        typeof errorBody.error === "string" ? errorBody.error : "http_error",
      message:
        typeof errorBody.message === "string" ? errorBody.message : undefined,
    };
  }

  // can-api 大部分接口包着 {status, data, timestamp}，少数裸奔。有信封就拆掉，
  // 让调用方只面对一种形状。
  const data = "data" in body ? body.data : body;
  return {
    ok: true,
    status: response.status,
    data: (data ?? null) as T | null,
  };
}

/** The authenticated member returned by can-api. */
export interface SessionUser {
  username: string;
  name: string;
  email: string;
  rating: number;
  /**
   * 资料库访问级别：0 无权访问 / 1 可调用 / 2 可阅读 / 3 受限可调用 / 4 受限可阅读 /
   * 5 管理/编辑。**3 级起多出来的那一份是 CAAC 的 NAIP 汇编。**
   *
   * 这个站不拿它做权限判断 —— SweatBox 的门是教员评级（见 route.json.ts）。这里只
   * 用来决定「不使用受限汇编」那个开关出不出：档下的人按它恒为空转。
   *
   * can-api 一直在回这个字段，这里从前只是没写进类型。
   */
  aipAccess: number;
}

export type SessionResolution =
  | { state: "authenticated"; user: SessionUser }
  | { state: "signed-out" }
  | { state: "unavailable" };

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.username === "string" &&
    user.username.length > 0 &&
    typeof user.name === "string" &&
    typeof user.email === "string" &&
    typeof user.rating === "number" &&
    Number.isFinite(user.rating) &&
    typeof user.aipAccess === "number" &&
    Number.isFinite(user.aipAccess)
  );
}

/** Only an explicit anonymous response or HTTP 401 confirms sign-out. */
export async function resolveSession(
  context: Pick<APIContext, "request">,
): Promise<SessionResolution> {
  try {
    const result = await callApi<{ user?: unknown }>(
      context,
      "/api/v1/auth/session",
    );
    if (result.status === 401) return { state: "signed-out" };
    if (result.status !== 200 || !result.data || Array.isArray(result.data)) {
      return { state: "unavailable" };
    }
    if (result.data.user === null) return { state: "signed-out" };
    if (isSessionUser(result.data.user)) {
      return { state: "authenticated", user: result.data.user };
    }
  } catch {
    // Invalid JSON shapes and interrupted response bodies are not sign-outs.
  }
  return { state: "unavailable" };
}
