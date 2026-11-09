import { CAN_API_ORIGIN } from "@/lib/config";

/**
 * 给外部可用性监控的 `/health`：带依赖检查，和 `/healthz` 探活分开。
 * 探针不要指向这里 —— can-api 挂掉不该滚掉本站的 Pod。
 *
 * 每个检查 3 秒超时；结果在进程内缓存 10 秒，并发请求共用同一次检查。
 */
export type HealthResult = {
  status: "ok" | "fail";
  checks: Record<string, string>;
};

const CHECK_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 10_000;

type Check = () => Promise<void>;

async function checkUpstream(url: string): Promise<void> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function createHealth(
  checks: Record<string, Check>,
  now: () => number = Date.now,
): () => Promise<HealthResult> {
  let cached: { at: number; result: HealthResult } | null = null;
  let inflight: Promise<HealthResult> | null = null;

  async function run(): Promise<HealthResult> {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch (err) {
          const msg =
            err instanceof Error && err.name === "TimeoutError"
              ? "timeout"
              : err instanceof Error && err.message.startsWith("HTTP ")
                ? err.message
                : "unreachable";
          console.warn(`health check ${name} failed: ${msg}`);
          return [name, msg] as const;
        }
      }),
    );
    const result: HealthResult = {
      status: entries.every(([, v]) => v === "ok") ? "ok" : "fail",
      checks: Object.fromEntries(entries),
    };
    cached = { at: now(), result };
    return result;
  }

  return () => {
    if (cached && now() - cached.at < CACHE_TTL_MS) {
      return Promise.resolve(cached.result);
    }
    inflight ??= run().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

export const health = createHealth({
  "can-api": () => checkUpstream(CAN_API_ORIGIN + "/health"),
});

export function healthResponse(result: HealthResult): Response {
  return Response.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
