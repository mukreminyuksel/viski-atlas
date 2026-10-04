# Viski Atlası & Bira Atlası — Öneriler ve Yol Haritası

Bu dosya iki sitenin ortak fikir defteridir. Kopyası iki depoda da `docs/ONERILER.md` olarak durur.
Durum: 💡 fikir · 📌 sırada · 🔨 yapılıyor · ✅ bitti · ❌ vazgeçildi
Son güncelleme: 4 Ekim 2026

## Önerilen sıra

| # | Öneri | Etki | Emek | Durum |
|---|---|---|---|---|
| 1 | 📷 Raf Asistanı (etiket/barkod tanıma) | Çok yüksek: her alışverişte kullanılır | Orta-büyük | 💡 |
| 2 | 🎭 Kör Tadım Şovu (canlı yarışma modu) | Çok yüksek: sosyal, yayılır | Orta | 💡 |
| 3 | 📊 Yılın Özeti (Wrapped tarzı) | Yüksek: paylaşılır; aralık ayına yetişmeli | Küçük-orta | 💡 |
| 4 | 🔀 Netlify'daki eski adresi yeni adrese yönlendirme | Orta | Küçük (kredi yenilenince) | 📌 |
| 5 | 📜 Resmî lisans listesinin periyodik güncellemesi | Orta | Küçük (listeyi kullanıcı indirir) | 📌 |
| 6 | 🏬 İstanbul viski butiklerini Nereden Alınır'a ekleme | Orta | Küçük | 📌 |

---

## 1. 📷 Raf Asistanı: "Markette telefonu şişeye tut"
- **Akış:** 📷 düğmesi → kamera etikete ya da barkoda tutulur → yazı telefonda okunur (Tesseract.js; API anahtarı ve ücret yok) → katalogda bulunur.
- **Gösterilen kart:**
  - Puan ve kısa tadım notu.
  - **Fiyat kontrolü:** raftaki fiyat yazılır, site Türkiye referans fiyatına göre "pahalı / iyi fiyat" der.
  - **Damak uyumu:** "tat profiline %84 uyuyor".
  - **Akıllı alternatif:** "aynı paraya, aynı markette bulunan X sana daha çok uyar".
  - Tek dokunuşla Denedim / Deneyeceğim.
- **Kendi kendine öğrenen barkod veritabanı:** Kullanıcı şişeyi etiketten doğruladığında barkod ortak depoya (Cloudflare KV) kaydedilir. Sonraki kullanıcılar barkoddan anında bulur. Türkiye'de benzeri yok.
- **Sınırlar:**
  - Süslü etiketlerde tanıma şaşabilir; o zaman en yakın 3 aday ya da arama kutusu gösterilir.
  - Barkod veritabanı boş başlar ve kullanıldıkça dolar.
  - Raf fiyatı elle yazılır.
- İki sitede ortak çalışır.

## 2. 🎭 Kör Tadım Şovu
- Mevcut tadım gecesi altyapısının üzerine kurulur (telefon + PIN, KV deposu).
- **Akış:**
  - Ev sahibi 4–6 şişe seçer; şişeler "Bardak A, B, C…" diye gizlenir.
  - TV ya da laptop "sahne ekranı" olur ve QR gösterir.
  - Misafirler telefonla katılır, uygulama ya da üyelik gerekmez.
  - Her bardak için puan (0–100), tat notları ve tahmin verilir (bölge, yaş; birada stil).
  - Sahne ekranında canlı ilerleme görünür: "8 kişiden 6'sı oy verdi".
  - 🥁 "Perdeyi aç": şişeler tek tek açıklanır; ortalama puan, en çok seçilen notlar ve doğru tahmin edenler gösterilir.
- **Gece sonu:**
  - 🏆 En keskin burun
  - 💸 Fiyat/lezzet sürprizi
  - 👯 Tat ikizleri
  - Paylaşılabilir gece kartı (story boyutunda)
- Kulüpler için sezonluk "en keskin burun" sıralaması.

## 3. 📊 Yılın Özeti (Wrapped tarzı)
- Aralıkta kaydırmalı bir hikâye:
  - "Bu yıl 37 şişe denedin, en çok Islay."
  - Gurme seviyesindeki ilerleme, en sevilen tat profili.
  - "Seninle aynı damakta bir ünlü/karakter".
- Paylaşılabilir görsel. Veriler zaten sitede; yeni veri toplanmaz.

## 4. Diğer bekleyenler
- **Netlify yönlendirmesi:** Kredi yenilenince viski-atlas.netlify.app → viski-atlas.pages.dev (/api hariç; taşıma kodu eski /api'yi kullanıyor).
- **Resmî lisans listesi:** pdtadb.tarimorman.gov.tr/webUibList.aspx yurt dışından açılmıyor. Birkaç ayda bir kullanıcı indirip gönderir, data/lisans.json güncellenir.
- **İstanbul viski butikleri** (La Cave, Dekante vb.) doğrulanıp Nereden Alınır'a eklenecek.
- **Tom Tom Mayer:** hangi eser olduğu netleşince kurgu karakterlerine eklenecek.

## Otomatik görevler (Claude Routines)
- Viski aylık fiyat: her ayın 1'i
- Bira aylık fiyat: her ayın 2'si
- Viski aylık görseller: her ayın 3'ü
- Bira aylık görseller: her ayın 4'ü
- Üretici bağlantıları (iki site): her ayın 5'i
- Altı ayda bir öneri raporu

## Bitenler (özet)
- Cloudflare'a taşıma, eski kayıtların otomatik taşınması
- Kurgu karakterleri (110/113), oyun karakterleri, Süper Zenginler
- Topluluk ve Nereden Alınır sekmeleri
- Üretici bağlantıları
- Resmî lisans listesi
- Gizli kod/PIN için göz düğmesi
- Favicon
