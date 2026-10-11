// Kör Tadım Şovu: TV/laptop "sahne ekranı" + misafir telefonları. Hesap yok, takma adla katılım.
//   POST /api/kor {islem:"kor-olustur", ad, pin, alanlar[], bardaklar[]}   → {kod}
//        alanlar:   [{k, ad, secenekler[]}]  — tahmin alanları (viski: bölge + yaş, bira: stil …)
//        bardaklar: [{ad, alt, tl, cevap:{k: değer}}] — 2–8 bardak; sırası = Bardak A, B, C…
//   POST /api/kor {islem:"kor-katil", kod, ad}                            → {pid}
//   POST /api/kor {islem:"kor-oy", kod, pid, i, p, notlar[], tahmin{}}    → {tamam}
//   POST /api/kor {islem:"kor-ac", kod, pin[, hepsi]}  → perdeyi açar / sıradaki bardağı açıklar
//   POST /api/kor {islem:"kor-sil", kod, pin}           → odayı siler
//   POST /api/kor {islem:"kor-durum", kod[, pid]}  (ya da GET /api/kor?kod=…&pid=…) → durum
// Depo düzeni ("kor/" öneki altında): "<kod>/meta" oda + gizli cevaplar, "<kod>/k/<pid>" her misafirin
// oyları (aynı anda oy verenler birbirini ezmesin diye ayrı anahtar; liste metadata'sında {ad, s} tutulur,
// böylece sahne ekranının yoklaması tek liste işlemiyle biter), "<kod>/sonuc" perde açılınca bir kez
// hesaplanan sonuçlar. Bütün kayıtlar 30 gün sonra kendiliğinden silinir (KV expirationTtl).
//
// GİZLİLİK: Perde açılana kadar sunucu hiçbir bardağın kimliğini ve hiç kimsenin puanını döndürmez;
// herkes yalnızca takma adları ve kaç bardağa oy verildiğini görür. Kişi kendi oylarını pid'iyle görür.
// Perdeden sonra da tek tek puanlar dönmez: yalnızca ortalamalar, en çok seçilen notlar, doğru tahmin
// edenlerin adları ve gece sonu ödülleri. Ev sahibi PIN'i düz metin saklanmaz (SHA-256 özeti).
import { json, hata, ozet, govdeOku, rastgele, kirp, type Depo } from "./ortak.ts";

export const KOR_TTL = 30 * 24 * 3600;
const EN_AZ_BARDAK = 2, EN_COK_BARDAK = 8, EN_COK_KATILIMCI = 30, EN_COK_ALAN = 4, EN_COK_SECENEK = 80, EN_COK_NOT = 6;
const HATALI_PIN_SINIRI = 5, KILIT_DK = 5;
const kodGecerli = (v: unknown) => typeof v === "string" && /^[1-9][0-9]{5}$/.test(v);
const pidGecerli = (v: unknown) => typeof v === "string" && /^[a-z0-9]{10}$/.test(v);
const pinGecerli = (v: unknown) => typeof v === "string" && /^[0-9]{4,8}$/.test(v);
const pinOzet = (kod: string, pin: string) => ozet(`kor:${kod}:${pin}`);
const norm = (v: unknown) => String(v ?? "").trim().toLocaleLowerCase("tr");
const sakla = (depo: Depo, k: string, v: unknown, meta?: Record<string, unknown>) => depo.setJSON(k, v, { ttl: KOR_TTL, ...(meta ? { meta } : {}) });

function yeniKod(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return String(1 + (b[0] % 9)) + Array.from(b.slice(1), (x) => String(x % 10)).join("");
}

function alanlariTemizle(g: unknown) {
  return (Array.isArray(g) ? g : []).slice(0, EN_COK_ALAN).map((a: any) => ({
    k: kirp(a?.k, 16).replace(/[^a-z0-9_]/gi, ""),
    ad: kirp(a?.ad, 30),
    secenekler: [...new Set((Array.isArray(a?.secenekler) ? a.secenekler : []).map((s: unknown) => kirp(s, 40)).filter(Boolean))].slice(0, EN_COK_SECENEK) as string[],
  })).filter((a) => a.k && a.ad && a.secenekler.length >= 2);
}

