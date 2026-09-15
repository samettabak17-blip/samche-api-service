import { isDiscreteEntity } from './contextual-intelligence-service.js';

/**
 * services/contextual-quick-questions-service.js
 * Generates bounded, deterministic, capability-aware contextual quick question chips
 * for discrete entities across multiple industries without LLM cost.
 */

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 1000;
const questionsCache = new Map();

const tenantCapsCache = new Map();
const TENANT_CAPS_TTL_MS = 5 * 60 * 1000;

function getCacheKey({ tenantId, entityId, language, prevEntityId, hasReviews, hasPolicies }) {
  return `${tenantId || 'anon'}:${entityId || 'entity'}:${language || 'en'}:${prevEntityId || 'none'}:${Boolean(hasReviews)}:${Boolean(hasPolicies)}`;
}

function truncateEntityName(name, maxLen = 28) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1).trim() + '…';
}

function normalizeLanguage(lang) {
  if (!lang || typeof lang !== 'string') return 'en';
  const l = lang.toLowerCase().trim();
  if (l.startsWith('tr')) return 'tr';
  if (l.startsWith('ar')) return 'ar';
  return 'en';
}

function normalizeEntityType(rawType) {
  const t = String(rawType || '').toUpperCase().trim();
  if (/^(?:PRODUCT|ITEM|PHYSICALPRODUCT|COMMODITY)$/.test(t)) return 'PRODUCT';
  if (/^(?:SERVICE|CONSULTING|MEMBERSHIP|PLAN|PACKAGE|SUBSCRIPTION)$/.test(t)) return 'SERVICE';
  if (/^(?:PROPERTY|REAL_ESTATE|APARTMENT|VILLA|PROJECT|RESIDENCE|DEVELOPMENT|OFFICE_SPACE)$/.test(t)) return 'PROPERTY';
  if (/^(?:VEHICLE|CAR|AUTOMOBILE|MOTORCYCLE|TRUCK|BOAT)$/.test(t)) return 'VEHICLE';
  if (/^(?:COURSE|CLASS|WORKSHOP|BOOTCAMP|PROGRAM|TRAINING|EDUCATION)$/.test(t)) return 'COURSE';
  if (/^(?:SOFTWARE|APP|APPLICATION|SAAS|TOOL|PLATFORM)$/.test(t)) return 'SOFTWARE';
  return 'GENERIC_DISCRETE';
}

async function resolveTenantCapabilities({ database, tenantId }) {
  if (!database?.query || !tenantId) {
    return { hasReviews: false, hasPolicies: false };
  }
  const cached = tenantCapsCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.timestamp < TENANT_CAPS_TTL_MS) {
    return cached.caps;
  }

  try {
    const res = await database.query(
      `SELECT
         COUNT(*) FILTER (WHERE reviews != '[]'::jsonb OR page_type = 'REVIEWS') AS review_count,
         COUNT(*) FILTER (WHERE policies != '[]'::jsonb OR page_type = 'POLICY') AS policy_count
       FROM tenant_site_pages
       WHERE tenant_id = $1 AND crawl_status != 'RETIRED'`,
      [tenantId]
    );
    const row = res.rows[0] || {};
    const caps = {
      hasReviews: Number(row.review_count || 0) > 0,
      hasPolicies: Number(row.policy_count || 0) > 0,
    };
    if (tenantCapsCache.size > 200) tenantCapsCache.clear();
    tenantCapsCache.set(tenantId, { caps, timestamp: now });
    return caps;
  } catch (err) {
    return { hasReviews: false, hasPolicies: false };
  }
}


/**
 * Pure deterministic question generation for a discrete entity.
 */
