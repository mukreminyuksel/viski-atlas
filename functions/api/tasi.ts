// Cloudflare Pages katmanı (/api/tasi): çekirdek mantık api/tasi.ts içinde, veri Workers KV'de (bağlama adı: VERI).
import { isle } from "../../api/tasi.ts";
import { kvDepo } from "../../api/kv.ts";

export const onRequest = ({ request, env }: { request: Request; env: { VERI: any } }) =>
  env.VERI ? isle(request, kvDepo(env.VERI, "tasi/")) : new Response(JSON.stringify({ hata: "Sunucu deposu bağlı değil" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
