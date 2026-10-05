// Ortak barkod sözlüğü: kullanıcıların onayladığı "barkod → şişe" eşleşmeleri.
//   GET  /api/barkod?kod=8690…   → {id, oy}  (en çok onaylanan şişe) ya da 404
//   POST /api/barkod {kod, id}   → onay oyu ekler
// Kişisel veri tutulmaz; her barkod için şişe başına oy sayısı saklanır. Aynı istemciden
// art arda gelen oylar sınırlanır (bir barkod için 10 dakikada bir oy).
import { json, hata, ozet, govdeOku, type Depo } from "./ortak.ts";

const kodGecerli = (k: string) => /^\d{8,14}$/.test(k);
const idGecerli = (i: string) => /^[a-z0-9][a-z0-9-]{1,79}$/.test(i);

function enCok(oylar: Record<string, number>) {
  let id = "", oy = 0;
  for (const [k, v] of Object.entries(oylar || {})) if (v > oy) { id = k; oy = v; }
  return { id, oy };
}

export async function isle(req: Request, depo: Depo): Promise<Response> {
  try {
    if (req.method === "GET") {
      const kod = String(new URL(req.url).searchParams.get("kod") || "").trim();
      if (!kodGecerli(kod)) return hata("Geçersiz barkod");
      const k = await depo.get("b/" + kod, { type: "json" });
      const e = enCok(k?.oylar);
      return e.id ? json(e) : hata("Bu barkod henüz tanınmıyor", 404);
    }
    if (req.method === "POST") {
      const g = await govdeOku(req, 2000);
      const kod = String(g.kod || "").trim(), id = String(g.id || "").trim();
      if (!kodGecerli(kod) || !idGecerli(id)) return hata("Geçersiz istek");
      const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-nf-client-connection-ip") || "";
      const sinir = "s/" + (await ozet(ip + "|" + kod)).slice(0, 24);
      const son = await depo.get(sinir, { type: "json" });
      if (son && Date.now() - son.t < 10 * 60 * 1000) return json({ tamam: true, tekrar: true });
      await depo.setJSON(sinir, { t: Date.now() });
      const k = (await depo.get("b/" + kod, { type: "json" })) || { oylar: {} };
      k.oylar[id] = (k.oylar[id] || 0) + 1;
      if (Object.keys(k.oylar).length > 20) return hata("Çok fazla farklı eşleşme", 409);
      k.son = new Date().toISOString();
      await depo.setJSON("b/" + kod, k);
      return json({ tamam: true, ...enCok(k.oylar) });
    }
    return hata("Desteklenmeyen istek", 405);
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}
