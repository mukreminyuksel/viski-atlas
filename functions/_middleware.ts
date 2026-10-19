// tadimatlasi.com (çıplak alan adı ve www) bu projeye bağlıyken ana sayfa olarak
// dört siteye giden giriş sayfasını (giris/index.html) gösterir. Diğer adresler
// (viski.tadimatlasi.com, viski-atlas.pages.dev) ve /api uç noktaları etkilenmez.
const GIRIS_ALANLARI = new Set(["tadimatlasi.com", "www.tadimatlasi.com"]);

export const onRequest = async (ctx: any) => {
  const url = new URL(ctx.request.url);
  if (GIRIS_ALANLARI.has(url.hostname)) {
    if (url.hostname.startsWith("www.")) {
      url.hostname = "tadimatlasi.com";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let res = await ctx.env.ASSETS.fetch(new Request(new URL("/giris/", url), ctx.request));
      // Pages "/giris" ↔ "/giris/" arasında yönlendirme döndürürse hedefi doğrudan getir
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        res = await ctx.env.ASSETS.fetch(new Request(new URL(res.headers.get("location")!, url), ctx.request));
      }
      return res;
    }
  }
  return ctx.next();
};
