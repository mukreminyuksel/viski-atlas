// Kör Tadım Şovu sunucu mantığı birim testi (bellek içi sahte depo, ağ yok):
//   node --experimental-strip-types scripts/kor-test.ts
import { isle, KOR_TTL } from "../api/kor.ts";
import type { Depo } from "../api/ortak.ts";

const kayit = new Map<string, { v: string; meta?: any; ttl?: number }>();
const depo: Depo = {
  async get(k, o) { const x = kayit.get(k); return x ? (o?.type === "json" ? JSON.parse(x.v) : x.v) : null; },
  async setJSON(k, v, o) { kayit.set(k, { v: JSON.stringify(v), meta: o?.meta, ttl: o?.ttl }); },
  async delete(k) { kayit.delete(k); },
  async list(o) { return { blobs: [...kayit.keys()].filter((k) => k.startsWith(o?.prefix || "")).map((key) => ({ key, ...(kayit.get(key)!.meta ? { meta: kayit.get(key)!.meta } : {}) })) }; },
};
let hataSay = 0;
const dogrula = (kosul: unknown, ad: string) => { console.log((kosul ? "✓ " : "✗ ") + ad); if (!kosul) hataSay++; };
const post = async (g: unknown) => { const r = await isle(new Request("http://x/api/kor", { method: "POST", body: JSON.stringify(g) }), depo); return { d: r.status, v: await r.json() as any }; };
const get = async (q: string) => { const r = await isle(new Request("http://x/api/kor?" + q), depo); return { d: r.status, v: await r.json() as any }; };

const alanlar = [
  { k: "bolge", ad: "Bölge", secenekler: ["Islay", "Speyside", "Highland", "Japonya"] },
  { k: "yas", ad: "Yaş", secenekler: ["NAS", "≤12", "13–17", "18+"] },
];
const bardaklar = [
  { ad: "Laphroaig 10", alt: "Islay", tl: 3000, cevap: { bolge: "Islay", yas: "≤12" } },
  { ad: "Glenfiddich 18", alt: "Speyside", tl: 9000, cevap: { bolge: "Speyside", yas: "18+" } },
  { ad: "Hakushu 12", alt: "Japonya", tl: 7000, cevap: { bolge: "Japonya", yas: "≤12" } },
];

// --- Oda kurma ve sınırlar
dogrula((await post({ islem: "kor-olustur", pin: "12", alanlar, bardaklar })).d === 400, "kısa PIN reddedilir");
dogrula((await post({ islem: "kor-olustur", pin: "1234", alanlar, bardaklar: bardaklar.slice(0, 1) })).d === 400, "tek bardak reddedilir");
dogrula((await post({ islem: "kor-olustur", pin: "1234", alanlar, bardaklar: Array(9).fill(bardaklar[0]) })).d === 400, "9 bardak reddedilir");
const o = await post({ islem: "kor-olustur", ad: "Cuma gecesi", pin: "4321", alanlar, bardaklar });
dogrula(o.d === 200 && /^[1-9]\d{5}$/.test(o.v.kod), "oda kuruldu, 6 haneli kod: " + o.v.kod);
const kod = o.v.kod;
const metaHam = kayit.get(`${kod}/meta`)!;
dogrula(!metaHam.v.includes("4321") && JSON.parse(metaHam.v).pinOzet.length === 64, "PIN düz metin saklanmaz (SHA-256 özeti)");
dogrula(metaHam.ttl === KOR_TTL && KOR_TTL === 2592000, "kayıt 30 gün sonra sona erer (expirationTtl)");

// --- Katılım
const k1 = await post({ islem: "kor-katil", kod, ad: "Kaptan Haddock" });
const k2 = await post({ islem: "kor-katil", kod, ad: "Don Draper" });
const k3 = await post({ islem: "kor-katil", kod, ad: "Ron Swanson" });
dogrula([k1, k2, k3].every((k) => k.d === 200 && /^[a-z0-9]{10}$/.test(k.v.pid)), "3 misafir katıldı");
dogrula((await post({ islem: "kor-katil", kod, ad: "don draper" })).d === 400, "aynı takma ad ikinci kez alınamaz");
dogrula((await post({ islem: "kor-katil", kod, ad: "x".repeat(200) })).d === 200 && [...kayit.values()].every((x) => !x.v.includes("x".repeat(25))), "takma ad 24 karaktere kırpılır");
dogrula((await post({ islem: "kor-katil", kod: "000000", ad: "a" })).d === 400, "geçersiz oda kodu reddedilir");
dogrula((await post({ islem: "kor-katil", kod: "999999", ad: "a" })).d === 404, "olmayan oda 404");

