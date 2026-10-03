# viski-atlas

Viski Atlası — bölge → damıtımevi → şişe rehberi (statik PWA, Netlify'da yayında).

## Fiyat güncelleme politikası

Fiyatlar **otomatik** güncellenir; elle müdahale gerekmez.

- **Ne zaman:** Her pazartesi sabah GitHub Actions (`.github/workflows/fiyat-guncelle.yml`) çalışır.
  Actions sekmesinden "Run workflow" ile elle de tetiklenebilir.
- **Nasıl:** `scripts/fiyat-guncelle.mjs`, en uzun süredir doğrulanmamış ~48 şişeyi seçer ve
  Claude'a web araması yaptırarak Türkiye'deki güncel 70 cl fiyatını buldurur. Böylece bütün
  katalog yaklaşık 4–5 ayda bir baştan doğrulanır. Döviz kuru TCMB'den alınır.
- **Kaynak önceliği:** Türkiye mağaza fiyatı → ithalatçı/zam listesi → Türkiye duty-free →
  (hiçbiri yoksa) yurtdışı fiyatından vergi yapısıyla tahmin.
- **Güvenlik kuralları:** Fiyatı %40'tan fazla düşüren ya da %80'den fazla artıran öneriler,
  güncel ve kaynaklı bir Türkiye fiyatı değilse uygulanmaz; `data/fiyatlar.json` içindeki
  `inceleme` listesine yazılır. Son 6 ayda gerçek kaynaktan doğrulanmış bir fiyat tahminle ezilmez.
- **Sonuç:** `data/fiyatlar.json` güncellenir ve commit'lenir; Netlify otomatik yayına alır.
  Sayfa açılışta bu dosyayı okur, fiyatın üstüne gelince kaynağı ve tarihi görünür.
  Kullanıcının kendi girdiği fiyat her zaman önceliklidir.

### Kurulum (bir kez)

1. GitHub → Settings → Secrets and variables → Actions → `ANTHROPIC_API_KEY` ekle.
2. Netlify sitesi bu repoya bağlı olmalı (Site configuration → Build & deploy → Link repository),
   böylece her commit otomatik yayına çıkar.

İsteğe bağlı ayarlar (workflow `env`): `MODEL`, `GRUP_SAYISI` (çağrı sayısı, varsayılan 6),
`GRUP_BOYU` (çağrı başına şişe, varsayılan 8).

Puanlar (`puan`, uzman listeleri) özenle seçilmiş içerik olduğu için otomatik değiştirilmez.
