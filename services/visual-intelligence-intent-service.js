import crypto from 'node:crypto';
import { assertTenantVisualAiEntitlement, enqueueVisualAiGenerationJob } from './visual-ai-job-service.js';
import { safeFetchRemoteImage, validateSafeUrl } from './url-intelligence-service.js';
import { listApprovedVisualEntities } from './knowledge-entity-service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const VISUAL_INTENT_TYPES = Object.freeze({
  VISUAL_GENERATION: 'VISUAL_GENERATION',
  MULTIMODAL_SUPPORT_OR_QA: 'MULTIMODAL_SUPPORT_OR_QA',
  GENERAL_CONVERSATION: 'GENERAL_CONVERSATION',
});

export const CANONICAL_VISUAL_INTENT_TYPES = Object.freeze({
  UNDERSTAND_IMAGE: 'UNDERSTAND_IMAGE',
  SUPPORT_WITH_IMAGE: 'SUPPORT_WITH_IMAGE',
  DOCUMENT_UNDERSTANDING: 'DOCUMENT_UNDERSTANDING',
  VISUAL_GENERATION: 'VISUAL_GENERATION',
  VISUAL_EDIT: 'VISUAL_EDIT',
  INSUFFICIENT_CONTEXT: 'INSUFFICIENT_CONTEXT',
});

const VISUAL_GENERATION_PATTERNS = [
  /(?:make|turn|transform|redesign|redecorate|style|visualize|render|convert|apply|show)\s+this/i,
  /(?:create|generate|make|produce)\s+(?:an?\s+)?(?:visual|visualization|image|preview|rendering|mockup|composition)\b/i,
  /(?:place|put|insert|add)\s+.+\s+(?:in|into|on|onto)\s+(?:my\s+)?(?:image|photo|picture|scene|space)\b/i,
  /(?:look\s+like|design\s+as\s+inspiration|how\s+.*would\s+look|how\s+.*looks|show\s+me\s+how|show\s+me\s+this|show\s+this)/i,
  /(?:modern|scandinavian|mediterranean|rustic|minimalist|industrial|boho|luxury|contemporary)\s+(?:style|look|design|theme)/i,
  /(?:garden|room|kitchen|bedroom|living\s+room|wall|wallpaper|car|vehicle|furniture|stage|product|garment|unit)\s+(?:redesign|transformation|concept|preview|pattern)/i,
  /(?:wallpaper\s+.*on\s+(?:my\s+)?(?:wall|room))/i,
  /(?:bunu\s+.*dönüştür|yeniden\s+tasarla|böyle\s+görünmesini\s+sağla|nasıl\s+durur\s+göster|tasarım\s+önerisi\s+oluştur|görsel(?:leştirme)?\s+oluştur|görsel\s+üret|görselime\s+yerleştir)/i,
  /(?:أعد\s+تصميم|حول\s+.*|غير\s+تصميم|صمم\s+لي|كيف\s+يبدو|أنشئ\s+(?:تصوراً|صورة)|ولّد\s+(?:تصوراً|صورة)|ضع\s+.*\s+(?:في|داخل)\s+(?:صورتي|الصورة))/u,
];

