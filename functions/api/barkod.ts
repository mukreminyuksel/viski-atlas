// Cloudflare Pages katmanı (/api/barkod): çekirdek mantık api/barkod.ts içinde, veri Workers KV'de (bağlama adı: VERI).
import { isle } from "../../api/barkod.ts";
import { kvDepo } from "../../api/kv.ts";

export const onRequest = ({ request, env }: { request: Request; env: { VERI: any } }) =>
  env.VERI ? isle(request, kvDepo(env.VERI, "barkod/")) : new Response(JSON.stringify({ hata: "Sunucu deposu bağlı değil" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
