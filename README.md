# viski-atlas

Viski Atlası — bölge → damıtımevi → şişe rehberi (statik PWA, Netlify'da yayında).

## Fiyat güncelleme politikası

Fiyatlar **otomatik** güncellenir; API anahtarı ya da elle müdahale gerekmez.

- **Ne zaman / kim:** Her pazartesi sabah claude.ai hesabındaki zamanlanmış bir Claude görevi
  (Routine) çalışır. Ek ücret yoktur, Claude aboneliğinin kullanım kotasından düşer.
- **Nasıl:** `node scripts/fiyat-guncelle.mjs sec 40` en uzun süredir doğrulanmamış 40 şişeyi
  seçer (bulunabilirliği yüksek ve puanı yüksek olanlar önce). Claude bunların Türkiye'deki güncel
  70 cl fiyatını web aramasıyla bulur, `node scripts/fiyat-guncelle.mjs uygula <dosya>` ile kaydeder.
  Bütün katalog yaklaşık 6 ayda bir baştan doğrulanır. Döviz kuru TCMB'den alınır.
- **Kaynak önceliği:** Türkiye mağaza fiyatı → ithalatçı/zam listesi → Türkiye duty-free →
  (hiçbiri yoksa) yurtdışı fiyatından Türkiye vergi yapısıyla tahmin.
- **Güvenlik kuralları:** Fiyatı %40'tan fazla düşüren ya da %80'den fazla artıran öneriler,
  güncel ve kaynaklı bir Türkiye fiyatı değilse uygulanmaz; `data/fiyatlar.json` içindeki
  `inceleme` listesine yazılır. Son 6 ayda gerçek kaynaktan doğrulanmış bir fiyat tahminle ezilmez.
- **Sonuç:** `data/fiyatlar.json` güncellenip `main`'e commit'lenir; Netlify repoya bağlıysa
  otomatik yayına alır. Sayfa açılışta bu dosyayı okur, fiyatın üstüne gelince kaynağı ve tarihi
  görünür. Kullanıcının kendi girdiği fiyat her zaman önceliklidir.

- **Fiyat geçmişi ve bulunabilirlik:** Her farklı doğrulanmış fiyat tarihiyle saklanır (son 24 kayıt);
  sitede "Listeler → Fiyat Hareketleri" sekmesi ve şişe detay kartındaki grafik bunu gösterir.
  Görev, kanıt bulduğunda şişenin Türkiye'de nerede satıldığını (`bul`) da günceller; düşük güvenli
  bulgular bulunabilirliği değiştirmez.
- **Düşük güven:** "dusuk" güvenli bir fiyat kayıtlı fiyattan %15'ten fazla farklıysa uygulanmaz.
  Araştırılıp bulunamayan şişeler `denendi` olarak işaretlenir; böylece sıra kataloğun geri kalanına geçer.

## Şişe görselleri

Şişe görselleri yalnızca **üreticilerin resmî sitelerinden** alınır, küçük bir kopya olarak
(en fazla 120×160 px WebP) `img/sise/` klasörüne kaydedilir ve her görselin altında sahibi ile
resmî sayfanın linki gösterilir. Kayıtlar `data/gorseller.json` içindedir; resmî görseli bulunamayan
şişeler `yok` olarak işaretlenir ve renkli şişe simgesiyle gösterilmeye devam eder.
Whiskybase, mağaza veya fotoğrafçı görselleri kullanılmaz. Bir hak sahibi itiraz ederse
`node scripts/gorsel.mjs sil <id>` ile görsel kaldırılır.

## İçerik önerileri

Puanlar (`puan`, uzman listeleri) özenle seçilmiş içerik olduğu için otomatik değiştirilmez.
Her yıl 15 Ocak ve 15 Temmuz'da ayrı bir Claude görevi yeni ödülleri, yeni çıkan ve üretimi biten
şişeleri araştırıp `oneriler/YYYY-MM.md` dosyasına **öneri** olarak yazar. Uygulamak için Claude'a
"oneriler/YYYY-MM.md dosyasındaki önerileri uygula" demek yeterlidir.
