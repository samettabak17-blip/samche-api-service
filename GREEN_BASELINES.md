# SamChe GREEN Baseline Registry

Bu dosya SamChe platformunda tamamlanmış, test edilmiş ve GREEN kabul edilmiş
özelliklerin koruma kaydıdır.

Yeni ajanlar bu dosyayı okuyarak tamamlanmış alanları tekrar açmaz ve mevcut
çalışan davranışları korur.

### Genel Yeniden Açma ve Koruma Kuralı (Reopen Rule)
Bu kayıtta yer alan GREEN davranışlar sonraki hiçbir ajan tarafından kodla karşılaşıldı
diye yeniden açılamaz, yeniden tasarlanamaz, yeniden düzenlenemez (refactor) veya
"geliştirilemez".
Bir GREEN alanına yalnızca şu üç koşuldan biri varsa dokunulabilir:
A. Kullanıcının açıkça yeni bir gereksinim talep etmesi, VEYA
B. Gerçek bir regresyonun somut kanıtlarla gösterilmesi, VEYA
C. Sonraki bir yol haritası (roadmap) görevinin zorunlu olarak bu alanı kesmesi.
(Eğer C gerçekleşirse: mevcut davranış regresyon testleriyle korunmalı ve etkisi belgelenmelidir.)

---

## Platform Foundation

Durum: GREEN

Korunan:

- Multi tenant temel mimari
- Backend temel yapı
- Frontend temel yapı
- Database temel mimarisi
- Deployment altyapısı

## AI Assistants + Channels Core

Durum: GREEN

Korunan:

- AI Assistant mimarisi
- WhatsApp kanal altyapısı
- Instagram kanal altyapısı
- Web Chatbot kanal altyapısı
- AI Guide kanal altyapısı
- Tenant assistant izolasyonu

## CRM / Contacts

Durum: GREEN

Korunan:

- Contact modeli
- CRM bağlantıları
- Conversation-contact ilişkisi
- Tenant CRM izolasyonu

## Deals / Pipeline + Overview Metrics

Durum: GREEN

Korunan:

- Deal lifecycle
- Pipeline yapısı
- Overview metrics

## Knowledge Intelligence + Business Profile + Runtime Grounding

Durum: GREEN

Korunan:

- Knowledge ingestion
- Approval workflow
- APPROVED runtime kullanımı
- Business Profile
- Runtime grounding
- Evidence mantığı

## AI Guide White Label / Tenant Driven Experience

Durum: GREEN

Korunan:

- Tenant driven deneyim
- White label yapı
- Knowledge bağlantısı

## Web Chatbot + Universal Page / Entity Awareness

Durum: GREEN

Korunan:

- Page awareness
- Entity awareness
- Context aware chatbot

## Instagram Personal Assistant Persona & Identity

Durum: GREEN (Fiziksel Olarak Kabul Edildi — 2 Ayrı Gerçek Instagram Hesabı)
Kabul Edilen Uygulama Commiti: `8650cfb687a741614f6df5cb69d5a0f369f9d984`

Korunan Değişmezler:

- Yapılandırılan Samed kişisel Instagram asistanı için:
  - Asistan kendisini doğal bir şekilde Samed Bey'in kişisel asistanı olarak tanıtır ("Merhaba, ben Samed Bey'in kişisel asistanıyım." veya doğal dengi).
  - Samed Tabak'ın kendisi gibi davranmaz / taklit etmez (impersonation kesinlikle yasaktır).
  - Tanıtım konuşma başlangıcında doğal olarak yapılır; her mesajda mekanik biçimde tekrarlanmaz.
  - Persona ve karşılama davranışı konfigürasyon odaklıdır (configuration-driven).
  - Genel Instagram çalışma zamanı (generic runtime) tüm tenant'lar için yeniden kullanılabilir kalır; bu kimlik diğer tenant'lara global olarak zorlanamaz.

Fiziksel Kabul Kanıtı:
- İki (2) ayrı gerçek Instagram hesabı ile uçtan uca test edilmiş ve kullanıcı tarafından fiziksel olarak GREEN kabul edilmiştir.

Regresyon / Yeniden Açma Kuralı:
- Kullanıcı yeni bir gereksinim talep etmedikçe veya kanıtlı regresyon olmadıkça yeniden açılamaz veya refactor edilemez.

## Instagram Appointment Qualification & Safe Date/Time Handling

