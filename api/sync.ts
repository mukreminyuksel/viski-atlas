// Bulut senkronu: giriş yapmadan, kişiye özel kodla koleksiyon saklama.
//   POST /api/sync {islem:"olustur", state}      → {kod}
//   GET  /api/sync?kod=...                         → {state, guncelleme}
//   PUT  /api/sync {kod, state}                    → {guncelleme}
//   POST /api/sync {islem:"telefon-bagla", kod, tel, pin, eskiPin?}  → koda telefon + PIN ile giriş ekler
//   POST /api/sync {islem:"telefon-giris", tel, pin}                 → {kod}
//   POST /api/sync {islem:"telefon-kaldir", kod, tel}
// Kod, viski temalı kelimelerden üretilir (ör. "kehribar-islay-mese-427"). Depoda kodun
// kendisi değil SHA-256 özeti anahtar olarak tutulur. Telefon kaydı "tel/<özet>" altında durur;
// numaranın ve PIN'in kendisi saklanmaz. 10 hatalı PIN denemesinde numara 1 saat kilitlenir.
import { json, hata, ozet, govdeOku, type Depo } from "./ortak.ts";

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

// Türkiye numaraları tek biçime: 0532…, +90 532…, 532… hepsi "532…" olur
function telTemizle(t: unknown): string {
  let d = String(t ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("90")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
const telGecerli = (d: string) => /^\d{10,15}$/.test(d);
const pinGecerli = (p: unknown): p is string => typeof p === "string" && /^\d{4,6}$/.test(p);
const telAnahtar = async (tel: string) => "tel/" + (await ozet("tel:" + tel));
const pinOzeti = (tel: string, pin: string) => ozet(`pin:${tel}:${pin}`);
const EN_COK_HATA = 10, KILIT_DK = 60;

// PIN kontrolü; hatalı denemeleri sayar, sınırda numarayı kilitler
async function pinKontrol(depo: Depo, anahtar: string, kayit: any, tel: string, pin: unknown): Promise<Response | null> {
  if (kayit.kilit && kayit.kilit > new Date().toISOString()) {
    const dk = Math.ceil((Date.parse(kayit.kilit) - Date.now()) / 60000);
    return hata(`Çok fazla hatalı deneme; ${dk} dakika sonra tekrar dene`, 429);
  }
  if (pinGecerli(pin) && (await pinOzeti(tel, pin)) === kayit.pinOzet) {
    if (kayit.hatali) await depo.setJSON(anahtar, { ...kayit, hatali: 0, kilit: null });
    return null;
  }
  const hatali = (kayit.hatali || 0) + 1;
  if (hatali >= EN_COK_HATA) {
    await depo.setJSON(anahtar, { ...kayit, hatali: 0, kilit: new Date(Date.now() + KILIT_DK * 60000).toISOString() });
    return hata(`Çok fazla hatalı deneme; numara ${KILIT_DK} dakika kilitlendi`, 429);
  }
  await depo.setJSON(anahtar, { ...kayit, hatali });
  return hata(`PIN hatalı (${EN_COK_HATA - hatali} deneme hakkın kaldı)`, 403);
}

function stateDogrula(s: any): string | null {
  if (!s || typeof s !== "object") return "liste eksik";
  if (!Array.isArray(s.have) || !Array.isArray(s.target)) return "liste biçimi hatalı";
  return null;
}

// Eski sunucudan (Netlify) taşıma: listede bulunamayan kod ya da numara ilk kullanımda eski
// sunucuya sorulur, bulunursa buraya kopyalanır. Böylece kullanıcı aynı kodla / aynı telefon+PIN
// ile devam eder. "x-tasima" başlığı iki sunucunun birbirine sonsuz sorması ihtimaline karşı.
async function eskiIstek(eski: string, yol: string, govde?: any): Promise<Response | null> {
  try {
    return await fetch(eski + yol, {
      method: govde ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-tasima": "1" },
      body: govde ? JSON.stringify(govde) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
}
async function eskidenGetir(depo: Depo, eski: string | undefined, kod: string): Promise<any> {
  if (!eski) return null;
  const r = await eskiIstek(eski, "/api/sync?kod=" + encodeURIComponent(kod));
  if (!r || r.status !== 200) return null;
  const kayit = await r.json().catch(() => null);
  if (!kayit || stateDogrula(kayit.state)) return null;
  const yeni = { ...kayit, tasindi: new Date().toISOString() };
  await depo.setJSON(await ozet(kod), yeni);
  return yeni;
}

export async function isle(req: Request, depo: Depo, eskiSunucu?: string): Promise<Response> {
  const eski = req.headers.get("x-tasima") ? undefined : eskiSunucu;
  const listeAl = async (kod: string) => (await depo.get(await ozet(kod), { type: "json" })) || (await eskidenGetir(depo, eski, kod));
  try {
    if (req.method === "GET") {
      const kod = kodTemizle(new URL(req.url).searchParams.get("kod"));
      if (!kodGecerli(kod)) return hata("Geçersiz kod biçimi");
      const kayit = await listeAl(kod);
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
    if (req.method === "POST" && g.islem === "telefon-giris") {
      const tel = telTemizle(g.tel);
      if (!telGecerli(tel)) return hata("Telefon numarasını kontrol et");
      const anahtar = await telAnahtar(tel);
      const kayit = await depo.get(anahtar, { type: "json" });
      if (!kayit && eski && pinGecerli(g.pin)) {
        // Eski sunucuda bu numara+PIN ile kayıt var mı? PIN'i eski sunucu doğrular (kendi kilidiyle).
        const r = await eskiIstek(eski, "/api/sync", { islem: "telefon-giris", tel, pin: g.pin });
        if (r && r.status === 200) {
          const { kod } = await r.json();
          if (kodGecerli(kod) && (await listeAl(kod))) {
            await depo.setJSON(anahtar, { kod, pinOzet: await pinOzeti(tel, g.pin), hatali: 0, kilit: null, guncelleme: new Date().toISOString() });
            return json({ kod });
          }
        } else if (r && (r.status === 403 || r.status === 429)) {
          return hata((await r.json().catch(() => ({}))).hata || "PIN hatalı", r.status);
        }
      }
      if (!kayit) return hata("Bu numarayla kayıtlı liste yok", 404);
      const red = await pinKontrol(depo, anahtar, kayit, tel, g.pin);
      if (red) return red;
      if (!(await listeAl(kayit.kod))) return hata("Bu numaraya bağlı liste bulunamadı", 404);
      return json({ kod: kayit.kod });
    }
    if (req.method === "POST" && (g.islem === "telefon-bagla" || g.islem === "telefon-kaldir")) {
      const kod = kodTemizle(g.kod), tel = telTemizle(g.tel);
      if (!kodGecerli(kod)) return hata("Geçersiz kod biçimi");
      if (!telGecerli(tel)) return hata("Telefon numarasını kontrol et");
      if (!(await listeAl(kod))) return hata("Bu koda ait liste bulunamadı", 404);
      const anahtar = await telAnahtar(tel);
      const kayit = await depo.get(anahtar, { type: "json" });
      if (g.islem === "telefon-kaldir") {
        if (kayit && kayit.kod === kod) await depo.delete(anahtar);
        return json({ tamam: true });
      }
      if (!pinGecerli(g.pin)) return hata("PIN 4-6 haneli rakam olmalı");
      // Numara başka bir listeye bağlıysa üzerine yazmak için o listenin PIN'i gerekir.
      // Aynı listeye bağlıysa kodu bilen PIN'i yenileyebilir (PIN'i unutma çaresi).
      if (kayit && kayit.kod !== kod) {
        if (g.eskiPin === undefined) return hata("Bu numara başka bir listeye bağlı", 409);
        const red = await pinKontrol(depo, anahtar, kayit, tel, g.eskiPin);
        if (red) return red;
      }
      await depo.setJSON(anahtar, { kod, pinOzet: await pinOzeti(tel, g.pin), hatali: 0, kilit: null, guncelleme: new Date().toISOString() });
      return json({ tamam: true });
    }
    if (req.method === "PUT") {
      const kod = kodTemizle(g.kod);
      if (!kodGecerli(kod)) return hata("Geçersiz kod biçimi");
      const e = stateDogrula(g.state);
      if (e) return hata(e);
      const anahtar = await ozet(kod);
      const onceki = await listeAl(kod);
      if (!onceki) return hata("Bu koda ait liste bulunamadı", 404);
      const guncelleme = new Date().toISOString();
      await depo.setJSON(anahtar, { ...onceki, state: g.state, guncelleme });
      return json({ guncelleme });
    }
    return hata("Desteklenmeyen istek", 405);
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}