const SUPPORT_OR_QA_PATTERNS = [
  /(?:damaged|broken|defect|faulty|error|malfunction|not\s+working|won't\s+turn\s+on|issue|problem)/i,
  /(?:what\s+does\s+this\s+mean|what\s+is\s+written\s+here|read\s+this|explain\s+this\s+screen|why\s+is\s+this\s+blinking)/i,
  /(?:invoice|receipt|order\s+slip|bill|tracking\s+number|fatura|dekont|kargo\s+fişi)/i,
  /(?:hasarlı|kırık|bozuk|arızalı|çalışmıyor|hata|bu\s+ne\s+anlama\s+geliyor|ekranda\s+ne\s+yazıyor)/i,
];

const CATALOG_REFERENCE = /\b(?:catalog(?:ue)?|inventory|your\s+(?:products?|items?|options?))\b|(?:katalog|ürünleriniz|urunleriniz)|(?:كتالوج|منتجاتكم)/iu;
const DIFFERENT_OPTION = /\b(?:another|different|alternative|other\s+(?:one|option|product|item))\b|(?:başka|farklı|baska|farkli)|(?:آخر|أخرى|مختلف)/iu;
const VISUAL_CONTINUATION = /\b(?:another|different|alternative|previous|prior|darker|lighter|brighter|warmer|cooler|shade|tone|contrast|hue|color|colour|blue|green|red|black|white|grey|gray|beige|gold|silver|navy|style|version|option|matching\s+item|theme|look|pattern|suitable|fit|fits|fitting|adapt|place|placement|position|put|move|adjust|align|modify|rotate|resize|larger|smaller|add|remove|replace|change|switch|make\s+it|turn\s+it|show\s+it|render\s+it|try\s+it|do\s+it)\b|(?:başka|farklı|önceki|koyu|açık|parlak|ton|renk|rengi|rengini|mavi|yeşil|kırmızı|siyah|beyaz|gri|bej|baska|farkli|uygun|uyarla|uyarlansın|sığdır|yerleştir|konumlandır|taşı|ayarla|düzelt|değiştir|büyüt|küçült|ekle|çıkar|kaldır|yap|olsun|dene|göster|aynısı)|(?:آخر|أخرى|مختلف|أغمق|أفتح|لون|أزرق|أخضر|أحمر|أسود|أبيض|مناسب|طابق|عدل|ضع|انقل|غير|كبر|صغر|أضف|احذف|اجعله|حوله|أره|جرب)/iu;
const ADDITIVE_VISUAL_EDIT = /\b(?:add|include)\s+(?:another|a\s+matching|an\s+additional)\b|(?:başka\s+bir\s+.*ekle|bir\s+.*daha\s+ekle)|(?:أضف\s+.*آخر)/iu;

const TEXT_QUESTION_PATTERNS = [
  /\b(?:price|cost|how\s+much|pricing|fee|rate|expensive|cheap|quote)\b/i,
  /\b(?:why\s+did\s+you\s+choose|why\s+this|reason\s+for|explain\s+why|why\s+choose)\b/i,
  /\b(?:size|sizes|dimension|dimensions|spec|specs|specification|specifications|material|materials|fabric|color\s+options|in\s+stock|available|warranty)\b/i,
  /\b(?:what\s+is\s+the|tell\s+me\s+about|information\s+about|details\s+of|features\s+of|who\s+are\s+you|where\s+are\s+you)\b/i,
  /(?:fiyat|ücret|kaç\s+para|ne\s+kadar|maliyet|pahalı|ucuz|teklif)/iu,
  /(?:neden\s+bu|neden\s+seçtin|sebebi\s+ne|açıkla|niye)/iu,
  /(?:boyut|ebat|ölçü|ölçüleri|özellik|özellikleri|materyal|malzeme|kumaş|stokta|stok|garanti)/iu,
  /(?:سعر|كم\s+السعر|تكلفة|كم\s+يكلف)/u,
  /(?:لماذا\s+اخترت|لماذا\s+هذا|ما\s+السبب)/u,
  /(?:مقاس|مقاسات|أبعاد|مواصفات|مادة|قماش|متوفر|ضمان)/u,
];

export function classifyVisualIntent({
  message = '',
  hasTargetImage = false,
  hasReferenceImage = false,
  hasDocument = false,
  recentHistory = [],
}) {
  const text = String(message || '').trim();

  // 1. Check for Support or Q&A patterns first
  const isSupportOrQa = SUPPORT_OR_QA_PATTERNS.some((p) => p.test(text)) || hasDocument;
  if (isSupportOrQa) {
    return {
      intent: VISUAL_INTENT_TYPES.MULTIMODAL_SUPPORT_OR_QA,
      canonicalIntent: hasDocument ? CANONICAL_VISUAL_INTENT_TYPES.DOCUMENT_UNDERSTANDING : CANONICAL_VISUAL_INTENT_TYPES.SUPPORT_WITH_IMAGE,
      isVisualGeneration: false,
      isSupport: true,
      confidence: 0.95,
      targetStatus: hasTargetImage ? 'PRESENT' : 'NOT_REQUIRED',
    };
  }

  // 2. Check for explicit Visual Generation patterns
  const isGenerationPattern = VISUAL_GENERATION_PATTERNS.some((p) => p.test(text));
  const hasTransformationVerb = /(?:redesign|transform|make|visualize|edit|modify|change|dönüştür|tasarla|düzenle|değiştir|uyarla|yerleştir)/i.test(text);

  // 3. Multi-turn context check: Did the assistant ask for a photo on the previous turn?
  const lastAssistantMsg = [...recentHistory].reverse().find((m) => m.role === 'assistant' || m.sender_type === 'ASSISTANT');
  const wasPromptedForPhoto = lastAssistantMsg && /(?:send\s+(?:a\s+)?photo|upload\s+(?:a\s+)?photo|resim\s+gönderin|fotoğraf\s+atın)/i.test(String(lastAssistantMsg.content || ''));

  // 4. Check for pure text questions / inquiries (pricing, why chosen, dimensions, etc.)
  const isTextQuestion = TEXT_QUESTION_PATTERNS.some((p) => p.test(text));
  if (isTextQuestion && !isGenerationPattern && !wasPromptedForPhoto) {
    return {
      intent: VISUAL_INTENT_TYPES.GENERAL_CONVERSATION,
      canonicalIntent: hasTargetImage
        ? CANONICAL_VISUAL_INTENT_TYPES.UNDERSTAND_IMAGE
        : CANONICAL_VISUAL_INTENT_TYPES.UNDERSTAND_IMAGE,
      isVisualGeneration: false,
      isSupport: false,
      confidence: 0.9,
      targetStatus: hasTargetImage ? 'PRESENT' : 'NOT_REQUIRED',
    };
  }

  if (isGenerationPattern || (hasTransformationVerb && (hasTargetImage || hasReferenceImage)) || (wasPromptedForPhoto && hasTargetImage)) {
    const isEdit = /(?:edit|darker|lighter|change|replace|modify|düzenle|değiştir|uyarla|uygun)/i.test(text);
    return {
      intent: VISUAL_INTENT_TYPES.VISUAL_GENERATION,
      canonicalIntent: isEdit ? CANONICAL_VISUAL_INTENT_TYPES.VISUAL_EDIT : CANONICAL_VISUAL_INTENT_TYPES.VISUAL_GENERATION,
      isVisualGeneration: true,
      isSupport: false,
      confidence: 0.9,
      targetStatus: hasTargetImage ? 'PRESENT' : (wasPromptedForPhoto ? 'CORRELATED_FROM_HISTORY' : 'MISSING'),
      styleStatus: text.length > 5 ? 'PRESENT' : 'MISSING',
    };
  }

  return {
    intent: VISUAL_INTENT_TYPES.GENERAL_CONVERSATION,
    canonicalIntent: hasTargetImage
      ? CANONICAL_VISUAL_INTENT_TYPES.UNDERSTAND_IMAGE
      : (/visualize|redesign|transform|dönüştür|tasarla/i.test(text)
        ? CANONICAL_VISUAL_INTENT_TYPES.INSUFFICIENT_CONTEXT
        : null),
    isVisualGeneration: false,
    isSupport: false,
    confidence: 0.7,
    targetStatus: hasTargetImage ? 'PRESENT' : 'NOT_REQUIRED',
  };
}

/**
 * Safely resolves and downloads a remote reference image with SSRF and MIME validation
 */
export async function resolveSafeReferenceUrl({ url, timeoutMs = 5000, fetchImpl = null }) {
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'URL_REQUIRED', bytes: null, mimeType: null };
  }

  try {
    const fetchResult = await safeFetchRemoteImage(url.trim(), {
      timeoutMs,
      fetchImpl,
      maxSizeBytes: 10 * 1024 * 1024,
    });

    if (!fetchResult.bytes) {
      return { ok: false, error: 'NOT_AN_IMAGE', bytes: null, mimeType: null };
    }

    return {
      ok: true,
      error: null,
      bytes: fetchResult.bytes,
      mimeType: fetchResult.mimeType,
      finalUrl: fetchResult.url,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.code || 'REFERENCE_URL_FETCH_FAILED',
      bytes: null,
      mimeType: null,
    };
  }
}

