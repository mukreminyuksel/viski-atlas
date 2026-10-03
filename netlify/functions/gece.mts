// Tadım Gecesi: davetle çalışan, hesapsız tadım etkinlikleri.
//   POST /api/gece {islem:"olustur", ad, tarih, yer, aciklama, kor, siseler[], olusturanAd} → {id, yk, pid}
//   GET  /api/gece?id=...[&yk=...]                     → gece bilgisi + katılımcılar + (açıklandıysa) şişeler
//   POST /api/gece {islem:"katil", id, ad}               → {pid}
//   POST /api/gece {islem:"puan", id, pid, sira, p, not} → {tamam}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"acikla"|"bitir"|"ac"|"sil"}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"guncelle", ad, tarih, yer, aciklama, kor}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"sise-ekle", sise}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"sise-cikar"|"sise-degistir", sira[, sise]}
//   POST /api/gece {islem:"yonet", id, yk, eylem:"katilimci-cikar", pid}
// Depo düzeni: "<id>/meta" gece bilgisi, "<id>/k/<pid>" her katılımcının kendi puanları
// (aynı anda puan veren katılımcılar birbirinin verisini ezmesin diye ayrı anahtarlar).
import type { Context, Config } from "@netlify/functions";
import { depoAl, json, hata, ozet, govdeOku, rastgele, kirp, type Depo } from "../lib/ortak.mts";

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
      const yk = u.searchParams.get("yk");
      const yonetici = !!yk && (await ozet(yk)) === meta.ykOzet;
      const kisiler = await katilimcilar(depo, id!);
      const acik = !meta.kor || meta.aciklandi;
      return json({
        id, ad: meta.ad, tarih: meta.tarih, yer: meta.yer, aciklama: meta.aciklama, kor: meta.kor,
        aciklandi: !!meta.aciklandi, bitti: !!meta.bitti, olusturma: meta.olusturma, yonetici,
        siseSayisi: meta.siseler.length,
        // Kör tadımda şişelerin kimliği yalnızca açıklanınca (ya da yöneticiye) gösterilir
        siseler: acik || yonetici ? meta.siseler : null,
        katilimcilar: kisiler.map((k: any) => ({ pid: k.pid, ad: k.ad, puanlar: k.puanlar || {} })),
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

export default async (req: Request, _context: Context) => isle(req, depoAl("tadim-geceleri"));

export const config: Config = { path: "/api/gece" };
