import type { APIRoute } from "astro";
import { health, healthResponse } from "@/server/health";

export const prerender = false;

/** 外部监控用，查 can-api 的 `/health`。逻辑和缓存见 `src/server/health.ts`。 */
export const GET: APIRoute = async () => healthResponse(await health());
