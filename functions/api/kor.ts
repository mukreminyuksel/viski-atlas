// Cloudflare Pages katmanı (/api/kor): Kör Tadım Şovu. Çekirdek mantık api/kor.ts içinde,
// veri Workers KV'de (bağlama adı: VERI, anahtar öneki "kor/", kayıtlar 30 günde kendiliğinden silinir).
import { isle } from "../../api/kor.ts";
import { kvDepo } from "../../api/kv.ts";

export const onRequest = ({ request, env }: { request: Request; env: { VERI: any } }) =>
  env.VERI ? isle(request, kvDepo(env.VERI, "kor/")) : new Response(JSON.stringify({ hata: "Sunucu deposu bağlı değil" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