export function normalizeVisualAiLanguage(language) {
  const code = String(language ?? '').trim().toLowerCase().slice(0, 2);
  if (code === 'tr') return 'tr';
  if (code === 'ar') return 'ar';
  return 'en';
}

export function formatVisualAiPromptSuggestion(language) {
  const lang = normalizeVisualAiLanguage(language);
  const messages = {
    en: 'Please send a photo of the space or area you would like to transform.',
    tr: 'Lütfen dönüştürmek istediğiniz mekanın veya alanın bir fotoğrafını gönderin.',
    ar: 'يرجى إرسال صورة للمكان أو المساحة التي ترغب في تحويلها.',
  };
  return messages[lang] ?? messages.en;
}

export function formatVisualAiAcknowledgement(language) {
  const lang = normalizeVisualAiLanguage(language);
  const messages = {
    en: 'Your visual concept preview is being created, please wait...',
    tr: 'Görsel konsept önizlemeniz oluşturuluyor, lütfen bekleyin...',
    ar: 'جارٍ إنشاء معاينة المفهوم المرئي الخاص بك، يرجى الانتظار...',
  };
  return messages[lang] ?? messages.en;
}

export function formatVisualAiReadyMessage(language) {
  const lang = normalizeVisualAiLanguage(language);
  const messages = {
    en: 'Your visual concept preview is ready.',
    tr: 'Görsel konsept önizlemeniz hazır.',
    ar: 'معاينة المفهوم المرئي الخاص بك جاهزة.',
  };
  return messages[lang] ?? messages.en;
}

export function formatVisualAiFailureMessage(language) {
  const lang = normalizeVisualAiLanguage(language);
  const messages = {
    en: 'Your visual concept preview could not be generated right now. Please try again with a different image or description.',
    tr: 'Görsel konsept önizlemeniz şu anda oluşturulamadı. Lütfen farklı bir görsel veya açıklamayla tekrar deneyin.',
    ar: 'تعذر إنشاء معاينة المفهوم المرئي الخاص بك حالياً. يرجى المحاولة مرة أخرى باستخدام صورة أو وصف مختلف.',
  };
  return messages[lang] ?? messages.en;
}

export function formatVisualAiSafetyMessage(language) {
  const lang = normalizeVisualAiLanguage(language);
  const messages = {
    en: 'Your visual generation request could not be completed because it did not comply with our safety policy.',
    tr: 'Görsel üretim talebiniz güvenlik politikalarımıza uymadığı için tamamlanamadı.',
    ar: 'تعذر إكمال طلب الإنشاء المرئي الخاص بك لعدم توافقه مع سياسة الأمان الخاصة بنا.',
  };
  return messages[lang] ?? messages.en;
}

export function formatVisualAiClarification(language, candidateNames = []) {
  const lang = normalizeVisualAiLanguage(language);
  const formatted = Array.isArray(candidateNames) ? candidateNames.filter(Boolean).join(', ') : '';
  const messages = {
    en: formatted ? `Which option did you mean? (${formatted})` : 'Could you please clarify which option you would like to visualize?',
    tr: formatted ? `Hangi seçeneği kastettiniz? (${formatted})` : 'Lütfen hangi seçeneği görselleştirmek istediğinizi belirtir misiniz?',
    ar: formatted ? `أي خيار تقصد؟ (${formatted})` : 'يرجى توضيح الخيار الذي ترغب في تصميمه.',
  };
  return messages[lang] ?? messages.en;
}