export function buildDeterministicQuickQuestions({
  currentEntity,
  previousEntities = [],
  language = 'en',
  hasReviews = false,
  hasPolicies = false,
} = {}) {
  if (!isDiscreteEntity(currentEntity)) {
    return [];
  }

  const lang = normalizeLanguage(language);
  const type = normalizeEntityType(currentEntity.entity_type);
  const prevEntity = Array.isArray(previousEntities) && previousEntities.length > 0
    ? previousEntities[0]
    : null;
  const prevName = prevEntity && isDiscreteEntity(prevEntity) && prevEntity.entity_name
    ? truncateEntityName(prevEntity.entity_name)
    : null;

  const questions = [];

  // 1. Core Features / Overview Family
  if (type === 'PRODUCT') {
    if (lang === 'tr') questions.push('Öne çıkan özellikleri neler?');
    else if (lang === 'ar') questions.push('ما هي الميزات الرئيسية؟');
    else questions.push('What are the key features?');
  } else if (type === 'SERVICE') {
    if (lang === 'tr') questions.push('Bu hizmet neleri kapsıyor?');
    else if (lang === 'ar') questions.push('ماذا تشمل هذه الخدمة؟');
    else questions.push('What does this service include?');
  } else if (type === 'PROPERTY') {
    if (lang === 'tr') questions.push('Proje özellikleri ve olanaklar nelerdir?');
    else if (lang === 'ar') questions.push('ما هي الميزات والمرافق الرئيسية؟');
    else questions.push('What are the key features and amenities?');
  } else if (type === 'VEHICLE') {
    if (lang === 'tr') questions.push('Araç özellikleri ve donanımı nedir?');
    else if (lang === 'ar') questions.push('ما هي مواصفات المركبة الرئيسية؟');
    else questions.push('What are the vehicle specifications?');
  } else if (type === 'COURSE') {
    if (lang === 'tr') questions.push('Eğitim müfredatı neleri içeriyor?');
    else if (lang === 'ar') questions.push('ماذا يشمل المنهج الدراسي؟');
    else questions.push('What does the curriculum cover?');
  } else if (type === 'SOFTWARE') {
    if (lang === 'tr') questions.push('Temel özellikleri ve yetenekleri neler?');
    else if (lang === 'ar') questions.push('ما هي الميزات والقدرات الأساسية؟');
    else questions.push('What are the core features?');
  } else {
    if (lang === 'tr') questions.push('Öne çıkan detaylar nelerdir?');
    else if (lang === 'ar') questions.push('ما هي التفاصيل الرئيسية؟');
    else questions.push('What are the key details?');
  }

  // 2. Comparison Family (with previous entity if available, otherwise category/market alternatives)
  if (prevName) {
    if (lang === 'tr') questions.push(`Bunu ${prevName} ile karşılaştır`);
    else if (lang === 'ar') questions.push(`كيف يقارن بـ ${prevName}؟`);
    else questions.push(`How does it compare to ${prevName}?`);
  } else {
    if (type === 'PRODUCT') {
      if (lang === 'tr') questions.push('Benzer modellerle farkı nedir?');
      else if (lang === 'ar') questions.push('كيف يقارن بالخيارات الأخرى؟');
      else questions.push('How does it compare to alternatives?');
    } else if (type === 'SERVICE') {
      if (lang === 'tr') questions.push('Diğer paketlerle farkı nedir?');
      else if (lang === 'ar') questions.push('كيف تقارن بالباقات الأخرى؟');
      else questions.push('How does it compare to other plans?');
    } else if (type === 'PROPERTY') {
      if (lang === 'tr') questions.push('Bölgedeki diğer projelerle farkı nedir?');
      else if (lang === 'ar') questions.push('كيف يقارن بالمشاريع الأخرى؟');
      else questions.push('How does it compare to other projects?');
    } else if (type === 'VEHICLE') {
      if (lang === 'tr') questions.push('Diğer modellerle nasıl karşılaştırılır?');
      else if (lang === 'ar') questions.push('كيف تقارن بالطرازات الأخرى؟');
      else questions.push('How does it compare to other models?');
    } else if (type === 'COURSE') {
      if (lang === 'tr') questions.push('Diğer eğitimlerle farkı nedir?');
      else if (lang === 'ar') questions.push('كيف تقارن بالدورات الأخرى؟');
      else questions.push('How does it compare to other courses?');
    } else if (type === 'SOFTWARE') {
      if (lang === 'tr') questions.push('Alternatiflerle nasıl karşılaştırılır?');
      else if (lang === 'ar') questions.push('كيف يقارن بالبدائل الأخرى؟');
      else questions.push('How does it compare to alternatives?');
    } else {
      if (lang === 'tr') questions.push('Diğer seçeneklerle farkı nedir?');
      else if (lang === 'ar') questions.push('كيف يقارن بالخيارات المتاحة؟');
      else questions.push('How does it compare?');
    }
  }
  // 3. Operational / Delivery / Next Steps Family
  if (type === 'PRODUCT') {
    if (lang === 'tr') questions.push('Teslimat ve kargo seçenekleri neler?');
    else if (lang === 'ar') questions.push('ما هي خيارات التوصيل والشحن؟');
    else questions.push('What are the delivery options?');
  } else if (type === 'SERVICE') {
    if (lang === 'tr') questions.push('Nasıl başlayabilirim?');
    else if (lang === 'ar') questions.push('كيف يمكنني البدء؟');
    else questions.push('How can I get started?');
  } else if (type === 'PROPERTY') {
    if (lang === 'tr') questions.push('Kat planları ve fiyat detayları neler?');
    else if (lang === 'ar') questions.push('ما هي المخططات والأسعار المتاحة؟');
    else questions.push('What are the floor plans and pricing?');
  } else if (type === 'VEHICLE') {
    if (lang === 'tr') questions.push('Fiyat ve finansman seçenekleri neler?');
    else if (lang === 'ar') questions.push('ما هي خيارات السعر والتمويل؟');
    else questions.push('What are the pricing and financing options?');
  } else if (type === 'COURSE') {
    if (lang === 'tr') questions.push('Ders saatleri ve süre bilgisi nedir?');
    else if (lang === 'ar') questions.push('ما هي المواعيد ومدة الدورة؟');
    else questions.push('What is the schedule and duration?');
  } else if (type === 'SOFTWARE') {
    if (lang === 'tr') questions.push('Hangi entegrasyonları destekliyor?');
    else if (lang === 'ar') questions.push('ما هي عمليات التكامل المدعومة؟');
    else questions.push('What integrations are supported?');
  } else {
    if (lang === 'tr') questions.push('Nasıl sipariş verebilirim?');
    else if (lang === 'ar') questions.push('كيف يمكنني الطلب؟');
    else questions.push('How can I order?');
  }

  // 4. Policy / Warranty / Reviews Family (Only offer when verified facts/capabilities exist)
  if (hasReviews) {
    if (lang === 'tr') questions.push('Müşteri değerlendirmeleri ne diyor?');
    else if (lang === 'ar') questions.push('ماذا يقول العملاء في التقييمات؟');
    else questions.push('What do customer reviews say?');
  } else if (type === 'PRODUCT' || hasPolicies) {
    if (lang === 'tr') questions.push('Garanti ve iade koşulları nedir?');
    else if (lang === 'ar') questions.push('ما هي سياسة الضمان والإرجاع؟');
    else questions.push('What is the warranty and return policy?');
  } else if (type === 'PROPERTY') {
    if (lang === 'tr') questions.push('Ödeme planı ve teslim tarihi nedir?');
    else if (lang === 'ar') questions.push('ما هي خطة الدفع وتاريخ التسليم؟');
    else questions.push('What is the payment plan and handover date?');
  } else if (type === 'VEHICLE') {
    if (lang === 'tr') questions.push('Test sürüşü randevusu alabilir miyim?');
    else if (lang === 'ar') questions.push('هل يمكنني حجز تجربة قيادة؟');
    else questions.push('Can I schedule a test drive?');
  } else if (type === 'COURSE') {
    if (lang === 'tr') questions.push('Ön koşul veya sertifika veriliyor mu?');
    else if (lang === 'ar') questions.push('هل توجد متطلبات مسبقة أو شهادة؟');
    else questions.push('Are there prerequisites or certification?');
  } else if (type === 'SOFTWARE') {
    if (lang === 'tr') questions.push('Ücretsiz deneme sürümü var mı?');
    else if (lang === 'ar') questions.push('هل تتوفر نسخة تجريبية مجانية؟');
    else questions.push('Is there a free trial?');
  }

  return questions.slice(0, 4);
}

