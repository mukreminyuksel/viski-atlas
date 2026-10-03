// Viski Atlası — fiyat güncelleme yardımcısı (API anahtarı gerektirmez)
// Haftalık Claude Routine'i (claude.ai'deki zamanlanmış görev) tarafından kullanılır:
//   node scripts/fiyat-guncelle.mjs sec [adet]      → araştırılacak şişeleri, kuru ve kalibrasyon
//                                                     fiyatlarını yazdırır (data/arastir.json)
//   node scripts/fiyat-guncelle.mjs uygula dosya.json → bulunan fiyatları güvenlik kontrollerinden
//                                                     geçirip data/fiyatlar.json'a yazar
// Bulgu dosyası biçimi:
//   {"sonuclar":[{"id":"...","tl":12345,"tur":"tr_raf|tr_liste|dutyfree|tahmin",
//                 "kaynak":"https://...","guven":"yuksek|orta|dusuk","not":"..."}]}

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "index.html");
const OUT = path.join(ROOT, "data", "fiyatlar.json");

const BUGUN = new Date().toISOString().slice(0, 10);

// ---- Veri ----
function dataOku() {
  const html = fs.readFileSync(HTML, "utf8");
  const bas = html.indexOf("const DATA = [");
  const son = html.indexOf("\n];", bas);
  if (bas < 0 || son < 0) throw new Error("index.html içinde DATA bulunamadı");
  return vm.runInNewContext("(" + html.slice(bas + "const DATA = ".length, son + 2) + ")");
}

function jsonOku() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")); }
  catch { return { guncelleme: null, kur: null, fiyatlar: {}, denendi: {}, inceleme: [] }; }
}

// ---- TCMB kuru ----
async function kurOku() {
  try {
    const r = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml");
    const x = await r.text();
    const al = (k) => {
      const m = x.match(new RegExp(`Kod="${k}"[\\s\\S]*?<ForexSelling>([\\d.]+)</ForexSelling>`));
      return m ? +m[1] : null;
    };
    const usd = al("USD"), eur = al("EUR"), gbp = al("GBP");
    if (usd && eur) return { usd, eur, gbp, tarih: BUGUN };
  } catch (e) { console.warn("TCMB kuru alınamadı:", e.message); }
  return null;
}

// ---- Şişe seçimi: hiç doğrulanmamış / en eski doğrulananlar önce; bulunabilirlik ve puan öncelikli ----
const BUL_ONCELIK = { kolay: 0, tekel: 1, dutyfree: 2, zor: 3, muzayede: 4 };
function sec(data, fiyatlar, adet, denendi = {}) {
  const son = (id) => [fiyatlar[id]?.tarih || "0000", denendi[id] || "0000"].sort().pop();
  return [...data]
    .sort((a, b) => {
      const ta = son(a.id), tb = son(b.id);
      if (ta !== tb) return ta < tb ? -1 : 1;
      const ba = BUL_ONCELIK[a.bul] ?? 5, bb = BUL_ONCELIK[b.bul] ?? 5;
      if (ba !== bb) return ba - bb;
      return (b.puan || 0) - (a.puan || 0);
    })
    .slice(0, adet);
}

// Kalibrasyon için son 6 ayda gerçek Türkiye kaynağından doğrulanmış birkaç fiyat
function capalar(data, fiyatlar) {
  const sinir = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  return data
    .filter((b) => { const f = fiyatlar[b.id]; return f && (f.tur === "tr_raf" || f.tur === "tr_liste") && f.tarih >= sinir; })
    .slice(0, 12)
    .map((b) => `- ${b.ad} (${b.abv}%): ${fiyatlar[b.id].tl} TL (${fiyatlar[b.id].tarih})`);
}

// ---- Güvenlik kontrolleri ----
const TURLER = new Set(["tr_raf", "tr_liste", "dutyfree", "tahmin"]);
function denetle(s, b, eski) {
  if (!TURLER.has(s.tur)) return "geçersiz tür";
  if (!Number.isFinite(s.tl) || s.tl < 300 || s.tl > 5_000_000) return "geçersiz fiyat";
  const onceki = eski?.tl || b.tl;
  if (onceki > 0) {
    const oran = s.tl / onceki;
    const sert = oran < 0.6 || oran > 1.8;
    if (sert && !(s.guven === "yuksek" && s.tur !== "tahmin" && s.kaynak)) return `şüpheli değişim (x${oran.toFixed(2)})`;
  }
  // Düşük güvenli bulgu ancak küçük bir düzeltmeyse (±%15) uygulanır
  if (s.guven === "dusuk" && onceki > 0 && Math.abs(s.tl / onceki - 1) > 0.15) return "düşük güven, büyük değişim";
  // Son 6 ayda gerçek kaynaktan doğrulanmış fiyatı tahminle ezme
  if (s.tur === "tahmin" && eski && eski.tur !== "tahmin") {
    const yas = (Date.now() - Date.parse(eski.tarih)) / 864e5;
    if (yas < 180) return "doğrulanmış fiyat tahminle ezilmez";
  }
  return null;
}

