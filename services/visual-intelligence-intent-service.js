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
  /(?:look\s+like|design\s+as\s+inspiration|how\s+.*would\s+look|how\s+.*looks|show\s+me\s+how|show\s+me\s+this|show\s+this)/i,
  /(?:modern|scandinavian|mediterranean|rustic|minimalist|industrial|boho|luxury|contemporary)\s+(?:style|look|design|theme)/i,
  /(?:garden|room|kitchen|bedroom|living\s+room|wall|wallpaper|car|vehicle|furniture|stage|product|garment|unit)\s+(?:redesign|transformation|concept|preview|pattern)/i,
  /(?:wallpaper\s+.*on\s+(?:my\s+)?(?:wall|room))/i,
  /(?:bunu\s+.*dönüştür|yeniden\s+tasarla|böyle\s+görünmesini\s+sağla|nasıl\s+durur\s+göster|tasarım\s+önerisi\s+oluştur)/i,
  /(?:أعد\s+تصميم|حول\s+.*|غير\s+تصميم|صمم\s+لي|كيف\s+يبدو)/u,
];

const SUPPORT_OR_QA_PATTERNS = [
  /(?:damaged|broken|defect|faulty|error|malfunction|not\s+working|won't\s+turn\s+on|issue|problem)/i,
  /(?:what\s+does\s+this\s+mean|what\s+is\s+written\s+here|read\s+this|explain\s+this\s+screen|why\s+is\s+this\s+blinking)/i,
  /(?:invoice|receipt|order\s+slip|bill|tracking\s+number|fatura|dekont|kargo\s+fişi)/i,
  /(?:hasarlı|kırık|bozuk|arızalı|çalışmıyor|hata|bu\s+ne\s+anlama\s+geliyor|ekranda\s+ne\s+yazıyor)/i,
];

const CATALOG_REFERENCE = /\b(?:catalog(?:ue)?|inventory|your\s+(?:products?|items?|options?))\b|(?:katalog|ürünleriniz|urunleriniz)|(?:كتالوج|منتجاتكم)/iu;
const DIFFERENT_OPTION = /\b(?:another|different|alternative|other\s+(?:one|option|product|item))\b|(?:başka|farklı|baska|farkli)|(?:آخر|أخرى|مختلف)/iu;
const VISUAL_CONTINUATION = /\b(?:another|different|alternative|previous|darker|lighter|brighter|style|version|option|matching\s+item)\b|(?:başka|farklı|önceki|koyu|açık|baska|farkli)|(?:آخر|أخرى|مختلف|أغمق|أفتح)/iu;
const ADDITIVE_VISUAL_EDIT = /\b(?:add|include)\s+(?:another|a\s+matching|an\s+additional)\b|(?:başka\s+bir\s+.*ekle|bir\s+.*daha\s+ekle)|(?:أضف\s+.*آخر)/iu;

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
  const hasTransformationVerb = /(?:redesign|transform|make|visualize|edit|modify|change|dönüştür|tasarla|düzenle|değiştir)/i.test(text);

  // 3. Multi-turn context check: Did the assistant ask for a photo on the previous turn?
  const lastAssistantMsg = [...recentHistory].reverse().find((m) => m.role === 'assistant' || m.sender_type === 'ASSISTANT');
  const wasPromptedForPhoto = lastAssistantMsg && /(?:send\s+(?:a\s+)?photo|upload\s+(?:a\s+)?photo|resim\s+gönderin|fotoğraf\s+atın)/i.test(String(lastAssistantMsg.content || ''));

  if (isGenerationPattern || (hasTransformationVerb && (hasTargetImage || hasReferenceImage)) || (wasPromptedForPhoto && hasTargetImage)) {
    const isEdit = /(?:edit|darker|lighter|change|replace|modify|düzenle|değiştir)/i.test(text);
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

  if (groundingContext.entity?.name) {
    sections.push(`[Referenced Product/Entity: ${groundingContext.entity.name}${groundingContext.entity.description ? ` - ${groundingContext.entity.description}` : ''}]`);
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
  const catalogRequested = CATALOG_REFERENCE.test(String(message)) || Boolean(previousCatalog && VISUAL_CONTINUATION.test(String(message)));
  const requireDifferentEntity = Boolean(catalogRequested && DIFFERENT_OPTION.test(String(message)));

  let classification = classifyVisualIntent({
    message,
    hasTargetImage: images.length > 0,
    hasReferenceImage: images.length > 1,
    hasDocument: false,
    recentHistory,
  });
  if (!classification.isSupport && !classification.isVisualGeneration && previousJob && VISUAL_CONTINUATION.test(String(message))) {
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
      && /^image\/(?:png|jpeg|webp)$/.test(String(media.mime_type))));
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
    }).sort((a, b) => b.matches - a.matches || String(a.entry.id).localeCompare(String(b.entry.id)));
    if (ranked[0]?.matches > 0 && ranked[0].matches > (ranked[1]?.matches || 0)) selected = ranked[0].entry;
  }
  if (!selected) return { state: 'CLARIFICATION_REQUIRED' };

  const media = selected.approved_media.filter((item) => UUID_REGEX.test(String(item.id))
    && String(item.storage_key || '').startsWith(`knowledge/${tenantId}/`)
    && /^image\/(?:png|jpeg|webp)$/.test(String(item.mime_type))).slice(0, 3);
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