// --- Oylar
const oy = (pid: string, i: number, p: number, notlar: string[], tahmin: any) => post({ islem: "kor-oy", kod, pid, i, p, notlar, tahmin });
const P = [k1.v.pid, k2.v.pid, k3.v.pid];
await oy(P[0], 0, 90, ["İsli", "Tuzlu/Deniz"], { bolge: "Islay", yas: "≤12" });
await oy(P[0], 1, 80, ["Meyveli"], { bolge: "Highland", yas: "18+" });
await oy(P[0], 2, 70, ["Çiçeksi"], { bolge: "Japonya", yas: "13–17" });
await oy(P[1], 0, 88, ["İsli"], { bolge: "Islay", yas: "NAS" });
await oy(P[1], 1, 82, ["Meyveli", "Bal"], { bolge: "Speyside", yas: "18+" });
await oy(P[1], 2, 72, ["Çiçeksi", "Meyveli"], { bolge: "Speyside", yas: "≤12" });
await oy(P[2], 0, 60, ["İsli"], { bolge: "Speyside" });
dogrula((await oy(P[2], 1, 101, [], {})).d === 400, "puan 0–100 dışında reddedilir");
dogrula((await oy(P[2], 7, 50, [], {})).d === 400, "olmayan bardak reddedilir");
dogrula((await oy("aaaaaaaaaa", 0, 50, [], {})).d === 404, "olmayan katılımcı reddedilir");
await oy(P[2], 1, 95, Array(20).fill(0).map((_, i) => "not" + i), { bolge: "Mars", yas: "18+" });
const k3kayit = JSON.parse(kayit.get(`${kod}/k/${P[2]}`)!.v);
dogrula(k3kayit.oylar[1].notlar.length === 6 && !k3kayit.oylar[1].tahmin.bolge && k3kayit.oylar[1].tahmin.yas === "18+", "en çok 6 not; seçenek dışı tahmin atılır");

// --- Oylama sürerken gizlilik
const d1 = await post({ islem: "kor-durum", kod, pid: P[0] });
const ham1 = JSON.stringify(d1.v);
dogrula(d1.d === 200 && d1.v.toplam === 4 && d1.v.tamamlayan === 2, `ilerleme: ${d1.v.toplam} kişiden ${d1.v.tamamlayan}'si tüm bardaklara oy verdi`);
dogrula(!/Laphroaig|Glenfiddich|Hakushu/.test(ham1), "perde öncesi bardak kimlikleri dönmez");
dogrula(!ham1.includes('"p":88') && !ham1.includes('"p":60') && !ham1.includes("pinOzet"), "perde öncesi başkalarının puanı ve PIN özeti dönmez");
dogrula(d1.v.ben && d1.v.ben.oylar[0].p === 90, "kişi kendi oylarını görür");
const d2 = await get(`kod=${kod}`);
dogrula(d2.d === 200 && !d2.v.ben && !d2.v.acilanlar && !JSON.stringify(d2.v).includes('"p":'), "GET durum (sahne) yalnızca ilerleme döndürür");
dogrula(!JSON.stringify(d2.v).includes(P[0]), "başkalarının pid'i dönmez");

