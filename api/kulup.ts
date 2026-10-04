// Kulüp: davetle girilen kapalı viski topluluğu (hesap yok, üye başına gizli anahtar).
//   POST /api/kulup {islem:"olustur", ad, aciklama, benAd}          → {kid, davet, uid, anahtar}
//   GET  /api/kulup?kid=...&davet=...                                 → katılmadan önce önizleme {ad, uyeSayisi}
//   GET  /api/kulup?kid=...&uid=...&anahtar=...                       → üyeye kulüp sayfası
//   POST /api/kulup {islem:"katil", kid, davet, ad}                   → {uid, anahtar}
//   POST /api/kulup {islem:"gece-ekle", kid, uid, anahtar, gid}       → kulübe tadım gecesi bağla
//   POST /api/kulup {islem:"ayril", kid, uid, anahtar}
//   POST /api/kulup {islem:"yonet", kid, uid, anahtar, eylem, ...}    (yalnızca kurucu/yönetici)
//       eylem: "guncelle" {ad, aciklama} | "uye-cikar" {hedef} | "yonetici-yap"/"yoneticilik-al" {hedef}
//              | "davet-yenile" | "gece-cikar" {gid} | "sil" (yalnızca kurucu)
// Depo düzeni: "<kid>/meta" {ad, aciklama, davetOzet, geceler[], olusturma}, "<kid>/u/<uid>" üye
// {uid, ad, rol: "kurucu"|"yonetici"|"uye", anahtarOzet, katilma}. Davet ve üye anahtarlarının
// kendisi değil SHA-256 özeti saklanır; davet linki yenilenince eskisi geçersiz olur.
import { json, hata, ozet, govdeOku, rastgele, kirp, type Depo } from "./ortak.ts";

const EN_COK_UYE = 60, EN_COK_GECE = 200;
const kidGecerli = (v: unknown) => typeof v === "string" && /^[a-z0-9]{10}$/.test(v);
const uidGecerli = (v: unknown) => typeof v === "string" && /^[a-z0-9]{8}$/.test(v);

async function uyeler(depo: Depo, kid: string) {
  const { blobs } = await depo.list({ prefix: `${kid}/u/` });
  return (await Promise.all(blobs.map((b) => depo.get(b.key, { type: "json" })))).filter(Boolean);
}

// Üye doğrulaması: uid + gizli anahtar
async function uyeDogrula(depo: Depo, kid: string, uid: unknown, anahtar: unknown) {
  if (!uidGecerli(uid) || typeof anahtar !== "string") return null;
  const u = await depo.get(`${kid}/u/${uid}`, { type: "json" });
  return u && u.anahtarOzet === (await ozet(anahtar)) ? u : null;
}
const yetkili = (u: any) => u && (u.rol === "kurucu" || u.rol === "yonetici");

