// Kayıt taşıma (pages.dev → tadimatlasi.com): tarayıcı her alan adını ayrı site saydığı için
// eski adresteki yerel kayıtlar (koleksiyon, notlar, ayarlar) yeni adrese tek kullanımlık bir
// kodla aktarılır.
//   POST /api/tasi {veri: {anahtar: metin}}  → {kod}   (15 dk geçerli)
//   GET  /api/tasi?kod=…                      → {veri}  (okununca silinir)
// Yalnızca site önekli localStorage anahtarları kabul edilir; içerik sunucuda yorumlanmaz.
import { json, hata, rastgele, govdeOku, type Depo } from "./ortak.ts";

const SURE = 15 * 60;
const kodGecerli = (k: string) => /^[a-z0-9]{24}$/.test(k);
const anahtarGecerli = (k: string) => /^(viski|bira|raki|sarap)_[A-Za-z0-9_-]{1,60}$/.test(k);

export async function isle(req: Request, depo: Depo): Promise<Response> {
  try {
    if (req.method === "POST") {
      const g = await govdeOku(req, 5_000_000);
      const veri: Record<string, string> = {};
      for (const [k, v] of Object.entries(g?.veri || {})) {
        if (anahtarGecerli(k) && typeof v === "string") veri[k] = v;
      }
      if (!Object.keys(veri).length) return hata("Taşınacak kayıt yok");
      const kod = rastgele(24, "abcdefghijkmnpqrstuvwxyz23456789");
      await depo.setJSON(kod, { veri, t: Date.now() }, { ttl: SURE });
      return json({ kod });
    }
    if (req.method === "GET") {
      const kod = String(new URL(req.url).searchParams.get("kod") || "");
      if (!kodGecerli(kod)) return hata("Geçersiz kod");
      const k = await depo.get(kod, { type: "json" });
      if (!k || Date.now() - k.t > SURE * 1000) return hata("Kod bulunamadı ya da süresi doldu", 404);
      await depo.delete(kod);
      return json({ veri: k.veri });
    }
    return hata("Desteklenmeyen istek", 405);
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}