/**
 * Resolves generic canonical grounding context for visual AI requests:
 * 1. Explicit customer attachments / references
 * 2. Resolved product / catalog / entity context (from page context or visitor context)
 * 3. Approved Knowledge Intelligence evidence (strictly tenant-scoped and approved only)
 * 4. Business Profile / tenant context
 */
export async function resolveVisualAiGroundingContext({
  database,
  tenantId,
  assistantId = null,
  instruction = '',
  entity = null,
  visitorContext = null,
  businessProfile = null,
  retrieveKnowledge = null,
}) {
  const grounding = {
    entity: null,
    approvedKnowledge: [],
    businessContext: null,
    referenceMedia: [],
    isAmbiguous: false,
    ambiguousCandidates: [],
  };

  const resolvedEntity = entity || visitorContext?.current_entity || visitorContext?.currentEntity || null;
  if (resolvedEntity && typeof resolvedEntity === 'object') {
    grounding.entity = {
      name: resolvedEntity.entity_name || resolvedEntity.name || resolvedEntity.title || null,
      type: resolvedEntity.entity_type || resolvedEntity.type || null,
      description: resolvedEntity.description || resolvedEntity.summary || null,
      attributes: resolvedEntity.attributes || {},
      approvedMedia: resolvedEntity.approved_media || resolvedEntity.approvedMedia || [],
    };
    if (Array.isArray(grounding.entity.approvedMedia) && grounding.entity.approvedMedia.length > 0) {
      grounding.referenceMedia = grounding.entity.approvedMedia;
    }
  }

  // If no explicit entity was provided, attempt to resolve from tenant approved knowledge entities
  if (!grounding.entity && database && tenantId && instruction) {
    try {
      const { retrieveApprovedEntities, detectEntityAmbiguity } = await import('./knowledge-entity-service.js');
      const entities = await retrieveApprovedEntities({ database, tenantId, assistantId, query: instruction, limit: 5 });
      if (entities.length > 0) {
        const ambiguity = detectEntityAmbiguity(entities);
        if (ambiguity.isAmbiguous) {
          grounding.isAmbiguous = true;
          grounding.ambiguousCandidates = ambiguity.candidates;
        } else {
          const matched = entities[0];
          grounding.entity = {
            id: matched.id,
            name: matched.name,
            type: matched.entity_type,
            externalCode: matched.external_code,
            description: matched.description,
            attributes: matched.attributes || {},
            approvedMedia: matched.approved_media || [],
          };
          if (Array.isArray(matched.approved_media) && matched.approved_media.length > 0) {
            grounding.referenceMedia = matched.approved_media;
          }
        }
      }
    } catch {
      // Grounding failures must fail safely without breaking generation
    }
  }

  if (database && tenantId && typeof retrieveKnowledge === 'function' && instruction) {
    try {
      const chunks = await retrieveKnowledge({ database, tenantId, assistantId, query: instruction });
      if (Array.isArray(chunks)) {
        grounding.approvedKnowledge = chunks
          .filter((c) => c?.approval_status === 'APPROVED' || c?.status === 'active' || c?.approved === true)
          .map((c) => ({
            title: c.title || c.source_title || null,
            content: String(c.chunk_content || c.content || c.text || '').trim(),
          }))
          .filter((c) => Boolean(c.content))
          .slice(0, 3);
      }
    } catch {
      // Grounding failures must fail safely without breaking generation
    }
  }

  if (businessProfile && typeof businessProfile === 'object') {
    grounding.businessContext = {
      companyName: businessProfile.company_display_name || businessProfile.company_identity || null,
      businessType: businessProfile.business_type || businessProfile.industry || null,
    };
  }

  return grounding;
}

/**
 * Formats a provider-neutral composite prompt instruction combining
 * customer instruction with canonical grounding context.
 * Customer instructions strictly outrank generic knowledge.
 */
export function buildGroundedVisualInstruction({ instruction, groundingContext = {} }) {
  const normalizedInstruction = String(instruction || '').trim();
  const sections = [normalizedInstruction];

  const hasCatalogGrounding = Boolean(
    groundingContext.catalogRequested ||
    groundingContext.catalog ||
    groundingContext.entity
  );

  if (groundingContext.entity?.name) {
    const entityLines = [
      `[Referenced Product/Entity: ${groundingContext.entity.name}${groundingContext.entity.type ? ` (${groundingContext.entity.type})` : ''}${groundingContext.entity.description ? ` - ${groundingContext.entity.description}` : ''}]`,
    ];
    if (groundingContext.entity.attributes && typeof groundingContext.entity.attributes === 'object') {
      const attrEntries = Object.entries(groundingContext.entity.attributes).filter(([_, v]) => Boolean(v));
      if (attrEntries.length > 0) {
        entityLines.push(`[Product Specifications: ${attrEntries.map(([k, v]) => `${k}: ${v}`).join(', ')}]`);
      }
    }
    sections.push(entityLines.join('\n'));
  }

  if (hasCatalogGrounding) {
    sections.push(
      '[Catalog Grounding & Room Preservation Contract]\n' +
      '- Keep the original room unchanged. Preserve the exact camera angle, perspective, room geometry, walls, windows, floor, and lighting from the customer room image.\n' +
      '- Use only the provided catalog product reference.\n' +
      '- Only visualize the selected product in this room.\n' +
      '- Do not create a new product.\n' +
      '- Do not introduce external brands (strictly no IKEA or third-party brand hallucination).\n' +
      '- Do not redesign the room, alter architecture, or replace the entire scene.'
    );
  }

  if (Array.isArray(groundingContext.approvedKnowledge) && groundingContext.approvedKnowledge.length > 0) {
    const knowledgeSnippets = groundingContext.approvedKnowledge.map((k) => k.content).join('; ');
    sections.push(`[Approved Tenant Knowledge: ${knowledgeSnippets}]`);
  }

  return sections.join('\n\n');
}


