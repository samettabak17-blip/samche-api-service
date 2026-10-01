# SamChe GREEN Baseline Registry

Bu dosya SamChe platformunda tamamlanmış, test edilmiş ve GREEN kabul edilmiş
özelliklerin koruma kaydıdır.

Yeni ajanlar bu dosyayı okuyarak tamamlanmış alanları tekrar açmaz ve mevcut
çalışan davranışları korur. Bir GREEN alanı ancak `AGENTS.md` içinde belirtilen
açık değişiklik gerekçesi ve regresyon kanıtı ile değiştirilebilir.

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

## Instagram Reel / Video Handling

Durum: GREEN

Korunan:

- Yeni kullanıcı mesajı eski Reel cevabından önceliklidir.
- Stale Reel response engellenir.
- Video metadata/context korunur.

## Instagram Appointment Qualification

Durum: GREEN

Korunan:

- Meeting purpose detection
- Missing information handling
- Date/time validation
- Slot invention prevention
- Conversation context memory

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