Durum: GREEN (Fiziksel Olarak Kabul Edildi — 2 Ayrı Gerçek Instagram Hesabı)
Kabul Edilen Uygulama Commiti: `8650cfb687a741614f6df5cb69d5a0f369f9d984`

Korunan Değişmezler:

- Görüşme ve randevu talepleri nitelikli alım (qualified intake) sürecini izler.
- Randevu planlama girişiminden önce görüşme amacı (meeting purpose) anlaşılır.
- Daha önce belirtilmiş amaç hafızada tutulur ve tekrar sorulmaz.
- İlgili eksik nitelik bilgileri toplanır; gereksiz ve mükerrer soru sorulmaz.
- Henüz bilinmiyorsa toplanması gereken zorunlu alım alanları:
  - İsim (name)
  - Telefon (phone)
  - E-posta (email)
  - Görüşme amacı (meeting purpose)
  - İlgili nitelik bağlamı (relevant qualification context)
  - Tercih edilen tarih (preferred date)
  - Tercih edilen saat (preferred time)
- Çok turlu alan hafızası (multi-turn field memory) kesintisiz çalışır.
- Tarih/saat güvenliği: Yalnızca müşterinin açık güncel tercihi VEYA doğrulanmış takvim uygunluğu tarih/saat iddialarına kaynak oluşturabilir.
- Müşterinin "14 gibi" ifadesi yaklaşık 14:00 anlamına gelir; onaylanmış saat 14:00 randevusu anlamına gelmez.
- Bilinmeyen zaman/tarih kesinlikle bilinmiyor olarak korunur.
- Uydurma takvim uygunluğu ("bugün 18:00"), sahte randevu onayı veya sahte "takvim kontrol edildi" ifadesi kesinlikle yasaktır.
- Son talep özetlenir ve müşteriye bilgilerin Samed Bey'e iletileceği bildirilir.
- Onaylanan ifade anlamı: "Bilgilerinizi Samed Bey'e ileteceğim. Kendisi sizinle görüşmek üzere iletişime geçecek."
- Sessiz dahili nitelikli potansiyel müşteri iletimi (silent internal qualified-lead forwarding) mevcut mimariyle tam uyumlu çalışır.
- Dahili iletim mekanikleri müşteriye kesinlikle ifşa edilmez.

Fiziksel Kabul Kanıtı:
- İki (2) ayrı gerçek Instagram hesabı üzerinden beklenen davranış doğrulanarak kullanıcı tarafından fiziksel olarak GREEN kabul edilmiştir.

Regresyon / Yeniden Açma Kuralı:
- Kullanıcı yeni bir gereksinim talep etmedikçe veya kanıtlı regresyon olmadıkça yeniden açılamaz veya refactor edilemez.

## Instagram Scoped YouTube Guidance

Durum: GREEN (Fiziksel Olarak Kabul Edildi — 2 Ayrı Gerçek Instagram Hesabı)
Kabul Edilen Uygulama Commiti: `8650cfb687a741614f6df5cb69d5a0f369f9d984`
Onaylı YouTube URL: `https://ytbe.app/u9j8qB2S`

Korunan Değişmezler:

- YouTube yönlendirmesi YALNIZCA anlamsal olarak Dubai/BAE yaşam konularıyla ilgili içeriklerde geçerlidir:
  - Yaşam koşulları
  - Yaşam maliyeti / hayat pahalılığı
  - Yaşam giderleri
  - Kira / konut maliyetleri
  - Yaşam maliyeti bağlamındaki maaş ve gelirler
  - Aile / aylık yaşam bütçesi
  - Eşdeğer anlamsal yaşam maliyeti ve yaşam tarzı soruları
- Genel bir mesaj altlığı (generic footer) gibi davranamaz.
- Konuşmada yalnızca "Dubai" geçtiği için eklenemez.
- Kesinlikle YouTube bağlantısı tetiklememesi gereken durumlar:
  - Yalnızca şirket kuruluşu
  - Yalnızca oturum izni / residency
  - Yalnızca vize
  - Vergi / finans
  - Randevu talepleri
  - Selamlaşma / açılış
  - İlgisiz genel ticari sorular