/**
 * Resolves multi-turn WhatsApp visual request state and parameters
 */
export async function resolveWhatsAppVisualRequestState({
  database,
  tenantId,
  conversationId,
  message = '',
  currentResourceIds = [],
  recentHistory = [],
  language = 'en',
}) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(conversationId || ''))) {
    return { state: 'INVALID', targetResourceId: null, referenceResourceId: null };
  }

  // Load latest images for this conversation
  const resourcesResult = await database.query(
    `SELECT id, source_type, media_category, mime_type, original_filename, storage_key, created_at
       FROM conversation_resources
      WHERE tenant_id = $1 AND conversation_id = $2 AND media_category = 'IMAGE' AND processing_status = 'READY'
        AND source_type <> 'VISUAL_AI_GENERATED'
      ORDER BY created_at DESC LIMIT 8`,
    [tenantId, conversationId]
  );
  const images = (resourcesResult.rows || []).filter((row) => row.source_type !== 'VISUAL_AI_GENERATED');
  const priorResult = await database.query(
    `SELECT target_resource_id, generated_resource_id, grounding_context
       FROM visual_ai_generation_jobs
      WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'COMPLETED'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [tenantId, conversationId]
  );
  const previousJob = priorResult.rows?.[0] || null;
  const previousCatalog = previousJob?.grounding_context?.catalog || null;
  const isExplicitTextQuestion = TEXT_QUESTION_PATTERNS.some((p) => p.test(String(message)));
  const isContinuation = VISUAL_CONTINUATION.test(String(message));
  const isAddEdit = ADDITIVE_VISUAL_EDIT.test(String(message));
  const catalogRequested = CATALOG_REFERENCE.test(String(message)) || Boolean(previousCatalog && (isContinuation || isAddEdit));
  const requireDifferentEntity = Boolean(catalogRequested && DIFFERENT_OPTION.test(String(message)));

  let classification = classifyVisualIntent({
    message,
    hasTargetImage: images.length > 0,
    hasReferenceImage: images.length > 1,
    hasDocument: false,
    recentHistory,
  });
  if (!classification.isSupport && !classification.isVisualGeneration && !isExplicitTextQuestion && previousJob && isContinuation) {
    classification = {
      ...classification,
      intent: VISUAL_INTENT_TYPES.VISUAL_GENERATION,
      canonicalIntent: CANONICAL_VISUAL_INTENT_TYPES.VISUAL_EDIT,
      isVisualGeneration: true,
      targetStatus: 'CORRELATED_FROM_HISTORY',
    };
  }

  if (!classification.isVisualGeneration) {
    return {
      state: 'NOT_VISUAL_GENERATION',
      intentClassification: classification,
      targetResourceId: null,
      referenceResourceId: null,
      catalogRequested,
    };
  }

  const priorOriginalTargetId = previousJob?.grounding_context?.originalCustomerTargetResourceId || previousJob?.target_resource_id;
  if (priorOriginalTargetId && !images.some((image) => image.id === priorOriginalTargetId)) {
    const priorTarget = await database.query(
      `SELECT id, source_type, media_category, mime_type, original_filename, storage_key, created_at
         FROM conversation_resources
        WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3
          AND media_category = 'IMAGE' AND processing_status = 'READY'
          AND source_type <> 'VISUAL_AI_GENERATED'`,
      [priorOriginalTargetId, tenantId, conversationId]
    );
    if (priorTarget.rows?.[0]) images.push(priorTarget.rows[0]);
  }

  if (images.length === 0) {
    return {
      state: 'WAITING_FOR_TARGET',
      intentClassification: classification,
      promptSuggestion: formatVisualAiPromptSuggestion(language),
      targetResourceId: null,
      referenceResourceId: null,
      catalogRequested,
    };
  }

  const currentResourceIdSet = new Set(currentResourceIds.filter((id) => UUID_REGEX.test(String(id))));
  const currentImage = images.find((image) => currentResourceIdSet.has(image.id)) || null;
  const originalCustomerTargetResourceId = priorOriginalTargetId || null;
  const previousTarget = images.find((image) => image.id === originalCustomerTargetResourceId) || null;
  let targetResourceId = currentImage?.id || previousTarget?.id || images[0]?.id;
  let targetResourceRole = 'CUSTOMER_TARGET';
  if (!currentImage && previousJob?.generated_resource_id && ADDITIVE_VISUAL_EDIT.test(String(message))) {
    const generated = await database.query(
      `SELECT id FROM conversation_resources
        WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3
          AND source_type = 'VISUAL_AI_GENERATED' AND media_category = 'IMAGE' AND processing_status = 'READY'`,
      [previousJob.generated_resource_id, tenantId, conversationId]
    );
    if (generated.rows?.[0]) {
      targetResourceId = generated.rows[0].id;
      targetResourceRole = 'GENERATED_OUTPUT';
    }
  }
  const referenceResourceId = catalogRequested ? null : (images.find((image) => image.id !== targetResourceId)?.id || null);

  console.info('VISUAL_DEBUG_STAGE: intent_detected', {
    tenantId,
    conversationId,
    intent: classification.canonicalIntent || classification.intent,
    catalogRequested,
    targetResourceId,
  });

  return {
    state: 'READY_FOR_GENERATION',
    intentClassification: classification,
    targetResourceId,
    targetResourceRole,
    originalCustomerTargetResourceId: currentImage?.id || originalCustomerTargetResourceId || targetResourceId,
    referenceResourceId,
    promptInstruction: message || 'Transform this scene in the requested aesthetic style.',
    catalogRequested,
    previousEntityId: previousCatalog?.entityId || null,
    requireDifferentEntity,
  };
}

const CATALOG_SELECTION_STOPWORDS = new Set([
  'from', 'your', 'catalog', 'catalogue', 'product', 'products', 'item', 'items',
  'option', 'options', 'choose', 'select', 'another', 'different', 'suitable',
  'create', 'make', 'visualize', 'visualization', 'using', 'with', 'this', 'that',
  'please', 'version', 'same', 'previous', 'image', 'photo',
]);

function catalogTerms(value) {
  return new Set(String(value || '').toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu)?.filter((word) => !CATALOG_SELECTION_STOPWORDS.has(word)) || []);
}

export async function resolveVisualCatalogSelection({
  database, tenantId, assistantId = null, instruction = '',
  previousEntityId = null, requireDifferentEntity = false,
}) {
  const entries = await listApprovedVisualEntities({ database, tenantId, assistantId });
  const eligible = entries.filter((entry) => entry.tenant_id === tenantId
    && Array.isArray(entry.approved_media)
    && entry.approved_media.some((media) => UUID_REGEX.test(String(media.id))
      && String(media.storage_key || '').startsWith(`knowledge/${tenantId}/`)
      && /^image\/(?:png|jpe?g|webp)$/i.test(String(media.mime_type))));
  if (!eligible.length) return { state: 'NO_APPROVED_CATALOG' };

  const candidates = requireDifferentEntity && previousEntityId
    ? eligible.filter((entry) => entry.id !== previousEntityId)
    : eligible;
  if (!candidates.length) return { state: 'NO_ALTERNATIVE' };

  const reusePriorSelection = !requireDifferentEntity && previousEntityId
    && (!CATALOG_REFERENCE.test(instruction) || /\b(?:previous|same|prior)\b|(?:önceki|aynı)|(?:السابق|نفس)/iu.test(instruction));
  let selected = reusePriorSelection
    ? candidates.find((entry) => entry.id === previousEntityId)
    : null;
  if (!selected && candidates.length === 1) selected = candidates[0];
  if (!selected) {
    const terms = catalogTerms(instruction);
    const ranked = candidates.map((entry) => {
      const description = [entry.name, entry.description, entry.entity_type, entry.external_code, ...Object.values(entry.attributes || {})].join(' ');
      const entryTerms = catalogTerms(description);
      const matches = [...terms].filter((word) => entryTerms.has(word)).length;
      return { entry, matches };
    }).sort((a, b) => b.matches - a.matches || Number(b.entry.confidence || 0) - Number(a.entry.confidence || 0) || String(a.entry.id).localeCompare(String(b.entry.id)));
    if (ranked[0]?.matches > 0 && ranked[0].matches > (ranked[1]?.matches || 0)) {
      selected = ranked[0].entry;
    } else {
      selected = ranked[0]?.entry || candidates[0];
    }
  }
  if (!selected) return { state: 'CLARIFICATION_REQUIRED' };

  const media = selected.approved_media.filter((item) => UUID_REGEX.test(String(item.id))
    && String(item.storage_key || '').startsWith(`knowledge/${tenantId}/`)
    && /^image\/(?:png|jpe?g|webp)$/i.test(String(item.mime_type))).slice(0, 3);
  console.info('VISUAL_DEBUG_STAGE: catalog_selected', {
    tenantId,
    entityId: selected.id,
    entityName: selected.name,
    mediaCount: media.length,
  });
  return {
    state: 'SELECTED',
    entity: {
      id: selected.id, name: selected.name, type: selected.entity_type,
      description: selected.description, attributes: selected.attributes || {},
    },
    mediaIds: media.map((item) => item.id),
  };
}

export function formatVisualCatalogFallback(language, reason) {
  const lang = normalizeVisualAiLanguage(language);
  const messages = {
    NO_ALTERNATIVE: {
      en: 'I could not find another approved catalog option for this visualization. You can choose a different catalog item when one becomes available.',
      tr: 'Bu görselleştirme için onaylı başka bir katalog seçeneği bulamadım. Başka bir katalog ürünü kullanılabilir olduğunda onu seçebilirsiniz.',
      ar: 'لم أجد خياراً آخر معتمداً من الكتالوج لهذا التصور. يمكنك اختيار منتج آخر من الكتالوج عندما يصبح متاحاً.',
    },
    NO_APPROVED_CATALOG: {
      en: 'I could not find an approved catalog item with a usable image for this visualization. Please choose an approved catalog item when one becomes available.',
      tr: 'Bu görselleştirme için kullanılabilir görseli olan onaylı bir katalog ürünü bulamadım. Onaylı bir katalog ürünü kullanılabilir olduğunda lütfen onu seçin.',
      ar: 'لم أجد منتجاً معتمداً من الكتالوج مع صورة قابلة للاستخدام لهذا التصور. يرجى اختيار منتج معتمد من الكتالوج عندما يصبح متاحاً.',
    },
    CLARIFICATION_REQUIRED: {
      en: 'I found several approved catalog options. Which one would you like me to use?',
      tr: 'Birden fazla onaylı katalog seçeneği buldum. Hangisini kullanmamı istersiniz?',
      ar: 'وجدت عدة خيارات معتمدة من الكتالوج. أيّها تود أن أستخدم؟',
    },
    TEMPORARILY_UNAVAILABLE: {
      en: 'I cannot prepare a catalog-grounded visualization right now. Please try again shortly.',
      tr: 'Şu anda katalog ürününe dayalı görselleştirme hazırlayamıyorum. Lütfen kısa süre sonra tekrar deneyin.',
      ar: 'لا أستطيع إعداد تصور مستند إلى الكتالوج الآن. يرجى المحاولة بعد قليل.',
    },
  };
  return (messages[reason] || messages.CLARIFICATION_REQUIRED)[lang];
}

export function formatVisualCatalogTargetPrompt(language) {
  const lang = normalizeVisualAiLanguage(language);
  return {
    en: 'Please send the image you want me to transform using an approved catalog item.',
    tr: 'Onaylı bir katalog ürünüyle dönüştürmemi istediğiniz görseli lütfen gönderin.',
    ar: 'يرجى إرسال الصورة التي تريد تحويلها باستخدام منتج معتمد من الكتالوج.',
  }[lang];
}

/**
 * Orchestrates WhatsApp Visual AI job enqueueing with entitlement checks
 */
export async function orchestrateWhatsAppVisualAiJob({
  database,
  storage,
  tenantId,
  conversationId,
  messageId = null,
  targetResourceId,
  referenceResourceId = null,
  referenceUrl = null,
  promptInstruction,
  groundingContext = {},
  assistantId = null,
  channelId = null,
  catalogRequested = false,
  previousEntityId = null,
  requireDifferentEntity = false,
  targetResourceRole = 'CUSTOMER_TARGET',
  originalCustomerTargetResourceId = null,
  provider = 'MOCK',
  model = 'mock-visual-v1',
  language = 'en',
}) {
  await assertTenantVisualAiEntitlement({ database, tenantId });

  const resolvedLanguage = normalizeVisualAiLanguage(language || groundingContext?.language);
  let catalogSelection = null;
  if (catalogRequested) {
    catalogSelection = await resolveVisualCatalogSelection({
      database, tenantId, assistantId, instruction: promptInstruction,
      previousEntityId, requireDifferentEntity,
    });
    if (catalogSelection.state !== 'SELECTED') {
      return {
        status: 'CATALOG_UNRESOLVED',
        reason: catalogSelection.state,
        acknowledgmentText: formatVisualCatalogFallback(resolvedLanguage, catalogSelection.state),
      };
    }
  }
  const resolvedGroundingContext = {
    ...groundingContext,
    language: resolvedLanguage,
    ...(catalogSelection ? {
      catalogRequested: true,
      catalog: { entityId: catalogSelection.entity.id, mediaIds: catalogSelection.mediaIds },
      entity: catalogSelection.entity,
      resourceRoles: { target: targetResourceRole, catalogReferences: 'CATALOG_REFERENCE', output: 'GENERATED_OUTPUT' },
      originalCustomerTargetResourceId: originalCustomerTargetResourceId || targetResourceId,
      assistantId,
      channelId,
    } : {}),
  };

  const job = await enqueueVisualAiGenerationJob({
    database,
    tenantId,
    conversationId,
    messageId,
    targetResourceId,
    referenceResourceId,
    referenceUrl,
    promptInstruction,
    groundingContext: resolvedGroundingContext,
    provider,
    model,
  });

  return {
    job,
    status: 'QUEUED',
    acknowledgmentText: formatVisualAiAcknowledgement(resolvedLanguage),
  };
}

/**
 * Loads the active Visual AI session context for a conversation from durable storage
 */
export async function loadActiveVisualSessionContext({ database, tenantId, conversationId }) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(conversationId || ''))) {
    return null;
  }

  try {
    const jobResult = await database.query(
      `SELECT id, target_resource_id, reference_resource_id, reference_url,
              generated_resource_id, prompt_instruction, grounding_context,
              provider, model, status, created_at, updated_at
         FROM visual_ai_generation_jobs
        WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'COMPLETED'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, conversationId]
    );

    const latestJob = jobResult.rows?.[0];
    if (!latestJob) return null;

    const originalTargetId = latestJob.grounding_context?.originalCustomerTargetResourceId
      || latestJob.target_resource_id;

    const resourcesResult = await database.query(
      `SELECT id, source_type, media_category, mime_type, original_filename, storage_key, created_at
         FROM conversation_resources
        WHERE tenant_id = $1 AND conversation_id = $2 AND media_category = 'IMAGE' AND processing_status = 'READY'
        ORDER BY created_at DESC LIMIT 10`,
      [tenantId, conversationId]
    );

    const uploadedImages = (resourcesResult.rows || []).filter((r) => r.source_type !== 'VISUAL_AI_GENERATED');
    const generatedImages = (resourcesResult.rows || []).filter((r) => r.source_type === 'VISUAL_AI_GENERATED');

    const entity = latestJob.grounding_context?.entity || null;
    const catalog = latestJob.grounding_context?.catalog || null;
    const catalogRequested = Boolean(latestJob.grounding_context?.catalogRequested || catalog);

    return {
      active: true,
      visualSessionActive: true,
      jobId: latestJob.id,
      tenantId,
      conversationId,
      originalCustomerTargetResourceId: originalTargetId,
      targetResourceId: latestJob.target_resource_id,
      generatedResourceId: latestJob.generated_resource_id,
      selectedEntity: entity,
      catalogRequested,
      productId: entity?.id || entity?.externalCode || null,
      productName: entity?.name || null,
      productType: entity?.type || null,
      productDescription: entity?.description || null,
      productAttributes: entity?.attributes || {},
      lastPromptInstruction: latestJob.prompt_instruction,
      generationParameters: {
        provider: latestJob.provider,
        model: latestJob.model,
      },
      uploadedImagesCount: uploadedImages.length,
      generatedImagesCount: generatedImages.length,
      conversationGoal: latestJob.prompt_instruction,
      createdAt: latestJob.created_at,
    };
  } catch (err) {
    console.warn('LOAD_VISUAL_SESSION_CONTEXT_WARN:', err?.message);
    return null;
  }
}