// --- Perde
dogrula((await post({ islem: "kor-ac", kod, pin: "0000" })).d === 403, "yanlış PIN ile perde açılmaz");
for (let i = 0; i < 4; i++) await post({ islem: "kor-ac", kod, pin: "0000" });
dogrula((await post({ islem: "kor-ac", kod, pin: "4321" })).d === 429, "5 hatalı denemeden sonra PIN kilitlenir");
const m = JSON.parse(kayit.get(`${kod}/meta`)!.v); m.kilit = new Date(Date.now() - 1000).toISOString(); kayit.set(`${kod}/meta`, { ...kayit.get(`${kod}/meta`)!, v: JSON.stringify(m) });
const a1 = await post({ islem: "kor-ac", kod, pin: "4321" });
dogrula(a1.d === 200 && a1.v.perde && a1.v.acilan === 1 && a1.v.acilanlar.length === 1 && a1.v.acilanlar[0].ad === "Laphroaig 10", "perde açıldı: yalnızca Bardak A açıklandı");
dogrula(!JSON.stringify(a1.v).includes("Glenfiddich"), "henüz açılmayan bardak gizli kalır");
const A = a1.v.acilanlar[0];
dogrula(Math.abs(A.ort - (90 + 88 + 60) / 3) < 0.1 && A.notlar[0][0] === "İsli" && A.notlar[0][1] === 3, `A ortalaması ${A.ort}, en çok not ${A.notlar[0][0]}`);
dogrula(A.dogru.bolge.length === 2 && A.dogru.yas.length === 1 && A.dogru.yas[0] === "Kaptan Haddock", "doğru tahmin edenler adlarıyla döner");
dogrula(a1.v.final === null, "final ödülleri tüm bardaklar açılmadan dönmez");
dogrula((await oy(P[2], 2, 50, [], {})).d === 400, "perde açılınca oylama kapanır");
dogrula((await post({ islem: "kor-katil", kod, ad: "Geç kalan" })).d === 400, "perde açılınca katılım kapanır");
await post({ islem: "kor-ac", kod, pin: "4321" });
const a3 = await post({ islem: "kor-ac", kod, pin: "4321" });
dogrula(a3.v.acilan === 3 && a3.v.final, "üç bardak açıldı, final hazır");
const f = a3.v.final;
dogrula(f.keskin.length === 3 && f.keskin[0].puan === 4 && f.keskin[1].puan === 4 && f.keskin[2].ad === "Ron Swanson" && f.enCok === 6, `🏆 En keskin burun (berabere): ${f.keskin[0].ad}, ${f.keskin[1].ad} (${f.keskin[0].puan}/${f.enCok})`);
dogrula(f.ikiz && [f.ikiz.a, f.ikiz.b].sort().join("+") === "Don Draper+Kaptan Haddock", `👯 Tat ikizleri: ${f.ikiz.a} & ${f.ikiz.b} (fark ${f.ikiz.fark})`);
dogrula(f.surpriz && f.surpriz.i === 0 && f.surpriz.pahali.i === 1, "💸 Fiyat/lezzet sürprizi: en ucuz bardak (A) en pahalıyla kıyaslanır");
dogrula(!JSON.stringify(a3.v).match(/"p":\d/), "perde sonrası da tek tek puanlar dönmez");
const fazla = await post({ islem: "kor-ac", kod, pin: "4321" });
dogrula(fazla.v.acilan === 3, "fazladan açma bardak sayısını aşmaz");

// --- 30 kişi sınırı
const o2 = await post({ islem: "kor-olustur", pin: "1111", alanlar, bardaklar });
for (let i = 0; i < 30; i++) await post({ islem: "kor-katil", kod: o2.v.kod, ad: "Misafir " + i });
dogrula((await post({ islem: "kor-katil", kod: o2.v.kod, ad: "31. kişi" })).d === 400, "oda başına en çok 30 katılımcı");
const hepsi = await post({ islem: "kor-ac", kod: o2.v.kod, pin: "1111", hepsi: true });
dogrula(hepsi.v.acilan === 3 && hepsi.v.final && hepsi.v.final.keskin.length === 0 && hepsi.v.final.ikiz === null, "oy yokken final boş ödüllerle döner");
dogrula((await post({ islem: "kor-sil", kod: o2.v.kod, pin: "1111" })).d === 200 && ![...kayit.keys()].some((k) => k.startsWith(o2.v.kod)), "ev sahibi odayı silebilir");
dogrula((await post({ islem: "kor-ac", kod, pin: "4321", ad: "<script>" })).d === 200, "fazladan alan sorun çıkarmaz");
dogrula((await isle(new Request("http://x/api/kor", { method: "POST", body: "{bozuk" }), depo)).status === 400, "bozuk JSON 400");
dogrula((await isle(new Request("http://x/api/kor", { method: "POST", body: "x".repeat(50_000) }), depo)).status === 500, "çok büyük gövde reddedilir");

console.log(hataSay ? `\n${hataSay} test başarısız` : "\nTüm testler geçti");
process.exit(hataSay ? 1 : 0);