export async function isle(req: Request, depo: Depo, geceDepo?: Depo): Promise<Response> {
  try {
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams;
      const kid = q.get("kid");
      if (!kidGecerli(kid)) return hata("Geçersiz kulüp bağlantısı");
      const meta = await depo.get(`${kid}/meta`, { type: "json" });
      if (!meta) return hata("Bu kulüp bulunamadı ya da kapatılmış", 404);
      const ben = await uyeDogrula(depo, kid!, q.get("uid"), q.get("anahtar"));
      if (!ben) {
        // Üye değil: yalnızca geçerli davet linkiyle, katılma ekranı için kulüp adı ve üye sayısı
        const davet = q.get("davet");
        if (!davet || (await ozet(davet)) !== meta.davetOzet) return hata("Bu kulübe yalnızca davetle girilebilir", 403);
        const { blobs } = await depo.list({ prefix: `${kid}/u/` });
        return json({ onizleme: true, ad: meta.ad, aciklama: meta.aciklama, uyeSayisi: blobs.length });
      }
      const liste = await uyeler(depo, kid!);
      return json({
        kid, ad: meta.ad, aciklama: meta.aciklama, olusturma: meta.olusturma, geceler: meta.geceler || [],
        ben: { uid: ben.uid, ad: ben.ad, rol: ben.rol },
        // Üyeler birbirini görür (topluluğun anlamı); kimsenin anahtarı gönderilmez
        uyeler: liste.map((u: any) => ({ uid: u.uid, ad: u.ad, rol: u.rol, katilma: u.katilma }))
          .sort((a: any, b: any) => (a.katilma || "").localeCompare(b.katilma || "")),
      });
    }
    if (req.method !== "POST") return hata("Desteklenmeyen istek", 405);
    const g = await govdeOku(req, 20_000);

    if (g.islem === "olustur") {
      const ad = kirp(g.ad, 60), benAd = kirp(g.benAd, 30);
      if (!ad) return hata("Kulübün bir adı olmalı");
      if (!benAd) return hata("Bir takma ad yazmalısın");
      const kid = rastgele(10), davet = rastgele(12), uid = rastgele(8), anahtar = rastgele(20);
      const simdi = new Date().toISOString();
      await depo.setJSON(`${kid}/meta`, { ad, aciklama: kirp(g.aciklama, 500), davetOzet: await ozet(davet), geceler: [], olusturma: simdi });
      await depo.setJSON(`${kid}/u/${uid}`, { uid, ad: benAd, rol: "kurucu", anahtarOzet: await ozet(anahtar), katilma: simdi });
      return json({ kid, davet, uid, anahtar });
    }

    if (!kidGecerli(g.kid)) return hata("Geçersiz kulüp bağlantısı");
    const meta = await depo.get(`${g.kid}/meta`, { type: "json" });
    if (!meta) return hata("Bu kulüp bulunamadı ya da kapatılmış", 404);

    if (g.islem === "katil") {
      if (typeof g.davet !== "string" || (await ozet(g.davet)) !== meta.davetOzet) return hata("Davet linki geçersiz ya da yenilenmiş; kulüpten yeni link iste", 403);
      const ad = kirp(g.ad, 30);
      if (!ad) return hata("Bir takma ad yazmalısın");
      const liste = await uyeler(depo, g.kid);
      if (liste.length >= EN_COK_UYE) return hata("Kulübün üye sınırı doldu");
      if (liste.some((u: any) => u.ad.toLocaleLowerCase("tr") === ad.toLocaleLowerCase("tr"))) return hata("Bu takma ad kulüpte kullanılıyor; başka bir ad seç");
      const uid = rastgele(8), anahtar = rastgele(20);
      await depo.setJSON(`${g.kid}/u/${uid}`, { uid, ad, rol: "uye", anahtarOzet: await ozet(anahtar), katilma: new Date().toISOString() });
      return json({ uid, anahtar });
    }

    const ben = await uyeDogrula(depo, g.kid, g.uid, g.anahtar);
    if (!ben) return hata("Bu işlem için kulüp üyesi olmalısın", 403);

    if (g.islem === "gece-ekle") {
      if (typeof g.gid !== "string" || !/^[a-z0-9]{10}$/.test(g.gid)) return hata("Geçersiz gece");
      if (geceDepo && !(await geceDepo.get(`${g.gid}/meta`, { type: "json" }))) return hata("Gece bulunamadı", 404);
      meta.geceler = (meta.geceler || []).filter((x: any) => x.gid !== g.gid);
      meta.geceler.unshift({ gid: g.gid, ekleyen: ben.uid, t: new Date().toISOString() });
      meta.geceler = meta.geceler.slice(0, EN_COK_GECE);
      await depo.setJSON(`${g.kid}/meta`, meta);
      return json({ tamam: true });
    }

    if (g.islem === "ayril") {
      if (ben.rol === "kurucu") {
        const digerYonetici = (await uyeler(depo, g.kid)).find((u: any) => u.uid !== ben.uid && u.rol === "yonetici");
        if (!digerYonetici) return hata("Kurucu, başka bir yönetici yoksa kulüpten ayrılamaz; önce birini yönetici yap ya da kulübü kapat");
        digerYonetici.rol = "kurucu";
        await depo.setJSON(`${g.kid}/u/${digerYonetici.uid}`, digerYonetici);
      }
      await depo.delete(`${g.kid}/u/${ben.uid}`);
      return json({ tamam: true });
    }

    if (g.islem === "yonet") {
      if (!yetkili(ben)) return hata("Bu işlem yalnızca kulüp yöneticilerine açık", 403);
      const e = g.eylem;
      if (e === "guncelle") {
        const ad = kirp(g.ad, 60);
        if (!ad) return hata("Kulübün bir adı olmalı");
        meta.ad = ad; meta.aciklama = kirp(g.aciklama, 500);
        await depo.setJSON(`${g.kid}/meta`, meta);
        return json({ tamam: true });
      }
      if (e === "davet-yenile") {
        const davet = rastgele(12);
        meta.davetOzet = await ozet(davet);
        await depo.setJSON(`${g.kid}/meta`, meta);
        return json({ davet });
      }
      if (e === "gece-cikar") {
        meta.geceler = (meta.geceler || []).filter((x: any) => x.gid !== g.gid);
        await depo.setJSON(`${g.kid}/meta`, meta);
        return json({ tamam: true });
      }
      if (e === "sil") {
        if (ben.rol !== "kurucu") return hata("Kulübü yalnızca kurucu kapatabilir", 403);
        const { blobs } = await depo.list({ prefix: `${g.kid}/` });
        await Promise.all(blobs.map((b) => depo.delete(b.key)));
        return json({ tamam: true });
      }
      if (["uye-cikar", "yonetici-yap", "yoneticilik-al"].includes(e)) {
        if (!uidGecerli(g.hedef)) return hata("Geçersiz üye");
        const h = await depo.get(`${g.kid}/u/${g.hedef}`, { type: "json" });
        if (!h) return hata("Üye bulunamadı", 404);
        if (h.rol === "kurucu") return hata("Kurucu üzerinde bu işlem yapılamaz", 403);
        if (e === "uye-cikar") await depo.delete(`${g.kid}/u/${h.uid}`);
        else { h.rol = e === "yonetici-yap" ? "yonetici" : "uye"; await depo.setJSON(`${g.kid}/u/${h.uid}`, h); }
        return json({ tamam: true });
      }
      return hata("Bilinmeyen işlem");
    }
    return hata("Bilinmeyen işlem");
  } catch (err) {
    return hata(err instanceof SyntaxError ? "Geçersiz veri" : "Sunucu hatası", err instanceof SyntaxError ? 400 : 500);
  }
}