function bardaklariTemizle(g: unknown, alanlar: { k: string }[]) {
  return (Array.isArray(g) ? g : []).slice(0, EN_COK_BARDAK + 1).map((b: any) => {
    const cevap: Record<string, string> = {};
    for (const a of alanlar) { const v = kirp(b?.cevap?.[a.k], 40); if (v) cevap[a.k] = v; }
    const tl = Math.round(Number(b?.tl));
    return { ad: kirp(b?.ad, 80), alt: kirp(b?.alt, 120), tl: Number.isFinite(tl) && tl > 0 && tl < 10_000_000 ? tl : 0, cevap };
  }).filter((b) => b.ad);
}

async function misafirler(depo: Depo, kod: string) {
  const { blobs } = await depo.list({ prefix: `${kod}/k/` });
  return blobs;
}

// Perde açılınca bir kez çalışır: oylama kapandığı için sonuç bir daha değişmez.
async function sonucHesapla(depo: Depo, kod: string, meta: any) {
  const { blobs } = await depo.list({ prefix: `${kod}/k/` });
  const kisiler = (await Promise.all(blobs.map((b) => depo.get(b.key, { type: "json" })))).filter(Boolean) as any[];
  const n = meta.bardaklar.length;
  const bardaklar = meta.bardaklar.map((b: any, i: number) => {
    const ps: number[] = [], notSay: Record<string, number> = {}, dogru: Record<string, string[]> = {};
    for (const a of meta.alanlar) if (b.cevap[a.k]) dogru[a.k] = [];
    for (const k of kisiler) {
      const o = k.oylar?.[i];
      if (!o) continue;
      if (typeof o.p === "number") ps.push(o.p);
      for (const t of o.notlar || []) notSay[t] = (notSay[t] || 0) + 1;
      for (const a of meta.alanlar) if (b.cevap[a.k] && o.tahmin?.[a.k] && norm(o.tahmin[a.k]) === norm(b.cevap[a.k])) dogru[a.k].push(k.ad);
    }
    const tahminEden: Record<string, number> = {};
    for (const a of meta.alanlar) tahminEden[a.k] = kisiler.filter((k) => k.oylar?.[i]?.tahmin?.[a.k]).length;
    return {
      ort: ps.length ? Math.round((ps.reduce((x, y) => x + y, 0) / ps.length) * 10) / 10 : null,
      n: ps.length, min: ps.length ? Math.min(...ps) : null, max: ps.length ? Math.max(...ps) : null,
      notlar: Object.entries(notSay).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "tr")).slice(0, 3),
      dogru, tahminEden,
    };
  });
  // 🏆 En keskin burun: her doğru tahmin 1 puan
  let enCok = 0;
  for (const b of meta.bardaklar) enCok += meta.alanlar.filter((a: any) => b.cevap[a.k]).length;
  const keskin = kisiler.map((k) => {
    let puan = 0;
    meta.bardaklar.forEach((b: any, i: number) => {
      for (const a of meta.alanlar) if (b.cevap[a.k] && k.oylar?.[i]?.tahmin?.[a.k] && norm(k.oylar[i].tahmin[a.k]) === norm(b.cevap[a.k])) puan++;
    });
    return { ad: k.ad, puan };
  }).filter((x) => x.puan > 0).sort((x, y) => y.puan - x.puan || x.ad.localeCompare(y.ad, "tr")).slice(0, 5);
  // 👯 Tat ikizleri: en az 2 ortak bardakta puan farkı ortalaması en küçük iki kişi
  let ikiz: { a: string; b: string; fark: number; ortak: number } | null = null;
  for (let x = 0; x < kisiler.length; x++) for (let y = x + 1; y < kisiler.length; y++) {
    const f: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = kisiler[x].oylar?.[i]?.p, q = kisiler[y].oylar?.[i]?.p;
      if (typeof p === "number" && typeof q === "number") f.push(Math.abs(p - q));
    }
    if (f.length >= 2) {
      const fark = Math.round((f.reduce((s, v) => s + v, 0) / f.length) * 10) / 10;
      if (!ikiz || fark < ikiz.fark) ikiz = { a: kisiler[x].ad, b: kisiler[y].ad, fark, ortak: f.length };
    }
  }
  // 💸 Fiyat/lezzet sürprizi: fiyatı bilinen bardakların ucuz yarısından ortalaması en yüksek olan,
  // puanı fiyatlı bardakların ortalamasından yüksekse ve en pahalı bardak o değilse
  let surpriz: any = null;
  const fiyatli = meta.bardaklar.map((b: any, i: number) => ({ i, tl: b.tl, ort: bardaklar[i].ort })).filter((x: any) => x.tl > 0 && x.ort !== null);
  if (fiyatli.length >= 2) {
    const ucuzdan = [...fiyatli].sort((a, b) => a.tl - b.tl);
    const ortOrt = fiyatli.reduce((s: number, x: any) => s + x.ort, 0) / fiyatli.length;
    const aday = ucuzdan.slice(0, Math.ceil(fiyatli.length / 2)).sort((a: any, b: any) => b.ort - a.ort || a.tl - b.tl)[0];
    const pahali = ucuzdan[ucuzdan.length - 1];
    if (aday && aday.i !== pahali.i && aday.ort >= ortOrt) surpriz = { i: aday.i, tl: aday.tl, ort: aday.ort, pahali: { i: pahali.i, tl: pahali.tl, ort: pahali.ort } };
  }
  const sonuc = {
    katilimcilar: kisiler.map((k) => ({ ad: k.ad, sayi: Object.values(k.oylar || {}).filter((o: any) => o && typeof o.p === "number").length })),
    bardaklar, keskin, enCok, ikiz, surpriz,
  };
  await sakla(depo, `${kod}/sonuc`, sonuc);
  return sonuc;
}

