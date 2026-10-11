// İşlev denetimi: siteyi yerelde açar, her sekmeyi, arama kutusunu, seçim menüsünü ve
// zararsız düğmeleri (masaüstü + 390 px mobil) dener; sayfa hatalarını ve etkisiz aramaları raporlar.
//   node scripts/denetim.mjs            → hata varsa çıkış kodu 1
// Playwright gerekir: yoksa `npm i --prefix /tmp/pw playwright` (tarayıcı indirme: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.basename(ROOT).replace(/-atlas$/, "");
let pw;
for (const p of ["playwright", "/tmp/pw/node_modules/playwright", "/tmp/sdkt/node_modules/playwright"]) { try { pw = require(p); break; } catch {} }
if (!pw) { console.error("Playwright bulunamadı: npm i --prefix /tmp/pw playwright"); process.exit(2); }
const PORT = 8790 + Math.floor(Math.random() * 100);
const srv = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
const exe = process.env.CHROMIUM || "/opt/pw-browsers/chromium";
const b = await pw.chromium.launch({ executablePath: exe });
const YASAK = /sil|kaldır|sıfırla|çıkış|paylaş|indir|kamera|tara|bulut|gönder|oluştur|katıl|kaydet|yükle|içe|dışa|telefon|pin|kod|whatsapp|kopyala|yazdır/i;
const FORM = /kod|pin|tel|^na|budget|ad$|isim|name|not/i;
const rapor = { site: SITE, hatalar: [], etkisizArama: [], tasma: [] };
for (const mod of [{ width: 1280, height: 900 }, { width: 390, height: 844, isMobile: true, hasTouch: true }]) {
  const { width, height, ...ek } = mod;
  const c = await b.newContext({ serviceWorkers: "block", viewport: { width, height }, ...ek });
  await c.addInitScript((s) => localStorage.setItem(s + "_yas", "1"), SITE);
  const p = await c.newPage(); let adim = "yükleme";
  p.on("pageerror", (e) => rapor.hatalar.push(`[${width}px] ${adim} → ${e.message}`));
  p.on("dialog", (d) => d.dismiss());
  await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(2500);
  const views = await p.evaluate(() => [...document.querySelectorAll(".tab[data-view]")].map((t) => t.dataset.view));
  for (const v of views) {
    adim = v;
    await p.evaluate((v) => document.querySelector('.tab[data-view="' + v + '"]').click(), v); await p.waitForTimeout(600);
    if (width === 1280) {
      const ids = await p.$$eval("input[type=text],input[type=search],input:not([type])", (els) => els.filter((e) => e.offsetParent && e.id).map((e) => e.id));
      for (const id of ids.filter((i) => !FORM.test(i))) {
        adim = v + " #" + id;
        const once = await p.evaluate(() => document.body.innerText.length);
        try { await p.fill("#" + id, "kırmızı"); await p.waitForTimeout(600); } catch { continue; }
        if (once === (await p.evaluate(() => document.body.innerText.length))) rapor.etkisizArama.push(adim);
        await p.fill("#" + id, ""); await p.waitForTimeout(250);
      }
      const sels = await p.$$eval("select", (els) => els.filter((e) => e.offsetParent && e.id).map((e) => [e.id, e.options.length]));
      for (const [id, n] of sels) { adim = v + " select#" + id; for (let i = 1; i < Math.min(n, 4); i++) { try { await p.selectOption("#" + id, { index: i }); await p.waitForTimeout(200); } catch {} } try { await p.selectOption("#" + id, { index: 0 }); } catch {} }
    }
    const n = await p.evaluate(() => { const vw = [...document.querySelectorAll(".view")].find((x) => x.offsetParent) || document.body;
      const els = [...vw.querySelectorAll("button,.chip,[data-f],.aroma,.stilkart,.card,summary")].filter((e) => e.offsetParent);
      els.forEach((e, i) => e.setAttribute("data-dnt", i)); return els.length; });
    for (let i = 0; i < Math.min(n, 25); i++) {
      const t = await p.evaluate((i) => { const e = document.querySelector('[data-dnt="' + i + '"]'); return e && e.offsetParent ? (e.innerText || e.title || "").slice(0, 40) : null; }, i);
      if (t === null || YASAK.test(t)) continue;
      adim = v + " [" + t.replace(/\s+/g, " ") + "]";
      await p.evaluate((i) => document.querySelector('[data-dnt="' + i + '"]').click(), i); await p.waitForTimeout(150);
      await p.keyboard.press("Escape");
      await p.evaluate((v) => { const t = document.querySelector('.tab[data-view="' + v + '"]'); if (!t.classList.contains("active")) t.click(); }, v);
    }
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) rapor.tasma.push(`[${width}px] ${v}`);
  }
  await c.close();
}
await b.close(); srv.kill();
rapor.hatalar = [...new Set(rapor.hatalar)];
console.log(JSON.stringify(rapor, null, 1));
process.exit(rapor.hatalar.length || rapor.tasma.length ? 1 : 0);