// ---- Komutlar ----
const KAYNAK_ONCELIGI = "tr_raf (Türkiye mağaza) > tr_liste (ithalatçı/zam listesi) > dutyfree > tahmin (yurtdışı fiyatı + Türkiye vergileri)";

async function secKomutu(adet) {
  const data = dataOku();
  const db = jsonOku();
  const kur = (await kurOku()) || db.kur;
  const secilen = sec(data, db.fiyatlar, adet, db.denendi).map((b) => ({
    id: b.id, ad: b.ad, damitimevi: b.dam, tur: b.tur, yas: b.yas, abv: b.abv, bulunabilirlik: b.bul,
    kayitli_tl: db.fiyatlar[b.id]?.tl || b.tl,
  }));
  const cikti = { tarih: BUGUN, kur, kaynak_onceligi: KAYNAK_ONCELIGI, kalibrasyon: capalar(data, db.fiyatlar), siseler: secilen };
  fs.writeFileSync(path.join(ROOT, "data", "arastir.json"), JSON.stringify(cikti, null, 1) + "\n");
  console.log(JSON.stringify(cikti, null, 1));
}

function uygulaKomutu(dosya) {
  const data = dataOku();
  const db = jsonOku();
  const byId = new Map(data.map((b) => [b.id, b]));
  const sonuclar = JSON.parse(fs.readFileSync(dosya, "utf8")).sonuclar || [];
  let kabul = 0, red = 0;
  db.inceleme = [];
  for (const s of sonuclar) {
    const b = byId.get(s.id);
    if (!b || s.tl == null) continue;
    s.tl = Math.round(Number(s.tl) / 50) * 50;
    const eski = db.fiyatlar[s.id];
    const neden = denetle(s, b, eski);
    if (neden) {
      red++;
      db.inceleme.push({ id: s.id, onerilen: s.tl, mevcut: eski?.tl || b.tl, tur: s.tur, kaynak: s.kaynak || "", neden });
      continue;
    }
    db.fiyatlar[s.id] = {
      tl: s.tl, tarih: BUGUN, tur: s.tur, guven: s.guven || "orta",
      ...(s.kaynak ? { kaynak: s.kaynak } : {}), ...(s.not ? { not: String(s.not).slice(0, 160) } : {}),
    };
    kabul++;
  }
  // Araştırılıp fiyatı bulunamayan şişeler de "denendi" olarak işaretlenir; böylece sıra
  // sonraki haftalarda diğer şişelere geçer, bunlar ancak tüm katalog dolaşılınca tekrar denenir.
  db.denendi = db.denendi || {};
  try {
    for (const b of JSON.parse(fs.readFileSync(path.join(ROOT, "data", "arastir.json"), "utf8")).siseler) db.denendi[b.id] = BUGUN;
  } catch { for (const s of sonuclar) if (byId.has(s.id)) db.denendi[s.id] = BUGUN; }
  db.denendi = Object.fromEntries(Object.entries(db.denendi).sort(([a], [b]) => a.localeCompare(b)));
  db.guncelleme = BUGUN;
  db.fiyatlar = Object.fromEntries(Object.entries(db.fiyatlar).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(OUT, JSON.stringify(db, null, 1) + "\n");
  console.log(`Kabul: ${kabul} · Reddedilen: ${red} · Toplam doğrulanmış: ${Object.keys(db.fiyatlar).length}/${data.length}`);
  for (const r of db.inceleme) console.log(`  ✗ ${r.id}: ${r.onerilen} TL (mevcut ${r.mevcut}) — ${r.neden}`);
}

const [komut, arg] = process.argv.slice(2);
if (komut === "sec") await secKomutu(+(arg || 40));
else if (komut === "uygula" && arg) uygulaKomutu(arg);
else { console.error("Kullanım: sec [adet] | uygula <bulgular.json>"); process.exit(1); }