async function durum(depo: Depo, kod: string, meta: any, pid: unknown) {
  const n = meta.bardaklar.length;
  let ben: any = null;
  if (pidGecerli(pid)) {
    const k = await depo.get(`${kod}/k/${pid}`, { type: "json" });
    if (k) ben = { ad: k.ad, oylar: k.oylar || {} };
  }
  const ortak = {
    kod, ad: meta.ad, n, alanlar: meta.alanlar, perde: !!meta.perde, acilan: meta.acilan || 0, olusturma: meta.olusturma, ben,
  };
  if (!meta.perde) {
    // Oylama sürüyor: yalnızca takma adlar ve kaç bardağa puan verildiği
    const blobs = await misafirler(depo, kod);
    const katilimcilar = blobs.map((b: any) => ({ ad: String(b.meta?.ad ?? "?"), sayi: Number(b.meta?.s) || 0 }));
    return json({ ...ortak, katilimcilar, toplam: katilimcilar.length, tamamlayan: katilimcilar.filter((k) => k.sayi >= n).length });
  }
  const sonuc = (await depo.get(`${kod}/sonuc`, { type: "json" })) || (await sonucHesapla(depo, kod, meta));
  const acilan = Math.min(meta.acilan || 0, n);
  return json({
    ...ortak,
    katilimcilar: sonuc.katilimcilar, toplam: sonuc.katilimcilar.length,
    tamamlayan: sonuc.katilimcilar.filter((k: any) => k.sayi >= n).length,
    acilanlar: meta.bardaklar.slice(0, acilan).map((b: any, i: number) => ({ i, ad: b.ad, alt: b.alt, tl: b.tl, cevap: b.cevap, ...sonuc.bardaklar[i] })),
    final: acilan >= n ? { keskin: sonuc.keskin, enCok: sonuc.enCok, ikiz: sonuc.ikiz, surpriz: sonuc.surpriz } : null,
  });
}

async function pinDogrula(depo: Depo, kod: string, meta: any, pin: unknown): Promise<Response | null> {
  if (meta.kilit && Date.parse(meta.kilit) > Date.now()) return hata(`Çok fazla hatalı PIN denemesi; ${KILIT_DK} dakika sonra yeniden dene`, 429);
  if (pinGecerli(pin) && (await pinOzet(kod, pin as string)) === meta.pinOzet) {
    if (meta.hatali) { meta.hatali = 0; delete meta.kilit; }
    return null;
  }
  meta.hatali = (meta.hatali || 0) + 1;
  if (meta.hatali >= HATALI_PIN_SINIRI) { meta.hatali = 0; meta.kilit = new Date(Date.now() + KILIT_DK * 60_000).toISOString(); }
  await sakla(depo, `${kod}/meta`, meta);
  return hata("PIN yanlış", 403);
}

