// Viski Atlası — şişe görseli yardımcısı
// Haftalık Claude görevi üreticilerin resmî sitelerinden şişe görseli bulur; bu betik
// görseli indirir, küçük bir WebP'ye çevirir (en fazla 160 px yükseklik) ve kaydeder.
//   node scripts/gorsel.mjs sec [adet]                      → görseli olmayan, henüz denenmemiş şişeler
//   node scripts/gorsel.mjs ekle <id> <gorselURL> <sayfaURL> <sahip>
//   node scripts/gorsel.mjs yok <id>                        → resmî görsel bulunamadı (sonraki turlarda atlanır)
//   node scripts/gorsel.mjs sil <id>                        → görseli kaldır (ör. şikâyet gelirse)
// Görseller img/sise/<id>.webp, kayıtlar data/gorseller.json içinde tutulur.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSONF = path.join(ROOT, "data", "gorseller.json");
const DIR = path.join(ROOT, "img", "sise");
const BUGUN = new Date().toISOString().slice(0, 10);

function dataOku() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const bas = html.indexOf("const DATA = [");
  const son = html.indexOf("\n];", bas);
  return vm.runInNewContext("(" + html.slice(bas + "const DATA = ".length, son + 2) + ")");
}
function dbOku() {
  try { return JSON.parse(fs.readFileSync(JSONF, "utf8")); } catch { return { gorseller: {}, yok: {} }; }
}
function dbYaz(db) {
  const sirala = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  db.gorseller = sirala(db.gorseller); db.yok = sirala(db.yok);
  fs.mkdirSync(path.dirname(JSONF), { recursive: true });
  fs.writeFileSync(JSONF, JSON.stringify(db, null, 1) + "\n");
}

const BUL_ONCELIK = { kolay: 0, tekel: 1, dutyfree: 2, zor: 3, muzayede: 4 };
const [komut, ...arg] = process.argv.slice(2);
const data = dataOku();
const ids = new Set(data.map((b) => b.id));
const db = dbOku();

if (komut === "sec") {
  const adet = +(arg[0] || 40);
  const liste = data
    .filter((b) => !db.gorseller[b.id] && !db.yok[b.id])
    .sort((a, b) => (BUL_ONCELIK[a.bul] ?? 5) - (BUL_ONCELIK[b.bul] ?? 5) || (b.puan || 0) - (a.puan || 0))
    .slice(0, adet)
    .map((b) => ({ id: b.id, ad: b.ad, damitimevi: b.dam, ulke: b.ulke, yas: b.yas, tur: b.tur }));
  console.log(JSON.stringify({ kalan: data.length - Object.keys(db.gorseller).length - Object.keys(db.yok).length, siseler: liste }, null, 1));
} else if (komut === "ekle" && arg.length >= 4) {
  const [id, url, sayfa, ...sahipParca] = arg;
  if (!ids.has(id)) throw new Error("bilinmeyen id: " + id);
  if (!/^https:\/\//.test(url) && !(process.env.GORSEL_TEST && /^http:\/\/localhost/.test(url))) throw new Error("görsel adresi https ile başlamalı");
  fs.mkdirSync(DIR, { recursive: true });
  const ham = path.join(DIR, "." + id + ".indir");
  // Node'un fetch'i bu ortamdaki proxy'yi kullanmadığı için curl
  execFileSync("curl", ["-sSfL", "-m", "40", "--max-filesize", "15000000", "-A", "Mozilla/5.0", "-o", ham, url]);
  const hedef = path.join(DIR, id + ".webp");
  // Şeffaf arka planlar beyaza oturtulur; en fazla 120x160, oran korunur
  execFileSync("convert", [ham + "[0]", "-background", "white", "-alpha", "remove", "-alpha", "off",
    "-trim", "+repage", "-resize", "120x160>", "-strip", "-quality", "78", hedef]);
  fs.rmSync(ham, { force: true });
  const boyut = execFileSync("identify", ["-format", "%wx%h", hedef]).toString();
  const [w, h] = boyut.split("x").map(Number);
  if (w < 24 || h < 40) { fs.rmSync(hedef); throw new Error("görsel çok küçük (" + boyut + "), şişe fotoğrafı değil gibi"); }
  delete db.yok[id];
  db.gorseller[id] = { dosya: "img/sise/" + id + ".webp", kaynak: sayfa, sahip: sahipParca.join(" "), tarih: BUGUN };
  dbYaz(db);
  console.log(`✓ ${id} ${boyut} (${fs.statSync(hedef).size} bayt)`);
} else if (komut === "yok" && arg[0]) {
  if (!ids.has(arg[0])) throw new Error("bilinmeyen id: " + arg[0]);
  db.yok[arg[0]] = BUGUN; dbYaz(db); console.log("– " + arg[0] + " resmî görsel yok olarak işaretlendi");
} else if (komut === "sil" && arg[0]) {
  const g = db.gorseller[arg[0]];
  if (g) fs.rmSync(path.join(ROOT, g.dosya), { force: true });
  delete db.gorseller[arg[0]]; db.yok[arg[0]] = BUGUN; dbYaz(db); console.log("✗ " + arg[0] + " görseli kaldırıldı");
} else {
  console.error("Kullanım: sec [adet] | ekle <id> <gorselURL> <sayfaURL> <sahip> | yok <id> | sil <id>");
  process.exit(1);
}
