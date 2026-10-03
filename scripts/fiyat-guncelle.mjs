// Viski Atlası — otomatik fiyat güncelleyici
// GitHub Actions tarafından haftalık çalıştırılır (.github/workflows/fiyat-guncelle.yml).
// index.html içindeki DATA listesini okur, en eski doğrulanan şişelerden bir grup seçer,
// Claude'a web araması yaptırarak Türkiye fiyatını buldurur, güvenlik kontrollerinden
// geçen sonuçları data/fiyatlar.json dosyasına yazar. Sayfa bu dosyayı açılışta okur.
//
// Ortam değişkenleri:
//   ANTHROPIC_API_KEY  (zorunlu, DRY_RUN hariç)
//   MODEL              varsayılan claude-opus-5-5
//   GRUP_SAYISI        bir çalışmada kaç Claude çağrısı (varsayılan 6)
//   GRUP_BOYU          çağrı başına şişe (varsayılan 8)
//   DRY_RUN=dosya.json Claude yerine bu dosyadaki cevabı kullan (test için)

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "index.html");
const OUT = path.join(ROOT, "data", "fiyatlar.json");

const MODEL = process.env.MODEL || "claude-opus-5-5";
const GRUP_SAYISI = +(process.env.GRUP_SAYISI || 6);
const GRUP_BOYU = +(process.env.GRUP_BOYU || 8);
const DRY_RUN = process.env.DRY_RUN || "";
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
  catch { return { guncelleme: null, kur: null, fiyatlar: {}, inceleme: [] }; }
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
function sec(data, fiyatlar, adet) {
  return [...data]
    .sort((a, b) => {
      const ta = fiyatlar[a.id]?.tarih || "0000", tb = fiyatlar[b.id]?.tarih || "0000";
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

// ---- Claude ----
const SISTEM = `Sen Türkiye viski piyasası için fiyat araştırmacısısın. Görevin, verilen her şişenin
Türkiye'deki GÜNCEL perakende fiyatını (70 cl, TL) web aramasıyla bulmak.

Kaynak önceliği ve "tur" değerleri:
1. "tr_raf"   — Türkiye'deki bir mağaza/zincir/tekel sitesinde görünen güncel fiyat.
2. "tr_liste" — İthalatçı fiyat listesi veya zam sonrası yayımlanan marka marka fiyat listesi haberleri.
3. "dutyfree" — Türkiye havalimanı duty-free fiyatı (euro ise verilen kurla TL'ye çevir).
4. "tahmin"   — Türkiye'de fiyat bulunamazsa: Avrupa/İngiltere perakende fiyatını verilen kurla
                çevir ve Türkiye vergi yapısını (ÖTV büyük ölçüde hacim ve alkol oranına bağlı sabit
                tutardır, üstüne ithalat/perakende marjı ve %20 KDV) hesaba katarak gerçekçi bir raf
                fiyatı tahmin et. Varsa kalibrasyon fiyatlarını referans al.

Kurallar:
- 70 cl dışındaki şişe boyutlarını (50, 75, 100 cl) 70 cl'ye orantıla.
- Kaynak tarihi 12 aydan eskiyse kullanma ya da "tahmin" olarak işaretle.
- Şişe artık üretilmiyorsa ikinci el/müzayede fiyatını "tahmin" olarak ver ve "not" alanına yaz.
- Emin olamadığın fiyatı uydurma; "guven" alanını dürüst doldur ("yuksek" yalnızca güncel ve
  doğrudan bu şişeye ait bir Türkiye kaynağı varsa).
- Yanıtının EN SONUNDA, başka hiçbir şey eklemeden, tek bir \`\`\`json kod bloğu ver:
{"sonuclar":[{"id":"...","tl":12345,"tur":"tr_raf|tr_liste|dutyfree|tahmin","kaynak":"https://... veya boş","guven":"yuksek|orta|dusuk","not":"kısa açıklama"}]}
Her şişe için bir kayıt olsun; hiç fiyat bulamadığın şişede "tl": null ver.`;

function istem(grup, kur, capa) {
  const satirlar = grup.map((b) =>
    `- id: ${b.id} | ${b.ad} | ${b.dam} | ${b.tur} | ${b.yas === "NAS" ? "yaşsız" : b.yas + " yaş"} | %${b.abv} | şu anki kayıtlı fiyat: ${b.tl || "yok"} TL`
  );
  return [
    `Bugün: ${BUGUN}.`,
    kur ? `TCMB döviz satış kuru: 1 USD = ${kur.usd} TL, 1 EUR = ${kur.eur} TL${kur.gbp ? `, 1 GBP = ${kur.gbp} TL` : ""}.` : "",
    capa.length ? `Kalibrasyon — yakın zamanda Türkiye'de doğrulanmış fiyatlar:\n${capa.join("\n")}` : "",
    `Fiyatını bulacağın şişeler:\n${satirlar.join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

let client = null;
async function claudeSor(grup, kur, capa) {
  if (DRY_RUN) return fs.readFileSync(DRY_RUN, "utf8");
  if (!client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic();
  }
  const messages = [{ role: "user", content: istem(grup, kur, capa) }];
  for (let tur = 0; tur < 6; tur++) {
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SISTEM,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12, user_location: { type: "approximate", country: "TR" } }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    });
    if (r.stop_reason === "refusal") throw new Error("model yanıtı reddetti");
    if (r.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: r.content }); continue; }
    return r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  throw new Error("arama turu sınırı aşıldı");
}

function jsonCikar(metin) {
  const bloklar = [...metin.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!bloklar.length) throw new Error("yanıtta JSON bloğu yok");
  return JSON.parse(bloklar[bloklar.length - 1][1]).sonuclar || [];
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
  // Son 6 ayda gerçek kaynaktan doğrulanmış fiyatı tahminle ezme
  if (s.tur === "tahmin" && eski && eski.tur !== "tahmin") {
    const yas = (Date.now() - Date.parse(eski.tarih)) / 864e5;
    if (yas < 180) return "doğrulanmış fiyat tahminle ezilmez";
  }
  return null;
}

// ---- Ana akış ----
async function main() {
  const data = dataOku();
  const db = jsonOku();
  const ids = new Set(data.map((b) => b.id));
  const kur = (await kurOku()) || db.kur;
  if (kur) db.kur = kur;

  const secilen = sec(data, db.fiyatlar, GRUP_SAYISI * GRUP_BOYU);
  const capa = capalar(data, db.fiyatlar);
  let kabul = 0, red = 0, hata = 0;
  db.inceleme = [];

  for (let i = 0; i < secilen.length; i += GRUP_BOYU) {
    const grup = secilen.slice(i, i + GRUP_BOYU);
    let sonuclar;
    try { sonuclar = jsonCikar(await claudeSor(grup, kur, capa)); }
    catch (e) { console.warn(`Grup ${i / GRUP_BOYU + 1} atlandı: ${e.message}`); hata++; continue; }

    for (const s of sonuclar) {
      const b = grup.find((x) => x.id === s.id);
      if (!b || !ids.has(s.id) || s.tl == null) continue;
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
  }

  db.guncelleme = BUGUN;
  db.fiyatlar = Object.fromEntries(Object.entries(db.fiyatlar).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(db, null, 1) + "\n");
  const dogrulanan = Object.keys(db.fiyatlar).length;
  console.log(`Kabul: ${kabul} · Reddedilen: ${red} · Hatalı grup: ${hata} · Toplam güncel kayıt: ${dogrulanan}/${data.length}`);
  if (hata && !kabul) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