- Uygulandığında:
  - Önce müşterinin sorusu doğrudan yanıtlanır.
  - Doğal bağlamsal bir YouTube cümlesi kurulur.
  - Onaylanmış ham URL tek bir kez verilir (`https://ytbe.app/u9j8qB2S`).
  - İsteğe bağlı takip sorusu ayrı tutulur.
  - Eski YouTube URL'si kesinlikle yasaktır.
  - Mükerrer link eklenemez.
  - Markdown anchor formatı zorunlu değildir; URL taşıma boyunca bölünmeden atomik kalır.

Fiziksel Kabul Kanıtı:
- İki (2) ayrı gerçek Instagram hesabı üzerinden canlı test edilmiş ve fiziksel olarak onaylanmıştır.

Regresyon / Yeniden Açma Kuralı:
- Kullanıcı yeni bir talep belirtmedikçe davranış değiştirilemez.

## Instagram AI Reply Reliability & Transport Chain

Durum: GREEN (Fiziksel Olarak Kabul Edildi — 2 Ayrı Gerçek Instagram Hesabı)
İlgili Kabul Edilmiş Commit Zinciri:
- `3e98109de9378068497d204b0c4332d4b2a8468e`
- `41755d41a04d624e017f08d8b8355534e7a32111`
- `5efc529692ce704c9c595b1772f41ec35f005339`
- `20365548609b118f824deea867ca0f6905d94e53`
- `cec15ffd4fc916ebd44b243022c5d7a2a8589347`
- `45a88fe9647b69db9e50a6e47c847d42d8d73ee9`
- `56a5fd68806aeda06cbe02b4b0b40235db14b871`
- `8650cfb687a741614f6df5cb69d5a0f369f9d984`

Korunan Değişmezler:

- Yeni Instagram konuşmaları varsayılan olarak `AI_ONLY` modunda başlar.
- Uygun mevcut konuşmalar varsayılan olarak `AI_ONLY` kalır.
- Message Request (Mesaj İstekleri) kutusuna gelen desteklenen mesajlar manuel "Kabul Et" gerektirmez.
- Webhook'a ulaşan desteklenen mesajlar native Instagram klasör yerleşimi nedeniyle engellenemez/baskılanamaz.
- Açıkça `NEVER_AI` durumuna alınan konuşmalar bu durumu kalıcı olarak korur.
- `NEVER_AI` altındayken manuel operatör müdahalesi sorunsuz çalışır.
- `NEVER_AI` -> `AI_ONLY` geçişi yapıldığında AI yanıt üretimi eksiksiz geri yüklenir.
- Kapatılmış geçmiş konuşmalar yeni canlı MID (Message ID) geldiğinde doğru şekilde yeniden açılır.
- Yeni meşru MID işleme alınır; aynı MID tekrarları (replay deduplication) engellenir.
- Bayat/takılmış orkestrasyon durumları sonraki turları kalıcı olarak bloke edemez.
- Yazıyor (typing) bildirimi hatası AI yanıt üretimini durduramaz.
- Giden mesaj taşıma (outbound transport) hatası asistan mesajının veritabanına kanonik olarak kaydedilmesini engelleyemez.
- Uzun yanıt paritesi: Noktalı para ve sayı tutarları korunur, Türkçe Unicode karakterler korunur, URL korunur, URL sonrası metin korunur, sessiz metin kesilmesi (silent truncation) engellenir.
- Çok turlu konuşma akışı (multi-turn) kesintisiz operasyonel kalır.

Fiziksel Kabul Kanıtı:
- İki (2) ayrı gerçek Instagram hesabı ile uçtan uca test edilmiş ve kullanıcı tarafından fiziksel olarak GREEN kabul edilmiştir.

Regresyon / Yeniden Açma Kuralı:
- Korunan temel altyapı zinciridir; açık kullanıcı talebi veya somut regresyon kanıtı olmadan değiştirilemez.

## Instagram Reel / Video Handling

Durum: GREEN (Korunan Temel Davranış)

Korunan Değişmezler:

- Reel gelen mesajı desteklenir.
- Reel + kullanıcı metni desteklenir.
- Kullanıcının güncel açık metin mesajı eski Reel içeriğinden önceliklidir.
- Bayat (stale) Reel yanıtları engellenir.
- Reel bağlamı uygun şekilde korunur.
- Reel sonrasındaki normal kullanıcı metinleri sorunsuz yanıtlanır.
- Talep edilmeyen medya uydurması (unsolicited media hallucination) engellenir.
- Randevu veya persona güncellemelerinden kaynaklanan herhangi bir gerileme (regression) oluşmaz.

