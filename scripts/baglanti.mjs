// Üretici bağlantıları yardımcısı (resmî site + resmî sosyal medya)
// Aylık Claude görevi üreticilerin resmî bağlantılarını bulur/kontrol eder; bu betik kaydeder.
//   node scripts/baglanti.mjs sec [adet]                 → bağlantısı olmayan, henüz denenmemiş üreticiler (en çok şişesi olandan)
//   node scripts/baglanti.mjs ekle <üretici> web=URL ig=URL fb=URL x=URL yt=URL   (yalnızca bulunanlar)
//   node scripts/baglanti.mjs yok <üretici>              → resmî bağlantı bulunamadı (6 ay sonra yeniden denenir)
//   node scripts/baglanti.mjs kontrol [adet]             → en eski kontrol edilen resmî siteleri açar; çalışanların tarihini yeniler, kırıkları listeler
//   node scripts/baglanti.mjs sil <üretici> [alan]       → kaydı ya da tek bir alanı kaldır
// Kayıtlar data/baglantilar.json içinde; anahtar DATA'daki 'dam' alanı.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSONF = path.join(ROOT, "data", "baglantilar.json");
const BUGUN = new Date().toISOString().slice(0, 10);
const ALANLAR = ["web", "ig", "fb", "x", "yt"];
const ALAN_DESEN = { ig: /^https:\/\/(www\.)?instagram\.com\//, fb: /^https:\/\/(www\.|m\.)?facebook\.com\//, x: /^https:\/\/(www\.)?(x|twitter)\.com\//, yt: /^https:\/\/(www\.)?youtube\.com\// };

function dataOku() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const bas = html.indexOf("const DATA = [");
  const son = html.indexOf("\n];", bas);
  return vm.runInNewContext("(" + html.slice(bas + "const DATA = ".length, son + 2) + ")");
}
const dbOku = () => JSON.parse(fs.readFileSync(JSONF, "utf8"));
function dbYaz(db) {
  const sirala = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "tr")));
  db.baglantilar = sirala(db.baglantilar); db.yok = sirala(db.yok);
  fs.writeFileSync(JSONF, JSON.stringify(db, null, 1) + "\n");
}
function durumKodu(url) {
  try {
    return execFileSync("curl", ["-sL", "-m", "25", "-A", "Mozilla/5.0", "-o", "/dev/null", "-w", "%{http_code}", url], { encoding: "utf8" }).trim();
  } catch { return "000"; }
}

const [komut, ...arg] = process.argv.slice(2);
const db = dbOku();
const ureticiler = (() => {
  const m = new Map();
  for (const d of dataOku()) { const u = m.get(d.dam) || { n: 0, ulke: d.ulke, bolge: d.bolge, ornek: d.ad }; u.n++; m.set(d.dam, u); }
  return m;
})();

if (komut === "sec") {
  const adet = +arg[0] || 40, alti = new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10);
  const liste = [...ureticiler].filter(([k]) => !db.baglantilar[k] && !(db.yok[k] && db.yok[k] > alti)).sort((a, b) => b[1].n - a[1].n).slice(0, adet);
  for (const [k, u] of liste) console.log([k, u.ulke, u.bolge, u.n + " ürün", "ör. " + u.ornek].join("\t"));
  console.error(`${liste.length} üretici · kayıtlı ${Object.keys(db.baglantilar).length} / ${ureticiler.size}`);
} else if (komut === "ekle" && arg[0]) {
  const dam = arg[0];
  if (!ureticiler.has(dam)) { console.error("Bu ada sahip üretici yok: " + dam); process.exit(1); }
  const kayit = { ...(db.baglantilar[dam] || {}) };
  for (const a of arg.slice(1)) {
    const i = a.indexOf("="), k = a.slice(0, i), v = a.slice(i + 1).trim();
    if (!ALANLAR.includes(k)) { console.error("Bilinmeyen alan: " + k); process.exit(1); }
    if (!/^https:\/\/[^\s"<>]+$/.test(v)) { console.error("Geçersiz adres (https olmalı): " + v); process.exit(1); }
    if (ALAN_DESEN[k] && !ALAN_DESEN[k].test(v)) { console.error(`${k} adresi beklenen siteye ait değil: ${v}`); process.exit(1); }
    if (k === "web") { const kod = durumKodu(v); if (!/^[23]/.test(kod)) console.error(`⚠️ ${v} → HTTP ${kod} (bot korumalı olabilir; tarayıcıda açılıyorsa sorun yok)`); }
    kayit[k] = v;
  }
  if (!ALANLAR.some((k) => kayit[k])) { console.error("En az bir bağlantı gerekli"); process.exit(1); }
  kayit.kontrol = BUGUN;
  db.baglantilar[dam] = kayit; delete db.yok[dam]; dbYaz(db);
  console.log("✓ " + dam + " " + ALANLAR.filter((k) => kayit[k]).join(","));
} else if (komut === "yok" && arg[0]) {
  db.yok[arg[0]] = BUGUN; dbYaz(db); console.log("· " + arg[0] + " bulunamadı olarak işaretlendi");
} else if (komut === "kontrol") {
  const adet = +arg[0] || 60;
  const liste = Object.entries(db.baglantilar).filter(([, b]) => b.web).sort((a, b) => (a[1].kontrol || "").localeCompare(b[1].kontrol || "")).slice(0, adet);
  const kirik = [];
  for (const [dam, b] of liste) {
    const kod = durumKodu(b.web);
    if (/^[23]/.test(kod)) b.kontrol = BUGUN; else kirik.push([dam, b.web, kod]);
  }
  dbYaz(db);
  console.log(`${liste.length - kirik.length}/${liste.length} resmî site çalışıyor.`);
  for (const [d, u, k] of kirik) console.log(`KIRIK\t${d}\t${u}\tHTTP ${k}`);
} else if (komut === "sil" && arg[0]) {
  if (arg[1]) { if (db.baglantilar[arg[0]]) delete db.baglantilar[arg[0]][arg[1]]; } else delete db.baglantilar[arg[0]];
  dbYaz(db); console.log("✗ " + arg.join(" ") + " kaldırıldı");
} else {
  console.error("Kullanım: sec [adet] | ekle <üretici> web=URL ig=URL … | yok <üretici> | kontrol [adet] | sil <üretici> [alan]");
  process.exit(1);
}