export async function isle(req: Request, depo: Depo): Promise<Response> {
  try {
    let g: any;
    if (req.method === "GET") {
      const u = new URL(req.url);
      g = { islem: "kor-durum", kod: u.searchParams.get("kod"), pid: u.searchParams.get("pid") };
    } else if (req.method === "POST") g = await govdeOku(req, 40_000);
    else return hata("Desteklenmeyen istek", 405);

    if (g.islem === "kor-olustur") {
      const ad = kirp(g.ad, 60) || "Kör Tadım";
      if (!pinGecerli(g.pin)) return hata("PIN 4–8 haneli bir sayı olmalı");
      const alanlar = alanlariTemizle(g.alanlar);
      const bardaklar = bardaklariTemizle(g.bardaklar, alanlar);
      if (bardaklar.length < EN_AZ_BARDAK) return hata(`En az ${EN_AZ_BARDAK} bardak seçmelisin`);
      if (bardaklar.length > EN_COK_BARDAK) return hata(`En fazla ${EN_COK_BARDAK} bardak olabilir`);
      let kod = "";
      for (let d = 0; d < 6 && !kod; d++) { const k = yeniKod(); if (!(await depo.get(`${k}/meta`, { type: "json" }))) kod = k; }
      if (!kod) return hata("Oda kodu üretilemedi, yeniden dene", 503);
      await sakla(depo, `${kod}/meta`, {
        ad, pinOzet: await pinOzet(kod, g.pin), alanlar, bardaklar, perde: false, acilan: 0, olusturma: new Date().toISOString(),
      });
      return json({ kod });
    }

    if (!kodGecerli(g.kod)) return hata("Oda kodu 6 haneli olmalı");
    const meta = await depo.get(`${g.kod}/meta`, { type: "json" });
    if (!meta) return hata("Bu oda bulunamadı ya da süresi doldu", 404);

    if (g.islem === "kor-durum") return await durum(depo, g.kod, meta, g.pid);

    if (g.islem === "kor-katil") {
      const ad = kirp(g.ad, 24);
      if (!ad) return hata("Bir takma ad yazmalısın");
      if (meta.perde) return hata("Perde açıldı; bu odaya artık katılınamaz");
      const blobs = await misafirler(depo, g.kod);
      if (blobs.length >= EN_COK_KATILIMCI) return hata(`Oda dolu (en fazla ${EN_COK_KATILIMCI} kişi)`);
      if (blobs.some((b: any) => norm(b.meta?.ad) === norm(ad))) return hata("Bu takma ad bu odada alınmış; başka bir ad seç");
      const pid = rastgele(10);
      await sakla(depo, `${g.kod}/k/${pid}`, { pid, ad, oylar: {}, katilma: new Date().toISOString() }, { ad, s: 0 });
      return json({ pid });
    }

    if (g.islem === "kor-oy") {
      if (meta.perde) return hata("Perde açıldı; oylama kapandı");
      if (!pidGecerli(g.pid)) return hata("Geçersiz katılımcı");
      const i = Number(g.i);
      if (!Number.isInteger(i) || i < 0 || i >= meta.bardaklar.length) return hata("Geçersiz bardak");
      const anahtar = `${g.kod}/k/${g.pid}`;
      const k = await depo.get(anahtar, { type: "json" });
      if (!k) return hata("Katılımcı bulunamadı", 404);
      const p = g.p === null || g.p === undefined || g.p === "" ? null : Math.round(Number(g.p));
      if (p !== null && (!Number.isFinite(p) || p < 0 || p > 100)) return hata("Puan 0–100 arası olmalı");
      const notlar = [...new Set((Array.isArray(g.notlar) ? g.notlar : []).map((t: unknown) => kirp(t, 24)).filter(Boolean))].slice(0, EN_COK_NOT);
      const tahmin: Record<string, string> = {};
      for (const a of meta.alanlar) {
        const v = kirp(g.tahmin?.[a.k], 40);
        if (v && a.secenekler.some((s: string) => norm(s) === norm(v))) tahmin[a.k] = v;
      }
      k.oylar = k.oylar || {};
      k.oylar[i] = { p, notlar, tahmin };
      const s = Object.values(k.oylar).filter((o: any) => o && typeof o.p === "number").length;
      await sakla(depo, anahtar, k, { ad: k.ad, s });
      return json({ tamam: true, sayi: s });
    }

    if (g.islem === "kor-ac" || g.islem === "kor-sil") {
      const red = await pinDogrula(depo, g.kod, meta, g.pin);
      if (red) return red;
      if (g.islem === "kor-sil") {
        const { blobs } = await depo.list({ prefix: `${g.kod}/` });
        await Promise.all(blobs.map((b) => depo.delete(b.key)));
        return json({ tamam: true });
      }
      const n = meta.bardaklar.length;
      if (!meta.perde) { meta.perde = true; meta.acilan = 0; await sonucHesapla(depo, g.kod, meta); }
      meta.acilan = g.hepsi ? n : Math.min(n, (meta.acilan || 0) + 1);
      await sakla(depo, `${g.kod}/meta`, meta);
      return await durum(depo, g.kod, meta, null);
    }
    return hata("Bilinmeyen işlem");
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}
