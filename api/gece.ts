// Tadım Gecesi: davetle çalışan, hesapsız tadım etkinlikleri.
//   POST /api/gece {islem:"olustur", ad, tarih, yer, aciklama, kor, siseler[], olusturanAd} → {id, yk, pid}
//   GET  /api/gece?id=...[&yk=...][&pid=...][&rid=...]  → gece bilgisi; gizlilik kuralları aşağıda
//   POST /api/gece {islem:"lcv", id, rid?, ad, durum:"geliyor"|"belki"|"gelmiyor"} → {rid}
//   POST /api/gece {islem:"katil", id, ad}               → {pid}
//   POST /api/gece {islem:"puan", id, pid, sira, p, not} → {tamam}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"acikla"|"bitir"|"ac"|"sil"}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"guncelle", ad, tarih, yer, aciklama, kor}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"sise-ekle", sise}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"sise-cikar"|"sise-degistir", sira[, sise]}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"katilimci-cikar", pid}
// Depo düzeni: "<id>/meta" gece bilgisi, "<id>/k/<pid>" her katılımcının kendi puanları
// (aynı anda puan veren katılımcılar birbirinin verisini ezmesin diye ayrı anahtarlar),
// "<id>/r/<rid>" katılım cevapları (Geliyorum/Belki/Gelemiyorum).
//
// GİZLİLİK: pid ve rid, sahiplerinin yazma anahtarıdır; yalnızca sahibine (ve pid'ler ev sahibine)
// gönderilir. Bireysel puan ve notlar yalnızca sahibine ve ev sahibine gider; diğer katılımcılar
// isimleri, kaç şişeye puan verildiğini ve (kör değilse ya da açıklandıysa) sunucuda hesaplanan
// ortalamaları görür.
import { json, hata, ozet, govdeOku, rastgele, kirp, type Depo } from "./ortak.ts";

const EN_COK_SISE = 12, EN_COK_KATILIMCI = 40;
const idGecerli = (v: unknown) => typeof v === "string" && /^[a-z0-9]{10}$/.test(v);

// Bir örnek çıkarıldığında/değiştirildiğinde katılımcı puanlarını yeniden numaralandır:
// çıkarmada o örneğin puanları silinir ve sonrakiler bir sıra kayar; değiştirmede yalnızca o örneğin puanları silinir.
async function puanlariDuzenle(depo: Depo, id: string, sira: number, kaydir: boolean) {
  const { blobs } = await depo.list({ prefix: `${id}/k/` });
  await Promise.all(blobs.map(async (b) => {
    const k = await depo.get(b.key, { type: "json" });
    if (!k || !k.puanlar) return;
    const yeni: Record<string, unknown> = {};
    for (const [anahtar, deger] of Object.entries(k.puanlar)) {
      const i = Number(anahtar);
      if (i === sira) continue;
      yeni[String(kaydir && i > sira ? i - 1 : i)] = deger;
    }
    k.puanlar = yeni;
    await depo.setJSON(b.key, k);
  }));
}

// Örnek başına ortalama/aralık/yayılım ve "damak ikizleri" (yalnızca isimler) — sunucuda hesaplanır
function ozetHesapla(kisiler: any[], n: number) {
  const ornekler = [];
  for (let i = 0; i < n; i++) {
    const ps = kisiler.map((k) => k.puanlar?.[i]?.p).filter((p) => typeof p === "number") as number[];
    const ort = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
    const sd = ps.length > 1 && ort !== null ? Math.sqrt(ps.reduce((a, b) => a + (b - ort) ** 2, 0) / ps.length) : 0;
    ornekler.push({ i, n: ps.length, ort, sd, min: ps.length ? Math.min(...ps) : null, max: ps.length ? Math.max(...ps) : null });
  }
  let ikiz: { a: string; b: string; f: number } | null = null;
  for (let a = 0; a < kisiler.length; a++) for (let b = a + 1; b < kisiler.length; b++) {
    const fark: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = kisiler[a].puanlar?.[i]?.p, y = kisiler[b].puanlar?.[i]?.p;
      if (typeof x === "number" && typeof y === "number") fark.push(Math.abs(x - y));
    }
    if (fark.length >= 2) { const f = fark.reduce((p, q) => p + q, 0) / fark.length; if (!ikiz || f < ikiz.f) ikiz = { a: kisiler[a].ad, b: kisiler[b].ad, f }; }
  }
  return { ornekler, ikiz };
}
const puanSayisi = (k: any) => Object.values(k.puanlar || {}).filter((x: any) => x && typeof x.p === "number").length;

async function lcvler(depo: Depo, id: string) {
  const { blobs } = await depo.list({ prefix: `${id}/r/` });
  return (await Promise.all(blobs.map((b) => depo.get(b.key, { type: "json" })))).filter(Boolean);
}