/**
 * Canonical entry point to generate contextual quick questions with deduplication & caching.
 */
export async function generateContextualQuickQuestions({
  tenantId = null,
  currentEntity = null,
  previousEntities = [],
  database = null,
  language = 'en',
  tenantProfile = null,
  assistantConfig = null,
  hasReviews = null,
  hasPolicies = null,
} = {}) {
  if (!isDiscreteEntity(currentEntity)) {
    return [];
  }

  const entityId = currentEntity.entity_id || currentEntity.id || currentEntity.canonical_url;
  const prevEntity = Array.isArray(previousEntities) && previousEntities.length > 0
    ? previousEntities[0]
    : null;
  const prevEntityId = prevEntity?.entity_id || prevEntity?.id || null;
  const lang = normalizeLanguage(language || tenantProfile?.language || assistantConfig?.language || 'en');

  let caps = { hasReviews: Boolean(hasReviews), hasPolicies: Boolean(hasPolicies) };
  if ((hasReviews === null || hasPolicies === null) && database && tenantId) {
    caps = await resolveTenantCapabilities({ database, tenantId });
  }

  const cacheKey = getCacheKey({
    tenantId,
    entityId,
    language: lang,
    prevEntityId,
    hasReviews: caps.hasReviews,
    hasPolicies: caps.hasPolicies,
  });

  const now = Date.now();
  const cached = questionsCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.questions;
  }

  const questions = buildDeterministicQuickQuestions({
    currentEntity,
    previousEntities,
    language: lang,
    hasReviews: caps.hasReviews,
    hasPolicies: caps.hasPolicies,
  });

  if (questionsCache.size >= MAX_CACHE_SIZE) {
    questionsCache.clear();
  }
  questionsCache.set(cacheKey, { questions, timestamp: now });

  return questions;
}