/**
 * Builds the canonical system prompt section for active Visual AI sessions
 */
export function buildVisualSessionPromptSection(visualSession) {
  if (!visualSession || !visualSession.active) return '';

  const lines = [
    '================================================================================',
    'ACTIVE MULTIMODAL VISUAL AI SESSION (VISUAL_SESSION_ACTIVE = true)',
    '================================================================================',
    'The customer is currently engaged in an active multimodal Visual AI session.',
    `- Active Visual Goal / Request: "${visualSession.conversationGoal || visualSession.lastPromptInstruction || 'Visual creation/styling'}"`,
  ];

  if (visualSession.selectedEntity || visualSession.productName) {
    lines.push(`- Selected Catalog Product / Item: ${visualSession.productName || visualSession.selectedEntity?.name || 'Selected product'}`);
    if (visualSession.productType || visualSession.selectedEntity?.type) {
      lines.push(`  Type/Category: ${visualSession.productType || visualSession.selectedEntity?.type}`);
    }
    if (visualSession.productId || visualSession.selectedEntity?.id) {
      lines.push(`  Product ID/Code: ${visualSession.productId || visualSession.selectedEntity?.id}`);
    }
    if (visualSession.productDescription || visualSession.selectedEntity?.description) {
      lines.push(`  Description: ${visualSession.productDescription || visualSession.selectedEntity?.description}`);
    }
    const attrs = visualSession.productAttributes || visualSession.selectedEntity?.attributes || {};
    const attrEntries = Object.entries(attrs);
    if (attrEntries.length > 0) {
      lines.push('  Product Attributes:');
      for (const [k, v] of attrEntries) {
        lines.push(`    * ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
  }

  lines.push('- Visual Context State: Original customer room/space photo and generated visual preview are preserved.');
  lines.push('');
  lines.push('CANONICAL VISUAL SESSION RULES & CONTEXT PRIORITY:');
  lines.push('1. CONTEXT PRIORITY ORDER (STRICT):');
  lines.push('   1) Current user text intent (highest priority)');
  lines.push('   2) Active conversation goal');
  lines.push('   3) Previous visual session context');
  lines.push('   4) Retrieved catalog/product knowledge');
  lines.push('   5) General tenant knowledge');
  lines.push('2. TEXT QUESTIONS DURING VISUAL SESSION: If the user asks about the selected product (e.g. price, sizes, specs, materials, why it was chosen):');
  lines.push('   - Answer directly and accurately using the selected product information and catalog knowledge.');
  lines.push('   - Maintain the visual session in the background; do NOT claim you forgot the image or reset the session.');
  lines.push('3. VISUAL MODIFICATIONS: If the user requests adjustments (e.g. "make it darker", "try another color", "make it fit my bed"):');
  lines.push('   - The system continues from this active session seamlessly without restarting or asking for a new photo.');
  lines.push('4. NON-VISUAL QUESTIONS: If the user asks an unrelated business question (e.g. company services, residency, contact info), answer the written question directly without forcing visual deflection.');
  lines.push('================================================================================');

  return lines.join('\n');
}