async function katilimcilar(depo: Depo, id: string) {
  const { blobs } = await depo.list({ prefix: `${id}/k/` });
  const liste = await Promise.all(blobs.map((b) => depo.get(b.key, { type: "json" })));
  return liste.filter(Boolean);
}

export async function isle(req: Request, depo: Depo): Promise<Response> {
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const id = u.searchParams.get("id");
      if (!idGecerli(id)) return hata("Geçersiz gece bağlantısı");
      const meta = await depo.get(`${id}/meta`, { type: "json" });
      if (!meta) return hata("Bu tadım gecesi bulunamadı ya da silinmiş", 404);
      const yk = u.searchParams.get("yk"), pid = u.searchParams.get("pid"), rid = u.searchParams.get("rid");
      const yonetici = !!yk && (await ozet(yk)) === meta.ykOzet;
      const [kisiler, cevaplar] = await Promise.all([katilimcilar(depo, id!), lcvler(depo, id!)]);
      const acik = !meta.kor || meta.aciklandi;
      const ben = kisiler.find((k: any) => k.pid === pid);
      return json({
        id, ad: meta.ad, tarih: meta.tarih, yer: meta.yer, aciklama: meta.aciklama, kor: meta.kor,
        aciklandi: !!meta.aciklandi, bitti: !!meta.bitti, olusturma: meta.olusturma, yonetici, kulup: meta.kulup || null,
        siseSayisi: meta.siseler.length,
        // Kör tadımda şişelerin kimliği yalnızca açıklanınca (ya da yöneticiye) gösterilir
        siseler: acik || yonetici ? meta.siseler : null,
        // Herkese: isim + kaç şişeye puan verdiği. pid yalnızca kendisine ve ev sahibine.
        katilimcilar: kisiler.map((k: any) => ({
          ad: k.ad, sayi: puanSayisi(k), ben: k === ben,
          ...(yonetici || k === ben ? { pid: k.pid } : {}),
          ...(yonetici ? { puanlar: k.puanlar || {} } : {}),
        })),
        benimPuanlarim: ben ? ben.puanlar || {} : null,
        // Ortalamalar: kör değilse ya da açıklandıysa herkese, aksi halde yalnızca ev sahibine
        ozet: acik || yonetici ? ozetHesapla(kisiler, meta.siseler.length) : null,
        lcv: cevaplar.map((r: any) => ({ ad: r.ad, durum: r.durum, ben: r.rid === rid })),
      });
    }
    if (req.method !== "POST") return hata("Desteklenmeyen istek", 405);
    const g = await govdeOku(req, 50_000);

    if (g.islem === "olustur") {
      const ad = kirp(g.ad, 80);
      if (!ad) return hata("Gecenin bir adı olmalı");
      const siseler = (Array.isArray(g.siseler) ? g.siseler : []).map((s: unknown) => kirp(s, 80)).filter(Boolean).slice(0, EN_COK_SISE);
      if (!siseler.length) return hata("En az bir şişe seçmelisin");
      const id = rastgele(10), yk = rastgele(16), pid = rastgele(8);
      const simdi = new Date().toISOString();
      await depo.setJSON(`${id}/meta`, {
        ad, tarih: kirp(g.tarih, 30), yer: kirp(g.yer, 80), aciklama: kirp(g.aciklama, 500), kor: !!g.kor,
        siseler, ykOzet: await ozet(yk), aciklandi: false, bitti: false, olusturma: simdi,
        ...(g.kulup && /^[a-z0-9]{10}$/.test(String(g.kulup.kid)) ? { kulup: { kid: g.kulup.kid, ad: kirp(g.kulup.ad, 60) } } : {}),
      });
      await depo.setJSON(`${id}/k/${pid}`, { pid, ad: kirp(g.olusturanAd, 30) || "Ev sahibi", puanlar: {}, katilma: simdi });
      return json({ id, yk, pid });
    }

    if (!idGecerli(g.id)) return hata("Geçersiz gece bağlantısı");
    const meta = await depo.get(`${g.id}/meta`, { type: "json" });
    if (!meta) return hata("Bu tadım gecesi bulunamadı ya da silinmiş", 404);

    if (g.islem === "katil") {
      const ad = kirp(g.ad, 30);
      if (!ad) return hata("Bir takma ad yazmalısın");
      if (meta.bitti) return hata("Bu gece sona erdi");
      const { blobs } = await depo.list({ prefix: `${g.id}/k/` });
      if (blobs.length >= EN_COK_KATILIMCI) return hata("Bu gecenin katılımcı sınırı doldu");
      const pid = rastgele(8);
      await depo.setJSON(`${g.id}/k/${pid}`, { pid, ad, puanlar: {}, katilma: new Date().toISOString() });
      return json({ pid });
    }

    if (g.islem === "lcv") {
      const ad = kirp(g.ad, 30), durum = String(g.durum);
      if (!ad) return hata("Bir takma ad yazmalısın");
      if (!["geliyor", "belki", "gelmiyor"].includes(durum)) return hata("Geçersiz cevap");
      let rid = typeof g.rid === "string" && /^[a-z0-9]{8}$/.test(g.rid) ? g.rid : null;
      if (rid && !(await depo.get(`${g.id}/r/${rid}`, { type: "json" }))) rid = null;
      if (!rid) {
        const { blobs } = await depo.list({ prefix: `${g.id}/r/` });
        if (blobs.length >= 60) return hata("Bu gecenin cevap sınırı doldu");
        rid = rastgele(8);
      }
      await depo.setJSON(`${g.id}/r/${rid}`, { rid, ad, durum, t: new Date().toISOString() });
      return json({ rid });
    }

    if (g.islem === "puan") {
      if (meta.bitti) return hata("Bu gece sona erdi; puanlar kilitlendi");
      if (typeof g.pid !== "string" || !/^[a-z0-9]{8}$/.test(g.pid)) return hata("Geçersiz katılımcı");
      const sira = Number(g.sira);
      if (!Number.isInteger(sira) || sira < 0 || sira >= meta.siseler.length) return hata("Geçersiz örnek");
      const anahtar = `${g.id}/k/${g.pid}`;
      const k = await depo.get(anahtar, { type: "json" });
      if (!k) return hata("Katılımcı bulunamadı", 404);
      const p = g.p === null || g.p === "" ? null : Math.round(Number(g.p));
      if (p !== null && (!Number.isFinite(p) || p < 0 || p > 100)) return hata("Puan 0-100 arası olmalı");
      k.puanlar = k.puanlar || {};
      k.puanlar[sira] = { p, not: kirp(g.not, 300) };
      await depo.setJSON(anahtar, k);
      return json({ tamam: true });
    }

    if (g.islem === "yonet") {
      if (typeof g.yk !== "string" || (await ozet(g.yk)) !== meta.ykOzet) return hata("Bu işlem için yönetici bağlantısı gerekli", 403);
      if (g.eylem === "sil") {
        const { blobs } = await depo.list({ prefix: `${g.id}/` });
        await Promise.all(blobs.map((b) => depo.delete(b.key)));
        return json({ tamam: true });
      }
      if (g.eylem === "guncelle") {
        const ad = kirp(g.ad, 80);
        if (!ad) return hata("Gecenin bir adı olmalı");
        meta.ad = ad; meta.tarih = kirp(g.tarih, 30); meta.yer = kirp(g.yer, 80); meta.aciklama = kirp(g.aciklama, 500);
        // Şişeler açıklandıktan sonra kör tadım geri açılamaz
        if (!meta.aciklandi && typeof g.kor === "boolean") meta.kor = g.kor;
        await depo.setJSON(`${g.id}/meta`, meta);
        return json({ tamam: true });
      }
      if (g.eylem === "sise-ekle") {
        const sise = kirp(g.sise, 80);
        if (!sise) return hata("Şişe seçilmedi");
        if (meta.siseler.length >= EN_COK_SISE) return hata(`En fazla ${EN_COK_SISE} şişe olabilir`);
        meta.siseler.push(sise);
        await depo.setJSON(`${g.id}/meta`, meta);
        return json({ tamam: true });
      }
      if (g.eylem === "sise-cikar" || g.eylem === "sise-degistir") {
        const sira = Number(g.sira);
        if (!Number.isInteger(sira) || sira < 0 || sira >= meta.siseler.length) return hata("Geçersiz örnek");
        if (g.eylem === "sise-cikar") {
          if (meta.siseler.length <= 1) return hata("Gecede en az bir şişe kalmalı");
          meta.siseler.splice(sira, 1);
          await puanlariDuzenle(depo, g.id, sira, true);
        } else {
          const sise = kirp(g.sise, 80);
          if (!sise) return hata("Şişe seçilmedi");
          meta.siseler[sira] = sise;
          await puanlariDuzenle(depo, g.id, sira, false);
        }
        await depo.setJSON(`${g.id}/meta`, meta);
        return json({ tamam: true });
      }
      if (g.eylem === "katilimci-cikar") {
        if (typeof g.pid !== "string" || !/^[a-z0-9]{8}$/.test(g.pid)) return hata("Geçersiz katılımcı");
        await depo.delete(`${g.id}/k/${g.pid}`);
        return json({ tamam: true });
      }
      if (g.eylem === "acikla") meta.aciklandi = true;
      else if (g.eylem === "bitir") { meta.bitti = true; meta.aciklandi = true; }
      else if (g.eylem === "ac") meta.bitti = false;
      else return hata("Bilinmeyen işlem");
      await depo.setJSON(`${g.id}/meta`, meta);
      return json({ tamam: true });
    }
    return hata("Bilinmeyen işlem");
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}