Regresyon / Yeniden Açma Kuralı:
- Değiştirilemez; yeniden açılamaz.

## Instagram Native App State Sync — Closed Non-Blocker

Durum: KAPALI / DESTEKLENMEYEN GEREKSİNİM (NON-BLOCKER)

Korunan Değişmezler:

- Instagram yerel uygulamasındaki "görüldü/yanıtlandı" durumunun `sender_action: mark_seen` ile senkronize edilmesi bu entegrasyon için desteklenen bir gereksinim DEĞİLDİR.
- Desteklenmeyen `mark_seen` davranışı tekrar sisteme sokulamaz.
- Konuşma yönetimi ve operasyonel takip için yetkili kaynak SamChe Dashboard'dur.
- Meta altyapısı bu yeteneği açıkça desteklemedikçe ve kullanıcı açık bir talepte bulunmadıkça bir hata olarak yeniden açılamaz.

## WhatsApp Visual AI Lifecycle

Durum: GREEN

Korunan:

- Visual intent
- Catalog selection
- Job creation
- Worker lifecycle
- Generation
- Delivery

## Visual AI Catalog Grounding

Durum: GREEN

Korunan:

- Approved catalog only
- Product identity lock
- Room preservation
- No product hallucination
- Tenant generic behavior

## Provider Parity

Durum: GREEN

Korunan:

- Vertex ve OpenAI aynı context sözleşmesini kullanır.

## Tenant Isolation

Durum: GREEN

Korunan:

- Tenant verileri ayrıdır.
- Tenant özel hardcode yoktur.

---

## Governance & Next Roadmap Gates (Gelecek Doğrulama Kapıları — HENÜZ GREEN DEĞİL)

Aşağıdaki alanlar henüz fiziksel olarak test edilip kabul edilmemiştir; KESİNLİKLE GREEN OLARAK İŞARETLENEMEZ:

### Fresh Tenant Gate #1 (Sıradaki Yürütme Kapısı)
- **Durum:** PLANLANDI / SIRADAKİ DOĞRULAMA KAPISI (HENÜZ GREEN DEĞİL)
- **Amaç:** Tamamen yeni bir müşterinin, sıfır geliştirici müdahalesiyle (manuel SQL yok, veritabanı onarımı yok, gizli script yok, tenant'a özel hardcode yok, geliştiriciye özel konfigürasyon yok, tek seferlik mapping yok) desteklenen SamChe Dashboard kullanıcı arayüzü ve akışları üzerinden kurulup çalışabildiğini kanıtlamak.
- **Fiziksel Doğrulama Sırası:**
  1. Fresh Tenant / Tenant Foundation
  2. Assistant
  3. Knowledge Intelligence + Business Profile
  4. Web Chatbot
  5. AI Guide
  6. CRM / Live Inbox
  7. Instagram
  8. WhatsApp Embedded Signup
- **Hata Kuralı:** Eğer herhangi bir müşteri operasyonu manuel geliştirici müdahalesi gerektirirse bu kapı BAŞARISIZ (FAIL) sayılır ve temel generic platform hatası düzeltilir.

### WhatsApp Embedded Signup
- **Durum:** KOD DOĞRULAMASI VE META ONAYI MEVCUT — FİZİKSEL GREEN DEĞİL
- Kod seviyesinde doğrulama ve Meta onayı mevcut olmakla birlikte, müşteri tarzı Dashboard üzerinden fiziksel onboarding henüz kanıtlanmamıştır.

### SamChe Main WhatsApp Migration
- **Durum:** BEKLEMEDE (HENÜZ GREEN DEĞİL)
- Ancak ve ancak Fresh Tenant Gate #1 fiziksel olarak GREEN kabul edildikten sonra kontrollü bir şekilde yürütülecektir. Ardından gerçek trafik altında kabul (soak) izlenecektir.

### Telegram Bildirimlerinin Kaldırılması
- **Durum:** KALDIRILMADI / BEKLEMEDE (HENÜZ GREEN DEĞİL)
- Yalnızca yeni Dashboard / Live Inbox / WhatsApp yolu kanıtlanıp gerçek trafik altında onaylandıktan sonra Telegram bildirimleri kaldırılacaktır. Bu görev kapsamında Telegram kesinlikle kaldırılmaz.