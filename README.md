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

## Bulut senkronu ve Tadım Geceleri

Site statik, ama küçük sunucu fonksiyonları var. Çekirdek mantık platformdan bağımsızdır (`api/*.ts`);
iki ince katman aynı kodu çalıştırır: **Cloudflare Pages** (`functions/api/*.ts`, veri Workers KV'de,
bağlama adı `VERI`) ve **Netlify** (`netlify/functions/*.mts`, veri Netlify Blobs'ta):

- **`/api/sync` — bulut senkronu:** Giriş yok. "Listem → Bulutta saklamaya başla" ile viski temalı
  bir kod üretilir (ör. `kehribar-islay-kadeh-427`); liste her değişiklikte bu kodla kaydedilir.
  Başka cihazda kodu girmek, `#bulut=<kod>` linkini açmak ya da QR'ı okutmak yeterli. İki cihazdaki
  listeler kayıpsız birleştirilir. Depoda kodun kendisi değil SHA-256 özeti anahtar olarak durur.
  Kodu kaybetmemek için: kullanılan cihazda her zaman görünür, "Kendine gönder" ve QR seçenekleri var.
  **Telefon + PIN:** Kod yerine telefon numarası ve kişinin seçtiği 4-6 haneli PIN ile de girilir
  (ilk girişte liste otomatik oluşur). Numara ve PIN düz metin saklanmaz (`tel/<özet>` kaydı koda
  işaret eder); 10 hatalı PIN denemesinde numara 1 saat kilitlenir. PIN unutulursa kodu bilen cihazdan
  yeni PIN konur; başka listeye bağlı bir numarayı taşımak için o listenin PIN'i gerekir.
  **Tek giriş:** Bulut kaydı listeyle birlikte kulüp üyeliklerini (uid + anahtar) ve tadım gecelerini
  (ev sahibi yetkisi dahil) da taşır (`state.sosyal`). Kod ya da telefon + PIN ile giren her cihaz
  hepsini alır; silinen kulüp/geceler `sil` listesiyle işaretlenir, başka cihazdan geri gelmez.
  Giriş kutusu Sosyal Buluşmalar sayfalarında da var.
- **`/api/gece` — Tadım Geceleri:** Sosyal Buluşmalar → Tadım Geceleri. Ev sahibi şişeleri seçip geceyi
  oluşturur, davet linkini paylaşır; katılımcılar yalnızca takma adla katılıp 50–100 arası puan ve not
  verir. Kör tadımda şişe adları ev sahibi açıklayana kadar gizlidir. Sonuç tablosu, gecenin
  birincisi, en çok ayrışan şişe ve "damak ikizleri" otomatik hesaplanır. Ev sahibi linki (`&yk=`)
  ile gece başka cihazdan yönetilebilir.
  - **Gizlilik:** Sunucu, katılımcılara yalnızca ortalamaları/özet istatistikleri ve kişinin kendi
    puanlarını gönderir. Tek tek puan ve notları yalnızca ev sahibi görür; katılımcı kimlikleri (pid)
    başkalarına gönderilmez.
  - **LCV:** Davetliler "Geliyorum / Belki / Gelemiyorum" yanıtı verir; liste gece sayfasında görünür.
- **`/api/kulup` — Kulüp (Sosyal Buluşmalar → Kulüplerim):** Davetle girilen kapalı topluluk. Kurucu kulübü açar, davet linkini
  (`#kulup=<kid>.<davet>`) paylaşır; üyeler takma adla katılır ve üye başına gizli anahtar cihazda
  saklanır. Kulübe bağlı geceler, "kulübün hafızası" (en çok tadılanlar, favoriler) ve üye listesi
  yalnızca üyelere açıktır. Yöneticiler üye çıkarabilir, yönetici atayabilir, davet linkini
  yenileyebilir (eskisi geçersiz olur); kulübü yalnızca kurucu kapatabilir. Davet ve anahtarların
  kendisi değil SHA-256 özetleri saklanır.

## Şişe görselleri

Şişe görselleri önce **üreticinin resmî sitesinden**, bulunamazsa tanınmış bir içki mağazasının
ürün fotoğrafından (şu an Flaviar) alınır. Küçük bir kopya olarak (en fazla 120×160 px WebP)
`img/sise/` klasörüne kaydedilir; her görselin altında kaynağı ve kaynak sayfanın linki gösterilir.
Kayıtlar `data/gorseller.json` içindedir; görseli bulunamayan şişeler `yok` olarak işaretlenir ve
renkli şişe simgesiyle gösterilmeye devam eder. Farklı yaş/sürüm şişesinin görseli kullanılmaz.
Bir hak sahibi itiraz ederse `node scripts/gorsel.mjs sil <id>` ile görsel kaldırılır.

## İçerik önerileri

Puanlar (`puan`, uzman listeleri) özenle seçilmiş içerik olduğu için otomatik değiştirilmez.
Her yıl 15 Ocak ve 15 Temmuz'da ayrı bir Claude görevi yeni ödülleri, yeni çıkan ve üretimi biten
şişeleri araştırıp `oneriler/YYYY-MM.md` dosyasına **öneri** olarak yazar. Uygulamak için Claude'a
"oneriler/YYYY-MM.md dosyasındaki önerileri uygula" demek yeterlidir.
