// Bulut senkronu: giriş yapmadan, kişiye özel kodla koleksiyon saklama.
//   POST /api/sync {islem:"olustur", state}      → {kod}
//   GET  /api/sync?kod=...                         → {state, guncelleme}
//   PUT  /api/sync {kod, state}                    → {guncelleme}
// Kod, viski temalı kelimelerden üretilir (ör. "kehribar-islay-mese-427"). Depoda kodun
// kendisi değil SHA-256 özeti anahtar olarak tutulur.
import type { Context, Config } from "@netlify/functions";
import { depoAl, json, hata, ozet, govdeOku, type Depo } from "../lib/ortak.mts";

const K1 = ["kehribar", "bakir", "mese", "fici", "arpa", "malt", "turba", "duman", "bal", "vanilya", "tarcin", "karamel", "kakao", "incir", "seri", "porto",
  "madeira", "kizil", "altin", "gumus", "zeytin", "ceviz", "findik", "kayisi", "visne", "elma", "armut", "portakal", "limon", "biber", "zencefil", "kahve"];
const K2 = ["islay", "speyside", "highland", "lowland", "orkney", "skye", "jura", "arran", "mull", "kentucky", "tennessee", "yamazaki", "hakushu", "yoichi",
  "kavalan", "amrut", "dublin", "cork", "tain", "oban", "brora", "keith", "elgin", "rothes", "dufftown", "tobermory", "bowmore", "portellen", "kilchoman", "campbeltown", "lochranza", "talisker"];
const K3 = ["kadeh", "fici", "imbik", "kazan", "mantar", "etiket", "sise", "damla", "yudum", "koku", "bitis", "damak", "burun", "gece", "ates", "ruzgar",
  "dalga", "kaya", "tepe", "vadi", "nehir", "liman", "fener", "deniz", "sis", "kar", "yildiz", "ay", "gunes", "orman", "dag", "ada"];

function kodUret(): string {
  const b = new Uint32Array(4);
  crypto.getRandomValues(b);
  return `${K1[b[0] % K1.length]}-${K2[b[1] % K2.length]}-${K3[b[2] % K3.length]}-${100 + (b[3] % 900)}`;
}
const kodTemizle = (k: unknown) => String(k ?? "").toLowerCase().trim().replace(/\s+/g, "-").slice(0, 80);
const kodGecerli = (k: string) => /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/.test(k);

function stateDogrula(s: any): string | null {
  if (!s || typeof s !== "object") return "liste eksik";
  if (!Array.isArray(s.have) || !Array.isArray(s.target)) return "liste biçimi hatalı";
  return null;
}

export async function isle(req: Request, depo: Depo): Promise<Response> {
  try {
    if (req.method === "GET") {
      const kod = kodTemizle(new URL(req.url).searchParams.get("kod"));
      if (!kodGecerli(kod)) return hata("Geçersiz kod biçimi");
      const kayit = await depo.get(await ozet(kod), { type: "json" });
      if (!kayit) return hata("Bu koda ait liste bulunamadı", 404);
      return json(kayit);
    }
    const g = await govdeOku(req);
    if (req.method === "POST" && g.islem === "olustur") {
      const e = stateDogrula(g.state);
      if (e) return hata(e);
      let kod = kodUret();
      for (let i = 0; i < 5 && (await depo.get(await ozet(kod), { type: "json" })); i++) kod = kodUret();
      const kayit = { state: g.state, guncelleme: new Date().toISOString(), olusturma: new Date().toISOString() };
      await depo.setJSON(await ozet(kod), kayit);
      return json({ kod, guncelleme: kayit.guncelleme });
    }
    if (req.method === "PUT") {
      const kod = kodTemizle(g.kod);
      if (!kodGecerli(kod)) return hata("Geçersiz kod biçimi");
      const e = stateDogrula(g.state);
      if (e) return hata(e);
      const anahtar = await ozet(kod);
      const eski = await depo.get(anahtar, { type: "json" });
      if (!eski) return hata("Bu koda ait liste bulunamadı", 404);
      const guncelleme = new Date().toISOString();
      await depo.setJSON(anahtar, { ...eski, state: g.state, guncelleme });
      return json({ guncelleme });
    }
    return hata("Desteklenmeyen istek", 405);
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}

export default async (req: Request, _context: Context) => isle(req, depoAl("koleksiyonlar"));

export const config: Config = { path: "/api/sync" };
