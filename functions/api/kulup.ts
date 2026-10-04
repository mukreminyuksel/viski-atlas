// Cloudflare Pages katmanı (/api/kulup): çekirdek mantık api/kulup.ts içinde, veri Workers KV'de (bağlama adı: VERI).
import { isle } from "../../api/kulup.ts";
import { kvDepo } from "../../api/kv.ts";

export const onRequest = ({ request, env }: { request: Request; env: { VERI: any } }) =>
  env.VERI ? isle(request, kvDepo(env.VERI, "kulupler/"), kvDepo(env.VERI, "tadim-geceleri/")) : new Response(JSON.stringify({ hata: "Sunucu deposu bağlı değil" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
