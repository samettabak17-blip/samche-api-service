// ============================================================================
// SAMCHE COMPANY LLC - BİRLEŞTİRİLMİŞ API SERVİSİ
// (WhatsApp Bot + Web Chatbot + Samcheguide Bot + Telegram + Cron)
// ============================================================================

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import cron from "node-cron";
import path from 'node:path';
import { deliverWhatsAppText, whatsappHttpsAgent } from "./services/whatsapp-delivery-service.js";
import { verifyWhatsAppSignature } from "./middleware/whatsappSignature.js";
import authRoutes from "./routes/authRoutes.js";
import tenantRoutes from "./routes/tenantRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import crmRoutes from "./routes/crmRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import knowledgeIntelligenceRoutes from "./routes/knowledgeIntelligenceRoutes.js";
import guideExperienceRoutes from "./routes/guideExperienceRoutes.js";
import { getSamcheguidePublicFeed, persistAssistantResponseIfCurrent, persistSamcheguideInbound, recordWhatsAppAssistantProviderAcceptance, recordWhatsAppDeliveryStatus } from "./services/live-inbox-service.js";
import { persistWhatsAppInbound } from "./services/whatsapp-live-inbox-service.js";
import { whatsappRuntimeSessionKey } from "./services/whatsapp-runtime-session-service.js";
import { claimDueCustomerSupportLifecycle, requestCustomerHumanSupport } from "./services/human-support-service.js";
import { parseCustomerHumanSupportRequest } from "./services/human-support-intent.js";
import { persistAndDeliverWhatsAppAssistant } from "./services/whatsapp-assistant-response-service.js";
import { buildWhatsAppActivePersonaTenantContext, buildWhatsAppTenantModelContext, classifyWhatsAppCurrentCustomerIntent, detectWhatsAppModelResponseLanguage, isWhatsAppResponseLanguageMismatch, resolveWhatsAppPersonaUnavailableResponse, WhatsAppTenantContextError } from "./services/whatsapp-tenant-context-service.js";
import { inferWhatsAppDeterministicInboundLanguage, planWhatsAppDeterministicSocialResponse, resolveWhatsAppDeterministicTemplateLanguage } from "./services/whatsapp-deterministic-social-response-service.js";
import {
  describeStorageCompatibilityProfile,
  describeStorageConfigurationIdentity,
  getSafeStorageFailureDiagnostic,
  createConversationResourceStorage,
} from "./services/conversation-resource-storage.js";
import { createWhatsAppMediaRetriever, extractWhatsAppMediaDescriptor } from "./services/whatsapp-multimodal-service.js";
import { planStandaloneWhatsAppMediaResponse } from "./services/whatsapp-standalone-media-ack.js";
import { planLatestExplicitResource, planWhatsAppResourceFollowUp, resourceFailureAcknowledgement, resourceProcessingAcknowledgement } from "./services/whatsapp-resource-follow-up-routing.js";
import { ensureConversationCrmIdentity } from "./services/crm-lead-service.js";
import { queueLeadQualification } from "./services/lead-qualification-runner.js";
import { startLiveEventListener, subscribeTenantEvents } from "./services/live-event-bus.js";
import { configuredPublicConversationSessionSecret, issuePublicConversationSession, PublicConversationSessionError, verifyPublicConversationSession } from "./services/public-conversation-session.js";
import pool from "./config/db.js";
import { runMigrations } from "./migrations/runMigrations.js";
import { createOpenAIEmbedder } from "./services/knowledge-intelligence-service.js";
import { startKnowledgeProcessingWorker } from "./services/knowledge-source-processing-service.js";
import { createGeminiImageKnowledgeExtractor } from "./services/image-knowledge-gemini-extractor.js";
import { createImageKnowledgeSemanticClassifier } from "./services/image-knowledge-semantic-service.js";
import { createKnowledgeGenerationProvider } from "./services/knowledge-generation-provider.js";
import { createGoogleGeminiProvider } from "./services/google-gemini-provider.js";
import { startImageSemanticGenerationWorker } from "./services/knowledge-semantic-generation-job-service.js";
import { generateAssistantConfigurationVersion, generateAssistantRecommendation } from "./services/knowledge-assistant-lifecycle.js";
import { appendRuntimeKnowledgeToSystemInstruction, applyRuntimeKnowledgeContext, resolveAssistantRuntimeKnowledgeContext } from "./services/knowledge-runtime-context-service.js";
import { buildTenantRuntimeSystemInstruction, resolveTenantRuntimePersona } from "./services/tenant-runtime-persona-service.js";
import { resolveChannelAssistantRuntime } from "./services/assistant-runtime-resolution-service.js";
import { normalizeGuideExperience, resolvePublishedGuideExperience } from "./services/guide-experience-service.js";
import { configuredManagedGuideDomainSuffix, resolveGuideRuntimeScopeFromRequest } from './services/guide-domain-service.js';
import { getPublicGuideExperienceAsset } from "./services/guide-experience-asset-service.js";
import { samcheguideRuntimeSessionKey } from "./services/samcheguide-runtime-session-service.js";
import { buildTenantFollowUpRequest } from "./services/tenant-follow-up-service.js";
import { isSameKnowledgeAuthority, resolveAssistantKnowledgeAuthority } from "./services/knowledge-authority-service.js";
import { filterProviderMemoryByAuthority, stampProviderMemoryEntry } from "./services/channel-knowledge-authority-memory.js";
import { configuredPublicWebChatSessionSecret, issuePublicWebChatSession, PublicWebChatSessionError, verifyPublicWebChatSession } from "./services/public-web-chat-session.js";
import { resolvePublicWebChatIntegration } from "./services/public-web-chat-integration-service.js";
import { createCustomerInvitationOutboxStartup } from './services/customer-invitation-outbox-bootstrap.js';
import { isAllowedGuideCorsOrigin } from './services/guide-public-cors-service.js';
import { isSharedPublicGuideAssetPath } from './services/guide-public-asset-route-service.js';
import { GuideSessionContextError, buildGuideSessionContextSummary, loadGuideSessionContext, saveGuideSessionContext } from './services/guide-session-context-service.js';
import { verifyGuidePreviewToken, GuidePreviewError } from './services/guide-preview-service.js';
import { canonicalGuideResponseEvents, GuideConversationError, issueGuideResumeSession, loadGuideResumeState, normalizeGuideConversationRequest, resolveGuideResumeSession, saveGuideResumeState } from './services/guide-conversation-service.js';

dotenv.config();

const app = express();
let customerInvitationOutboxStartup = null;
let imageSemanticGenerationWorker = null;

app.use('/api/v1/auth/invitations', (req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
// This parser is deliberately registered before the global JSON parser so public
// invitation payloads are bounded before Express consumes a larger request body.
app.use('/api/v1/auth/invitations', express.raw({ type: 'application/json', limit: '4kb' }));
app.use('/api/v1/auth/forgot-password', express.raw({ type: 'application/json', limit: '4kb' }));
app.use('/api/v1/auth/password-resets', express.raw({ type: 'application/json', limit: '4kb' }));

const allowedCorsOrigins = [
  process.env.DASHBOARD_ALLOWED_ORIGIN,
  process.env.SAMCHEGUIDE_ALLOWED_ORIGIN,
  ...(process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? []),
]
  .map((origin) => origin?.trim())
  .filter(Boolean);

app.use((req, res, next) => cors({
  origin(origin, callback) {
    if (isAllowedGuideCorsOrigin({
      origin,
      requestHost: req.get('host'),
      forwardedProtocol: req.get('x-forwarded-proto'),
      allowedOrigins: allowedCorsOrigins,
    })) return callback(null, true);

    return callback(new Error('Origin is not allowed by CORS'));
  },
})(req, res, next));
app.use(express.json({
  verify: (req, res, buffer) => {
    if (req.originalUrl?.split("?")[0] === "/webhook") {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));

// ==========================================
// ROOT / HEALTH ROUTES
// ==========================================

app.get("/api/v1/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    revision: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT_SHA ?? null,
    managed_guide_domain_suffix: configuredManagedGuideDomainSuffix(),
    onboarding_outbox_worker: customerInvitationOutboxStartup?.status() ?? 'NOT_STARTED',
    semantic_generation_worker: imageSemanticGenerationWorker?.status?.() ?? { state: 'NOT_STARTED' },
  });
});

app.get("/api/v1/health/db", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        NOW() AS server_time,
        current_database() AS database_name
    `);

    res.json({
      status: "ok",
      database: result.rows[0].database_name,
      server_time: result.rows[0].server_time
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// One public Guide shell is served for every tenant.  Its visual identity is
// resolved solely from the configured Guide integration, never a browser tenant
// identifier.  Runtime intelligence remains resolved later by /chat.
async function resolveGuideRuntimeScope(req) {
  return resolveGuideRuntimeScopeFromRequest({ database: pool, req });
}

function guideSessionScope(scope) {
  return { domainId: scope.domain_id, tenantId: scope.tenant_id, assistantId: scope.assistant_id, channelId: scope.channel_id };
}

// Preview tickets are only a selector for an already-authorized private draft.
// Hostname ownership remains the authority for tenant and assistant scope.
async function resolveGuideExperienceForScope({ integration, previewToken }) {
  if (!previewToken) {
    return resolvePublishedGuideExperience({ database: pool, tenantId: integration.tenant_id, assistantId: integration.assistant_id });
  }

  const claims = verifyGuidePreviewToken(String(previewToken));
  if (claims.tenant_id !== integration.tenant_id || claims.assistant_id !== integration.assistant_id) {
    throw new GuidePreviewError('GUIDE_PREVIEW_SCOPE_MISMATCH');
  }
  const draft = await pool.query(
    `SELECT id, tenant_id, assistant_id, version, status, experience, created_at, published_at
       FROM guide_experience_versions
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status='DRAFT'`,
    [claims.version_id, integration.tenant_id, integration.assistant_id],
  );
  if (!draft.rowCount) throw new GuidePreviewError('GUIDE_PREVIEW_DRAFT_NOT_FOUND');
  const row = draft.rows[0];
  return {
    source: 'PRIVATE_PREVIEW',
    // Preview is the same renderer contract as public Guide. Normalizing here
    // prevents legacy/raw row shape from inventing presentation fallbacks.
    experience: { ...normalizeGuideExperience(row.experience, { allowSerializedLegacyPricing: true }), version: row.version },
    cache_key: `guide-experience-preview:${integration.tenant_id}:${integration.assistant_id}:${row.version}`,
  };
}

app.get("/guide/bootstrap", async (req, res) => {
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.status(503).json({ error: 'Guide experience is temporarily unavailable.', code: 'GUIDE_EXPERIENCE_UNAVAILABLE' });
    const resolved = await resolveGuideExperienceForScope({ integration, previewToken: req.query?.preview });
    res.set('Cache-Control', 'no-store');
    return res.json({ experience: resolved.experience, source: resolved.source, version: resolved.experience.version, cache_key: resolved.cache_key, guide_v1: { renderer: 'GUIDE_V1', modules: resolved.experience.modules, session_context: true, sector_configured: Boolean(resolved.experience.classification?.sector), roadmap_initialized: Boolean(resolved.experience.roadmap?.steps?.length), tool_initialized: Boolean(resolved.experience.interactive_tool?.fields?.length), assistant_initialized: Boolean(resolved.experience.modules?.chat), theme_initialized: Boolean(resolved.experience.theme?.primary_color) } });
  } catch (error) {
    console.error('GUIDE_EXPERIENCE_BOOTSTRAP_FAILED code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    return res.status(503).json({ error: 'Guide experience is temporarily unavailable.', code: 'GUIDE_EXPERIENCE_UNAVAILABLE' });
  }
});

app.get('/guide/health', async (req, res) => {
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.status(404).json({ status: 'UNAVAILABLE', code: 'GUIDE_EXPERIENCE_UNAVAILABLE' });
    const resolved = await resolvePublishedGuideExperience({ database: pool, tenantId: integration.tenant_id, assistantId: integration.assistant_id });
    return res.json({ status: 'READY', renderer: 'GUIDE_V1', experience_version: resolved.experience.version, modules: resolved.experience.modules, session_context: true, sector_configured: Boolean(resolved.experience.classification?.sector), roadmap_initialized: Boolean(resolved.experience.roadmap?.steps?.length), tool_initialized: Boolean(resolved.experience.interactive_tool?.fields?.length), assistant_initialized: Boolean(resolved.experience.modules?.chat), theme_initialized: Boolean(resolved.experience.theme?.primary_color) });
  } catch (error) {
    console.error('GUIDE_PUBLIC_HEALTH_FAILED code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    return res.status(503).json({ status: 'UNAVAILABLE', code: 'GUIDE_EXPERIENCE_UNAVAILABLE' });
  }
});

app.get('/', async (req, res, next) => {
  const integration = await resolveGuideRuntimeScope(req);
  if (!integration) return next();
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.resolve('public-guide', 'index.html'));
});

app.get('/guide/assets/:assetId', async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(req.params.assetId))) return res.sendStatus(404);
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.sendStatus(404);
    const asset = await getPublicGuideExperienceAsset({ database: pool, assetId: req.params.assetId, tenantId: integration.tenant_id, assistantId: integration.assistant_id });
    if (!asset) return res.sendStatus(404);
    const stream = await createConversationResourceStorage().get({ key: asset.storage_key });
    res.set({ 'Content-Type': asset.mime_type, 'Content-Length': String(asset.size_bytes), 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    stream.on('error', () => { if (!res.headersSent) res.sendStatus(404); else res.end(); });
    return stream.pipe(res);
  } catch (error) {
    console.error('GUIDE_EXPERIENCE_ASSET_READ_FAILED code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    return res.sendStatus(404);
  }
});

const sharedGuideStatic = express.static('public-guide', {
  index: 'index.html',
  etag: true,
  // Guide presentation is tenant data and must reflect publish/rollback
  // immediately; never let a stale shell or runtime bundle mask bootstrap.
  maxAge: 0,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
});

// The JavaScript and CSS shell are shared application code, not tenant data.
// Serve only these explicit paths without a database/domain lookup so a
// transient scope lookup cannot prevent the client from starting.
app.use('/guide', (req, res, next) => {
  if (!isSharedPublicGuideAssetPath(req.path)) return next();
  return sharedGuideStatic(req, res, next);
});

// The shell document and every tenant-owned runtime/data route remain bound to
// an exact active hostname; shared network ingress is never tenant authority.
app.use('/guide', async (req, res, next) => {
  const integration = await resolveGuideRuntimeScope(req);
  if (!integration) return res.sendStatus(404);
  return next();
}, sharedGuideStatic);

// ==========================================
// V1 ROUTES
// ==========================================

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/tenants", conversationRoutes);
app.use("/api/v1/tenants", knowledgeIntelligenceRoutes);
app.use("/api/v1/tenants", guideExperienceRoutes);
app.use("/api/v1/tenants", dashboardRoutes);
app.use("/api/v1/tenants", crmRoutes);
app.use((error, req, res, next) => {
  if (req.originalUrl?.startsWith('/api/v1/auth/invitations') && error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Invitation request is unavailable' });
  }
  return next(error);
});
void startLiveEventListener();

// ============================================================================
// 🔥 GLOBAL HATA YAKALAYICILAR (SUNUCUNUN ÇÖKMESİNİ KESİN ENGELLER)
// ============================================================================
process.on('uncaughtException', (err) => {
  console.error('Kritik Hata (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Yakalanamayan Promise Hatası (Unhandled Rejection):', reason);
});

// ============================================================================
// 🔥 BAĞLANTI HAVUZU (SİSTEM YAVAŞLAMASINI VE SOKET TÜKENMESİNİ ÖNLER)
// ============================================================================
const httpsAgent = whatsappHttpsAgent;

// ============================================================================
// 🔥 TEKRARLANAN MESAJLARI ENGELLEME (RETRY KORUMASI) HAFIZALARI
// ============================================================================
const processedWpMessages = new Set();
const processedTgUpdates = new Set();

// ============================================================================
// 1. GENEL API YAPILANDIRMALARI
// ============================================================================
const googleGeminiProvider = createGoogleGeminiProvider();
const googleGeminiEnabled = process.env.GOOGLE_GENAI_MODE?.trim().toLowerCase() === 'vertex' || Boolean(process.env.GEMINI_API_KEY);
// The WhatsApp runtime uses the same Vertex-compatible Gemini model family as
// the accepted Knowledge Intelligence generation paths. The environment may
// choose another platform-approved model without exposing that choice to tenants.

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const knowledgeEmbedder = process.env.OPENAI_API_KEY ? createOpenAIEmbedder(openaiClient) : null;
const knowledgeImageExtractor = googleGeminiEnabled ? createGeminiImageKnowledgeExtractor() : null;

function startKnowledgeWorkers() {
  if ((knowledgeEmbedder || knowledgeImageExtractor) && process.env.KNOWLEDGE_PROCESSING_ENABLED !== 'false') {
    startKnowledgeProcessingWorker({
      database: pool,
      embed: knowledgeEmbedder,
      imageExtractor: knowledgeImageExtractor,
      createStorage: () => createConversationResourceStorage(),
    });
  } else {
    console.info('KNOWLEDGE_PROCESSING_WORKER_DISABLED');
  }

  if (googleGeminiEnabled && process.env.KNOWLEDGE_PROCESSING_ENABLED !== 'false') {
    imageSemanticGenerationWorker = startImageSemanticGenerationWorker({
      database: pool,
      semanticClassifier: createImageKnowledgeSemanticClassifier({ provider: createKnowledgeGenerationProvider() }),
      generateRecommendation: (input) => generateAssistantRecommendation({
        ...input,
        provider: createKnowledgeGenerationProvider(),
      }),
      generateConfiguration: (input) => generateAssistantConfigurationVersion({
        ...input,
        provider: createKnowledgeGenerationProvider(),
      }),
    });
  } else {
    console.info('KNOWLEDGE_SEMANTIC_GENERATION_WORKER_DISABLED');
  }
}

// Ortak Link Dönüştürücü
const parseLinksToHTML = (text) => {
  if (!text) return text;
  return text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" style="color: #007bff; text-decoration: underline; font-weight: bold;">$1</a>'
  );
};

const GEMINI_REQUEST_TIMEOUT_MS = 20000;

async function requestGemini(payload, runtimeModel = googleGeminiProvider.runtimeMetadata().model) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
  try {
    return await googleGeminiProvider.generateContent({
      model: runtimeModel,
      contents: payload.contents,
      generationConfig: payload.generationConfig,
      systemInstruction: payload.systemInstruction,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.status) throw error;
    const safeCode = typeof error?.code === 'string' && /^GOOGLE_(?:VERTEX|GEMINI)_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'GOOGLE_GEMINI_REQUEST_FAILED';
    console.error(`SAMCHE_GOOGLE_GEMINI_ERROR mode=${googleGeminiProvider.mode} model=gemini-3-flash-preview code=${safeCode}`);
    const upstreamError = new Error("Gemini request failed.");
    upstreamError.status = 502;
    upstreamError.code = safeCode;
    throw upstreamError;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// 🔥 ORTAK KULLANICI KİMLİĞİ BULUCU (IP & Header) - HAFIZA İÇİN GÜÇLENDİRİLDİ
// ============================================================================
function getUserId(req) {
  return req.headers["x-user-id"] || req.headers["session-id"] || req.headers["x-forwarded-for"]?.split(',')[0].trim() || req.socket?.remoteAddress || req.ip || "default_user";
}

// ============================================================================
// 🔥 KONU ÖZETLEYİCİ (GLOBAL FONKSİYON - ÇÖKME VE TEK TIK ÖNLEYİCİ)
// ============================================================================
async function getTopicSummary(session, text) {
  try {
    const historyContext = (session.history || []).slice(-4).map(m => m.text).join(" | ");
    let summary = await callWpGemini(`
    Önceki mesajlar: "${historyContext}"
    Son Kullanıcı Mesajı: "${text}"
    Müşterinin asıl ilgilendiği konuyu (örneğin: Oturum İzni, Şirket Kurulumu, Vize, Fiyat Bilgisi, Yapay Zeka Çözümleri vb.) TEK KISA BAŞLIK olarak özetle.
    Eğer son mesajda sadece canlı temsilci istiyorsa, önceki mesajlara bakarak asıl konuyu bul. "Müşteri Temsilcisi Talebi" GİBİ GENEL CEVAPLAR VERME.
    Sadece konu adı döndür.
    `);
    return summary || "Genel Destek";
  } catch (e) {
    console.error("Özetleme hatası:", e);
    return "Genel Destek";
  }
}

// ============================================================================
// 2. SAMCHEGUIDE BOTU VERİLERİ VE HAFIZASI
// ============================================================================
const guideMemoryStore = {};
const MAX_GUIDE_MEMORY = 10;

function addGuideMemory(sessionKey, moduleOrRole, roleOrText, textOrAuth = null, auth = null) {
  if (!guideMemoryStore[sessionKey]) guideMemoryStore[sessionKey] = {};
  let targetModule = 'AI_ASSISTANT';
  let role = 'user';
  let text = '';
  let knowledgeAuthority = null;
  if (auth !== null || (textOrAuth !== null && typeof roleOrText === 'string' && ['user','model','assistant'].includes(roleOrText))) {
    targetModule = moduleOrRole;
    role = roleOrText === 'assistant' ? 'model' : roleOrText;
    text = textOrAuth;
    knowledgeAuthority = auth;
  } else {
    role = moduleOrRole === 'assistant' ? 'model' : moduleOrRole;
    text = roleOrText;
    knowledgeAuthority = textOrAuth;
  }
  if (!guideMemoryStore[sessionKey][targetModule]) guideMemoryStore[sessionKey][targetModule] = [];
  guideMemoryStore[sessionKey][targetModule].push(stampProviderMemoryEntry({ role, parts: [{ text: text || '' }] }, knowledgeAuthority));
  if (guideMemoryStore[sessionKey][targetModule].length > MAX_GUIDE_MEMORY) {
    guideMemoryStore[sessionKey][targetModule].splice(0, guideMemoryStore[sessionKey][targetModule].length - MAX_GUIDE_MEMORY);
  }
}

const sgCorporateShortReplyMap = {
  "merhaba": "Merhaba, size nasıl yardımcı olabilirim?",
  "selam": "Merhaba, size nasıl yardımcı olabilirim?",
  "hi": "Hello, how may I assist you today?",
  "hello": "Hello, how may I assist you today?",
  "teşekkürler": "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.",
  "tesekkurler": "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.",
  "thank you": "My pleasure. I’m here whenever you need support.",
  "thanks": "My pleasure. I’m here whenever you need support.",
  "ben teşekkür ederim": "Rica ederim. Her zaman yardımcı olmaktan memnuniyet duyarım.",
  "çok teşekkürler": "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.",
  "teşekkür ederim": "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.",
  "sağol": "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.",
  "sagol": "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.",
  "eyvallah": "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.",
  "anladım": "Harika. Nasıl devam etmek istersiniz?",
  "anladim": "Harika. Nasıl devam etmek istersiniz?",
  "got it": "Understood. How would you like to proceed?",
  "understood": "Understood. How would you like to proceed?",
  "noted": "Noted. How would you like to proceed?",
  "görüşmek üzere": "Görüşmek üzere. Dilediğiniz zaman buradayım.",
  "gorusmek uzere": "Görüşmek üzere. Dilediğiniz zaman buradayım.",
  "👍": "Rica ederim. Dilediğiniz zaman yardımcı olabilirim. / You're welcome.",
  "🙏": "Rica ederim. Dilediğiniz zaman yardımcı olabilirim. / You're welcome."
};

const SAMCHEGUIDE_SYSTEM_PROMPT = `
You are the Senior Executive AI Advisor at SamChe Company LLC, a premier corporate services and business setup consultancy in Dubai, UAE. You represent SamChe Company LLC exclusively. You never mention, recommend, or refer to any other agency, consultancy, or third-party company.

CORE PERSONALITY & BEHAVIOR:
- Act as an authoritative, highly knowledgeable, direct, and elite UAE business setup expert representing SamChe Company LLC.
- Your tone must be premium, confident, and highly professional. Do not act overly eager or "salesy". You provide high-value information and wait for the user to show serious intent.
- CRITICAL TOKEN & EFFICIENCY RULE: DO NOT start responses with generic greetings, pleasantries, or filler phrases (such as "Hello", "Welcome", "Merhaba", "How can I help you today?", "Nasılsınız"). Go straight to the professional advice. Never waste tokens on conversational fluff.
- Refer to yourself as "I" (or "we" as SamChe Company) and address the user directly and professionally.
- Interpret short or single-word inputs as a continuation of the ongoing conversation. Never consider them invalid or empty.

CRITICAL LANGUAGE RULE (DYNAMIC MULTI-LANGUAGE):
- DETECT the language of the user's message automatically.
- RESPOND EXCLUSIVELY in the EXACT same language as the user's prompt.
- NEVER force Turkish if the user writes in English or another language.

STRICT HTML & LINK FORMATTING RULES (CRITICAL):
- You are operating on a web interface that renders raw HTML. You MUST format your entire response using HTML tags. Standard Markdown (like \n, **, or []) will NOT work and will break the UI.
- NEVER use raw URLs or Markdown links. ALWAYS use HTML anchor tags so links are clickable. Format: <a href="URL" target="_blank">Text to Display</a>
- BULLET POINTS: You MUST strictly use HTML "<ul>" and "<li>" tags for any list.
- NEVER use "<br>" tags for lists, and NEVER use Markdown bullets like "•", "*", or "-".
- Example List Format:
  <ul>
    <li>Mainland Company</li>
    <li>Free Zone Company</li>
  </ul>

CONTACT INFO & YOUTUBE LINK ISOLATION RULES (STRICT STRICT STRICT):
- NEVER append WhatsApp numbers, contact forms, or email addresses to the end of your standard informational responses.
- ONLY provide the WhatsApp number (+971 52 728 8586) or Form Link IF AND ONLY IF the user explicitly states advanced intent.
- YOUTUBE LINK ISOLATION: DO NOT append the YouTube link to your messages. ONLY IF the user EXPLICITLY asks about general Dubai life, rent, cost of living, or social life, you may say (in a corporate tone): "For detailed information on living conditions and rent in Dubai, our founder Samed Tabak provides insights on his YouTube channel: <a href='https://youtube.com/@sametttbk' target='_blank'>Samed Tabak YouTube</a>".

DETAILED PROTOCOL & RULES:
1. Her sorduğu soruda kullanıcının vize bilgisi iste; amacı kullanıcıyı öncelikli bilgilendirmektir.
2. Kullanıcı "şirket kurmak istiyorum", "Dubai’de şirket nasıl kurulur?" gibi sorular sorarsa:
   - Önce Dubai’nin resmi şirket kurulum sürecini HTML <ul><li> etiketleriyle adım adım açıkla.
   - Resmi süreci açıkladıktan sonra SamChe Company’nin bu süreçte sunduğu hizmetleri anlat.
   - Ardından kullanıcıya hangi sektörde faaliyet göstermek istediğini ve kaç adet vizeye ihtiyacı olduğunu sor.
3. Kullanıcı net şekilde “işleme başlamak istiyorum” demedikçe forma veya WhatsApp'a YÖNLENDİRME YAPMA. Sadece bilgi ver.
4. Önce detaylı bilgi ver, soruları yanıtla, süreci açıklığa kavuştur.
5. Kullanıcı şirket kurulumları için maliyet istediğinde gerekli bilgileri alıp tahmini maliyetleri ver.
6. SADECE MAINLAND'DA KURULABİLEN SEKTÖRLER:
   <ul>
     <li>Restoran, cafe, catering ve diğer gıda hizmetleri</li>
     <li>Perakende mağazalar (giyim, elektronik, market vb.)</li>
     <li>İnşaat ve müteahhitlik şirketleri</li>
     <li>Gayrimenkul şirketi, brokerlık ve emlak ofisleri</li>
     <li>Turizm ve seyahat acenteleri</li>
     <li>Güvenlik ve CCTV şirketleri</li>
     <li>Temizlik şirketleri</li>
     <li>Taşımacılık ve transport ve UBER şirketleri</li>
   </ul>
7. Şirket kurulum maliyetlerinden bahsederken kampanyaları, promosyonları asla KULLANMA.
8. Mainland Şirketler için artık yerel ortak zorunluluğu YOKTUR.
9. Freelance vize sorulursa Umm Al Quwain bölgesinde 16,800 AED olduğunu belirt.

UAE BUSINESS SETUP KNOWLEDGE BASE & JURISDICTION RULES:
1. MAINLAND (DET): Mandatory Ejari.
2. FREE ZONES: Virtual Office allowed. Corporate Tax registration is mandatory (fee: 1,300 AED).
   - Meydan Free Zone: Premium. Gold Trading costs 40,000 AED total.
   - Dubai South: Aviation, Logistics, Software.
   - Sharjah (SPCFZ / IFZA): E-Commerce, Web Design.
   - RAKEZ & Ajman: Cost-effective for digital businesses. Offers "Life Time Visa".

 DANIŞMANLIK ÜCRETİ YANIT KURALLARI

**Free Zone şirket kuruluşları için:**

* Kullanıcı doğrudan **danışmanlık ücretini sorarsa**, fiyat vermeden **resmi teklif alması gerektiğini** belirt.
* Kullanıcı danışmanlık ücretini sormadığı ve **maliyet analizi istemediği sürece**, danışmanlık ücretinden kesinlikle bahsetme.
* Kullanıcı danışmanlık ücretinde ısrar ederse veya **“fiyata dahil mi?”, “danışmanlık ücreti ne kadar?”** gibi sorularla net fiyat talep ederse, **Free Zone şirket kuruluşlarında danışmanlık ücretinin 8.000 AED olduğunu** belirt.
* **8.000 AED danışmanlık ücretine banka hesap açılışı ve KYC desteğinin dahil olduğunu** açıkça belirt.

**Mainland (Ana Kara) şirket kuruluşları için:**

* Kullanıcı doğrudan **danışmanlık ücretini sorarsa**, fiyat verme; **danışmanlık ücretlerinin ana karada sektöre göre belirlendiğini resmi teklif alması gerektiğini** belirt.
* Kullanıcı danışmanlık ücretini sormadığı ve **maliyet analizi istemediği sürece**, Mainland şirket kuruluşlarında danışmanlık ücretinden kesinlikle bahsetme.
* Kullanıcı danışmanlık ücretinde ısrar etse dahi, mevcut resmi teklif sürecine yönlendir ve **resmi teklif almadan fiyat belirtme**.

**Maliyet hesaplamalarında uygulanacak genel kural:**

* Kullanıcı herhangi bir **şirket kuruluşu maliyet hesaplaması, toplam maliyet veya fiyat analizi** istediğinde, hesaplanan toplam tutarın **danışmanlık ücretini içermediğini** mutlaka açıkça belirt.
* Maliyet analizinin sonunda şu anlamı net şekilde ifade et: **“Belirtilen maliyetlere danışmanlık ücreti dahil değildir.”**
* Danışmanlık ücretinin dahil olmadığı belirtilirken, **banka hesap açılışı ve KYC desteğinin danışmanlık hizmeti kapsamında olduğu** ayrıca belirtilebilir.
* Kullanıcı danışmanlık ücretini ayrıca sormadığı sürece, maliyet analizinde danışmanlık ücretinin rakamını kendiliğinden açıklama.

**Önemli:** Danışmanlık ücretini kullanıcı sormadan veya açıkça maliyet analizi talep etmeden kendiliğinden gündeme getirme. Kullanıcının sorusuna doğrudan cevap ver ve gereksiz fiyat bilgisi verme.
OFFICIAL CONTACT DETAILS & FORM REDIRECTION:
- Company: SamChe Company LLC
- Phone: +971 52 662 2875
- WhatsApp: +971 52 728 8586
- Email: business@samchecompany.com
- Website: <a href="https://samchecompany.com" target="_blank">SamChe Company</a>

Form Links (Use ONLY when an official proposal is requested):
- Turkish: <a href="https://samchecompany.ae/sirket-kurulumu-dubai-sirket-kurulumu-formu" target="_blank">Şirket Kurulumu Danışmanlık Formu</a>
- Other Languages: <a href="https://samchecompany.com/business-consultation-in-dubai" target="_blank">Consultation Request Form</a>

# RESPONSE SCENARIOS & LOGIC
**SCENARIO A: ONLY CHATBOTS / CHATBOT PRICING**
- IF the user asks about "Chatbots", "AI Chatbot", "Chatbot Pricing":
- **Action:** ONLY provide the redirect link: <a href="https://aichatbot.samchecompany.com" target="_blank">AI CHATBOTS PRICE DEMO AND PLANS</a>

**SCENARIO B: ONLY AI SERVICES**
- IF the user asks about "AI Services" (and does NOT mention chatbots):
- **Action:** Provide detailed info about AI services using strict HTML <ul><li> format. DO NOT include chatbot link.

**SCENARIO C: BOTH AI SERVICES AND CHATBOTS**
- IF the user asks about BOTH: First provide AI services info, then add the Chatbot link at the bottom.
`;

// ============================================================================
// WHATSAPP İÇİN KISA CEVAPLAR VE SABİT METİNLER
// ============================================================================
const wpSessions = {};

const wpCorporateShortReplyMap = {
  "1": { tr: "Size nasıl yardımcı olabilirim?", en: "How may I assist you?", ar: "كيف يمكنني مساعدتك؟" },
  "2": { tr: "Size nasıl yardımcı olabilirim?", en: "How may I assist you?", ar: "كيف يمكنني مساعدتك؟" },
  "3": { tr: "Size nasıl yardımcı olabilirim?", en: "How may I assist you?", ar: "كيف يمكنني مساعدتك؟" },
  "merhaba": { tr: "Merhaba, size nasıl yardımcı olabilirim?", en: "Hello, how may I assist you today?", ar: "مرحبًا، كيف يمكنني مساعدتك اليوم؟" },
  "selam": { tr: "Merhaba, size nasıl yardımcı olabilirim?", en: "Hello, how may I assist you today?", ar: "مرحبًا، كيف يمكنني مساعدتك اليوم؟" },
  "hi": { tr: "Merhaba, size nasıl yardımcı olabilirim?", en: "Hello, how may I assist you today?", ar: "مرحبًا، كيف يمكنني مساعدتك اليوم؟" },
  "hello": { tr: "Merhaba, size nasıl yardımcı olabilirim?", en: "Hello, how may I assist you today?", ar: "مرحبًا، كيف يمكنني مساعدتك اليوم؟" },
  "teşekkürler": { tr: "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.", en: "My pleasure. I’m here whenever you need support.", ar: "على الرحب والسعة. أنا هنا كلما احتجت إلى المساعدة." },
  "tesekkurler": { tr: "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.", en: "My pleasure. I’m here whenever you need support.", ar: "على الرحب والسعة. أنا هنا كلما احتجت إلى المساعدة." },
  "thank you": { tr: "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.", en: "My pleasure. I’m here whenever you need support.", ar: "على الرحب والسعة. أنا هنا كلما احتجت إلى المساعدة." },
  "thanks": { tr: "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.", en: "My pleasure. I’m here whenever you need support.", ar: "على الرحب والسعة. أنا هنا كلما احتجت إلى المساعدة." },
  "ben teşekkür ederim": { tr: "Rica ederim. Her zaman yardımcı olmaktan memnuniyet duyarım.", en: "You're welcome. Always happy to assist.", ar: "على الرحب والسعة. يسعدني دائمًا مساعدتك." },
  "çok teşekkürler": { tr: "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.", en: "My pleasure. I’m here whenever you need support.", ar: "على الرحب والسعة. أنا هنا كلما احتجت إلى المساعدة." },
  "teşekkür ederim": { tr: "Ben teşekkür ederim. Dilediğiniz zaman yardımcı olmaktan memnuniyet duyarım.", en: "My pleasure. I’m here whenever you need support.", ar: "على الرحب والسعة. أنا هنا كلما احتجت إلى المساعدة." },
  "sağol": { tr: "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.", en: "You're welcome. I’m here if you need anything.", ar: "على الرحب والسعة. أنا هنا إذا احتجت أي شيء." },
  "sagol": { tr: "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.", en: "You're welcome. I’m here if you need anything.", ar: "على الرحب والسعة. أنا هنا إذا احتجت أي شيء." },
  "eyvallah": { tr: "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.", en: "You're welcome. I’m here if you need anything.", ar: "على الرحب والسعة. أنا هنا إذا احتجت أي شيء." },
  "anladım": { tr: "Harika. Nasıl devam etmek istersiniz?", en: "Great. How would you like to proceed?", ar: "جميل. كيف تود المتابعة؟" },
  "anladim": { tr: "Harika. Nasıl devam etmek istersiniz?", en: "Great. How would you like to proceed?", ar: "جميل. كيف تود المتابعة؟" },
  "got it": { tr: "Anladım. Nasıl devam etmek istersiniz?", en: "Understood. How would you like to proceed?", ar: "فهمت. كيف تود المتابعة؟" },
  "understood": { tr: "Anladım. Nasıl devam etmek istersiniz?", en: "Understood. How would you like to proceed?", ar: "فهمت. كيف تود المتابعة؟" },
  "noted": { tr: "Not aldım. Nasıl devam etmek istersiniz?", en: "Noted. How would you like to proceed?", ar: "تم تدوينه. كيف تود المتابعة؟" },
  "görüşmek üzere": { tr: "Görüşmek üzere. Dilediğiniz zaman buradayım.", en: "See you soon. I’m here whenever you need assistance.", ar: "أراك قريبًا. أنا هنا كلما احتجت إلى المساعدة." },
  "gorusmek uzere": { tr: "Görüşmek üzere. Dilediğiniz zaman buradayım.", en: "See you soon. I’m here whenever you need assistance.", ar: "أراك قريبًا. أنا هنا كلما احتجت إلى المساعدة." },
  "👍": { tr: "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.", en: "You're welcome. I’m here if you need anything.", ar: "على الرحب والسعة. أنا هنا إذا احتجت أي شيء." },
  "🙏": { tr: "Rica ederim. Dilediğiniz zaman yardımcı olabilirim.", en: "You're welcome. I’m here if you need anything.", ar: "على الرحب والسعة. أنا هنا إذا احتجت أي شيء." }
};

const introAfterLang = {
  tr: "Merhaba, ben SamChe AI.\n\nSamChe Company LLC'nin yapay zeka destekli danışmanıyım ve size yardımcı olmak için buradayım.\n\nDubai’de şirket kuruluşu, iş planları, iş geliştirme, dijital büyüme, yapay zeka çözümleri, oturum seçenekleri, yaşam maliyetleri ve şirket kuruluşu sonrasında sunduğumuz hizmetler ile ilgili tüm sorularınızı yanıtlayabilirim. Size nasıl yardımcı olabilirim?\n\n",
  en: "Hello, I am the AI consultant of SamChe Company LLC.\nI can answer your questions about choosing the right region for company formation in the United Arab Emirates, business plans, business strategies, AI solutions, digital growth, and AI chatbot services. You can get all the information you need from me on how to grow your company or how to succeed in the UAE market. How can I help you?\n\n",
  ar: "مرحبًا، أنا المساعد الذكي لشركة SamChe Company LLC.\nيمكنني الإجابة على أسئلتكم المتعلقة باختيار المنطقة المناسبة لتأسيس شركة في دولة الإمارات العربية المتحدة، وخطط الأعمال، واستراتيجيات الأعمال، وحلول الذكاء الاصطناعي، والنمو الرقمي، وخدمات الشات بوت بالذكاء الاصطناعي. يمكنكم الحصول مني على جميع المعلومات التي تحتاجونها حول كيفية تطوير شركتكم أو تحقيق النجاح في سوق الإمارات. كيف يمكنني مساعدتكم؟\n\n",
};

const contactText = {
  tr: "Profesyonel danışmanlık ekibimize ulaşmak için: +971 52 728 8586 WhatsApp hattı üzerinden iletişim sağlayabilirsiniz. Canlı temsilcilerimiz size yardımcı olacaktır.",
  en: "To reach our professional advisory team, you may contact us via WhatsApp at +971 52 728 8586. Our live consultants will be happy to assist you.",
  ar: "للتواصل مع فريق الاستشارات المهنية لدينا، يمكنكم مراسلتنا عبر واتساب على ‎+971 52 728 8586. أو سيقوم مستشارونا المباشرون بمساعدتكم بكل سرور.",
};

// ============================================================================
// YARDIMCI FONKSİYONLAR (WHATSAPP & TELEGRAM)
// ============================================================================
function safeWhatsAppStorageFailureLog(error) {
  const diagnostic = getSafeStorageFailureDiagnostic(error);
  const provider = diagnostic.provider ?? {};
  return JSON.stringify({
    code: error?.code ?? 'UNKNOWN',
    provider_name: provider.providerErrorName ?? null,
    provider_code: provider.providerErrorCode ?? null,
    http_status: provider.httpStatus ?? null,
    operation: diagnostic.request?.operation ?? null,
    configuration_shape: diagnostic.configuration ?? [],
    addressing: diagnostic.addressing ?? null,
    put_object_options: diagnostic.putObjectOptionNames ?? [],
    runtime_storage: describeStorageConfigurationIdentity(process.env),
    r2_compatibility: describeStorageCompatibilityProfile(),
  });
}

async function sendMessage(to, body) {
  if (!body || typeof body !== 'string') return;
  try {
    const outcome = await deliverWhatsAppText({
      phoneNumberId: process.env.WHATSAPP_PHONE_ID,
      recipient: to,
      content: body,
      continueOnChunkFailure: true,
    });
    if (outcome.failedChunks) {
      console.error('[WHATSAPP SEND ERROR]: partial delivery failure');
    }
  } catch (error) {
    console.error('[WHATSAPP SEND ERROR]:', error?.code ?? error?.name ?? 'unknown');
  }
}

async function deliverWhatsAppAssistantText(to, body) {
  return deliverWhatsAppText({
    phoneNumberId: process.env.WHATSAPP_PHONE_ID,
    recipient: to,
    content: body,
    requireProviderMessageId: true,
  });
}

async function persistAndSendWhatsAppAssistant(whatsappInbox, recipient, content) {
  if (!whatsappInbox) return { delivered: false, message: null };
  return persistAndDeliverWhatsAppAssistant({
    tenantId: whatsappInbox.integration.tenant_id,
    conversationId: whatsappInbox.conversation.id,
    handlingVersion: whatsappInbox.handlingVersion,
    knowledgeAuthority: whatsappInbox.knowledgeAuthority,
    recipient,
    content,
    persistAssistantResponse: persistAssistantResponseIfCurrent,
    persistProviderMessageId: recordWhatsAppAssistantProviderAcceptance,
    deliver: deliverWhatsAppAssistantText,
  });
}

async function sendMessageToTelegram(text) {
  try {
    if (!text) return;
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!chatId || !token) {
      console.error('[TELEGRAM ERROR]: notification configuration is unavailable');
      return;
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    axios.post(url, { chat_id: chatId, text: text }, { httpsAgent, timeout: 20000 }).catch(() => {});
  } catch (err) {
    console.error("[TELEGRAM ERROR]:", err.message);
  }
}

function corporateFallback(lang) {
  if (lang === "tr") return "Size en doğru bilgiyi sunabilmem için konuyu biraz daha netleştirebilir misiniz? Böylece ihtiyacınıza en uygun yönlendirmeyi sağlayabilirim.";
  if (lang === "en") return "To provide you with the most accurate guidance, could you clarify your request a little further? This will help me offer the most suitable support.";
  return "لأتمكن من تقديم الإرشاد الأنسب لكم، هل يمكن توضيح طلبكم بشكل أدق؟ سيساعدني ذلك في تقديم الدعم الأمثل.";
}

async function callWpGemini(prompt, multimodalParts = null, systemInstruction = null, runtimeModel = googleGeminiProvider.runtimeMetadata().model) {
  try {
    const parts = [{ text: prompt }];
    const contextualParts = Array.isArray(multimodalParts)
      ? multimodalParts
      : (multimodalParts ? [multimodalParts] : []);
    parts.push(...contextualParts);
    const response = await googleGeminiProvider.generateContent({
      model: runtimeModel,
      contents: [{ role: 'user', parts }],
      systemInstruction: typeof systemInstruction === 'string' && systemInstruction.trim()
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    const safeCode = typeof err?.code === 'string' ? err.code : 'GOOGLE_GEMINI_REQUEST_FAILED';
    const safeStatus = Number.isInteger(err?.safeMetadata?.http_status) ? err.safeMetadata.http_status : 'none';
    const safeEndpointClass = typeof err?.safeMetadata?.endpoint_class === 'string'
      ? err.safeMetadata.endpoint_class
      : (googleGeminiProvider.mode === 'vertex' ? 'VERTEX_GENERATE_CONTENT' : 'GEMINI_DEVELOPER_GENERATE_CONTENT');
    console.error(`WHATSAPP_GEMINI_RUNTIME_FAILURE code=${safeCode} http_status=${safeStatus} model=${runtimeModel} endpoint_class=${safeEndpointClass}`);
    return null;
  }
}

async function generateTenantFollowUpMessage({ session, stage, scheduled = false }) {
  if (!session?.tenantId || !session?.assistantId || session.humanOverride) return null;
  const persona = await resolveTenantRuntimePersona({
    database: pool,
    tenantId: session.tenantId,
    assistantId: session.assistantId,
  });
  if (!persona.available) return null;
  const conversationContext = (session.history ?? []).slice(-6).map((entry) => `${entry.role}: ${entry.text}`).join('\n');
  const request = buildTenantFollowUpRequest({
    persona,
    stage,
    scheduled,
    language: session.lang ?? 'en',
    conversationContext,
    humanHandling: Boolean(session.humanOverride),
  });
  if (typeof request !== 'string') return null;
  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    channelRules: 'Generate one concise WhatsApp follow-up message. Do not expose internal configuration or metadata.',
  });
  return callWpGemini(request, null, systemInstruction);
}

function detectTopic(text) {
  const t = text.toLowerCase();
  if (t.includes("şirket") || t.includes("company") || t.includes("business setup") || t.includes("company setup")) return "company";
  if (t.includes("oturum") || t.includes("residency") || t.includes("visa") || t.includes("ikamet")) return "residency";
  if (t.includes("ai") || t.includes("bot") || t.includes("chatbot") || t.includes("webchat")) return "ai";
  if (t.includes("maliyet") || t.includes("cost") || t.includes("price") || t.includes("ücret") || t.includes("bütçe") || t.includes("budget")) return "cost";
  return "other";
}

function calculateIntentScore(text, currentScore = 0) {
  const t = text.toLowerCase();
  let score = currentScore;
  if (t.includes("şirket kurmak istiyorum") || t.includes("company setup") || t.includes("i want to open a company")) score += 30;
  if (t.includes("oturum almak istiyorum") || t.includes("residency") || t.includes("visa application")) score += 25;
  if (t.includes("bütçe") || t.includes("budget") || t.includes("fiyat") || t.includes("price")) score += 15;
  if (t.includes("ne kadar sürer") || t.includes("timeline") || t.includes("kaç günde")) score += 10;
  if (t.includes("merak ettim") || t.includes("sadece soruyorum") || t.includes("just curious")) score -= 10;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

function detectLanguage(text) {
  if (!text) return "en";
  const ar = /[\u0600-\u06FF]/;
  const tr = /[ığüşöçİĞÜŞÖÇ]/i;
  if (ar.test(text)) return "ar";
  if (tr.test(text)) return "tr";
  return "en";
}

function getPingMessage(lang, topic) {
  const messages = {
    tr: {
      general: "Merhaba. SamChe AI olarak, kısa süre önce Dubai hakkında sorularınızı cevaplamıştım ve size bilgi vermiştim. Kafanıza takılan başka herhangi bir soru varsa lütfen bana sormaktan çekinmeyin. Dubai’deki planlarınıza sizi gerçekten yaklaştıracak adımları birlikte netleştirebiliriz. Dilediğiniz zaman ben buradayım ve Dubai hakkında danışmak istediğiniz her konuda size her zaman yardımcı olmaya hazırım.",
      company: "Merhaba. Kısa süre önce Dubai’de şirket kuruluşu hakkında konuşmuştuk. Dubai'de şirket kurma planınız için doğru şirket yapısını planlamak ve sizin için en uygun maliyet yapısını belirlemek adına size her zaman destek olmak için buradayım. Paylaştığım bilgiler dışında kafanıza takılan herhangi bir soru olursa her zaman bana sorabilirsiniz.",
      residency: "Merhaba. Kısa süre önce Dubai’de oturum süreci hakkında konuşmuştuk. Sizin için en uygun oturum planlamasını daha net bir çerçevede yapmak adına size her zaman yardımcı olmaya hazırım. Paylaştığım bilgiler dışında kafanıza takılan herhangi bir soru olursa bana sorabilirsiniz.",
      cost: "Merhaba. Kısa süre önce Dubai’deki maliyetler hakkında konuşmuştuk. Maliyet planlamanızı daha net bir çerçevede yapmanız için size her zaman yardımcı olmaya hazırım. Paylaştığım bilgiler dışında kafanıza takılan herhangi bir soru olursa bana sorabilirsiniz.",
      AI: "Merhaba. Kısa süre önce AI ve otomasyon çözümleri hakkında konuşmuştuk. Projenizi daha verimli ve ölçeklenebilir bir yapıya dönüştürmek isterseniz yardımcı olmaya hazırım."
    },
    en: {
      general: "Hello. I noticed we haven’t been in touch for a short while. If you have any additional questions about Dubai, feel free to ask. I’m here to help you move closer to your plans.",
      company: "Hello. We recently discussed company formation in Dubai. If you're ready, I can help you determine the right structure.",
      residency: "Hello. We recently discussed the residency process in Dubai. If you're ready, I can help you choose the right path.",
      cost: "Hello. We recently discussed Dubai’s cost structure. I’m here to help you plan with clarity whenever you’re ready.",
      AI: "Hello. We recently discussed your AI project. If you're ready, I can help you build a more efficient and scalable structure."
    },
    ar: {
      general: "مرحبًا. تحدثنا مؤخرًا عن دبي. إذا كان لديك أي أسئلة إضافية، فلا تتردد في طرحها. أنا هنا دائمًا لمساعدتك.",
      company: "مرحبًا. تحدثنا مؤخرًا عن تأسيس شركة في دبي. إذا كنت جاهزًا، يمكنني مساعدتك في اختيار الهيكل المناسب.",
      residency: "مرحبًا. تحدثنا مؤخرًا عن إجراءات الإقامة في دبي. إذا كنت جاهزًا، يمكنني مساعدتك في اختيار الطريق الأنسب.",
      cost: "مرحبًا. تحدثنا مؤخرًا عن تكاليف دبي. أنا هنا لمساعدتك في التخطيط بوضوح.",
      AI: "مرحبًا. تحدثنا مؤخرًا عن مشروع الذكاء الاصطناعي. إذا كنت جاهزًا، يمكنني مساعدتك في تطويره."
    }
  };
  const langSet = messages[lang] || messages["en"];
  return langSet[topic] || langSet["general"];
}

function getFollowUpMessage(lang, topic, stage) {
  const messages = {
    "3h": {
      general: {
        tr: "Merhaba. Bir süredir iletişimde olmadığımızı fark ettim. Dubai ile ilgili konuştuğumuz konular ve sorduğunuz sorular dışında kafanıza takılan başka herhangi bir soru varsa lütfen bana sormaktan çekinmeyin..Dilediğiniz zaman ben buradayım ve Dubai planlarınız hakkında danışmak istediğiniz her konuda size her zaman yardımcı olmaya hazırım.",
        en: "Hello. I noticed we haven’t been in touch for a while. If you’re ready, we can clarify your next step regarding your Dubai plans.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل منذ فترة. إذا كنت جاهزًا، يمكننا توضيح خطوتك التالية بخصوص خططك في دبي."
      },
      company: {
        tr: "Merhaba. Bir süredir Dubai'de şirket kurma planlarınız ile ilgili iletişimde olmadığımızı fark ettim. Hazırsanız, şirket yapınızı ve sonraki adımları birlikte netleştirebiliriz.Dilediğiniz zaman ben buradayım ve Dubai planlarınız hakkında danışmak istediğiniz her konuda size her zaman yardımcı olmaya hazırım.",
        en: "Hello. I noticed we haven’t been in touch regarding your company setup. If you're ready, we can clarify the next steps together.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل بخصوص تأسيس الشركة منذ فترة. إذا كنت جاهزًا، يمكننا توضيح الخطوات التالية معًا."
      },
      residency: {
        tr: "Merhaba. Bir süredir Dubai'de oturum alma sürecinizle ilgili iletişim sağlayamadığımızı fark ettim. Dilerseniz, oturum alma planlarınız üzerine konuşmaya devam edebilir ve size en uygun oturum türünü belirleyebiliriz. Ben buradayım ve Dubai planlarınız hakkında danışmak istediğiniz her konuda size her zaman yardımcı olmaya hazırım.",
        en: "Hello. I noticed we haven’t been in touch regarding your residency process. If you're ready, we can define the right path together.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل بخصوص إجراءات الإقامة منذ فترة. إذا كنت جاهزًا، يمكننا تحديد الطريق الأنسب معًا."
      },
      cost: {
        tr: "Merhaba. Konuştuğumuz konular üzerinden maliyet planlamalarınızla ilgili bir süredir iletişimde olmadığımızı fark ettim. Hazırsanız, maliyet planlamalarınız üzerine konuşmaya devam edebiliriz.Dilediğiniz zaman ben buradayım ve Dubai planlarınız hakkında danışmak istediğiniz her konuda size her zaman yardımcı olmaya hazırım.",
        en: "Hello. I noticed we haven’t been in touch about your cost planning. If you're ready, we can clarify the numbers together.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل بخصوص تخطيط التكاليف منذ فترة. إذا كنت جاهزًا، يمكننا توضيح الأرقام معًا."
      },
      AI: {
        tr: "Merhaba. Bir süredir AI projenizle ilgili iletişimde olmadığımızı fark ettim. Hazırsanız, projenizin bir sonraki adımını birlikte netleştirebiliriz.",
        en: "Hello. I noticed we haven’t been in touch regarding your AI project. If you're ready, we can clarify the next step.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل بخصوص مشروع الذكاء الاصطناعي منذ فترة. إذا كنت جاهزًا، يمكننا توضيح الخطوة التالية."
      }
    },
    "24h": {
      general: {
        tr: "Merhaba. Dün Dubai planlarınız hakkında konuşmuştuk. Dubai planlarınız hakkında daha fazla bilgiye ihtiyacınız olursa lütfen bana sormaktan çekinmeyin. Dubaiye yerleşme sürecinizde size her zaman yardımcı olmaya hazırım. Ayrıca Canlı destek almak isterseniz bu sohbete canlı destek yazabilirsiniz.",
        en: "Hello. Yesterday we discussed your Dubai plans. If you’re still considering them, we can move forward together. For live support, simply type 'live support'.",
        ar: "مرحبًا. تحدثنا بالأمس عن خططك في دبي. إذا كنت لا تزال تفكر في الأمر، يمكننا المتابعة معًا. للحصول على دعم مباشر، فقط اكتب 'دعم مباشر'."
      },
      company: {
        tr: "Merhaba. Dün şirket kuruluşu hakkında konuşmuştuk. Şirket kurulum adımları ve süreçleri ile ilgili daha fazla bilgiye ihtiyacınız olursa lütfen bana sormaktan çekinmeyin. Size en uygun şirket türü ve maliyetini belirleyebilir ve bu süreçte size destek sağlayabilirim. Ayrıca Canlı destek almak isterseniz bu sohbete canlı destek yazabilirsiniz.",
        en: "Hello. Yesterday we discussed your company setup. If you're ready, we can define the right structure. Type 'live support' for assistance.",
        ar: "مرحبًا. تحدثنا بالأمس عن تأسيس الشركة. إذا كنت جاهزًا، يمكننا تحديد الهيكل الصحيح. للحصول على دعم مباشر، اكتب 'دعم مباشر'."
      },
      residency: {
        tr: "Merhaba. Dün oturum süreci hakkında konuşmuştuk. Oturum süreçleri ile ilgili daha fazla bilgiye ihtiyacınız olursa lütfen bana sormaktan çekinmeyin. Size en uygun oturum türlerini belirleyebilir ve bu süreçte size destek sağlayabilirim. Ayrıca Canlı destek almak isterseniz bu sohbete canlı destek yazabilirsiniz.",
        en: "Hello. Yesterday we discussed your residency process. If you're ready, we can move the steps forward. Type 'live support' for help.",
        ar: "مرحبًا. تحدثنا بالأمس عن إجراءات الإقامة. إذا كنت جاهزًا، يمكننا متابعة الخطوات. للحصول على دعم مباشر، اكتب 'دعم مباشر'."
      },
      cost: {
        tr: "Merhaba. Dün maliyet planlamanız hakkında konuşmuştuk. Maliyet ve bütçe planları ile ilgili daha fazla bilgiye ihtiyacınız olursa lütfen bana sormaktan çekinmeyin. Ayrıca Canlı destek almak isterseniz bu sohbete canlı destek yazabilirsiniz.",
        en: "Hello. Yesterday we discussed your cost planning. If you're ready, we can clarify your budget. Type 'live support' for assistance.",
        ar: "مرحبًا. تحدثنا بالأمس عن تخطيط التكاليف. إذا كنت جاهزًا، يمكننا توضيح ميزانيتك. للحصول على دعم مباشر، اكتب 'دعم مباشر'."
      },
      AI: {
        tr: "Merhaba. Dün AI projeniz hakkında konuşmuştuk. Hazırsanız, projenizi daha uygulanabilir bir yapıya dönüştürebiliriz. Canlı destek için 'canlı destek' yazabilirsiniz.",
        en: "Hello. Yesterday we discussed your AI project. If you're ready, we can turn it into a more actionable plan. Type 'live support' for help.",
        ar: "مرحبًا. تحدثنا بالأمس عن مشروع الذكاء الاصطناعي. إذا كنت جاهزًا، يمكننا تحويله إلى خطة قابلة للتنفيذ. للحصول على دعم مباشر، اكتب 'دعم مباشر'."
      }
    },
    "72h": {
      general: {
        tr: "Merhaba. Birkaç gündür iletişimde olmadığımızı fark ettim. Dubai’deki planlarınızın askıda kalmasını istemem. Hazırsanız, sizin için en doğru yolu birlikte netleştirebiliriz.",
        en: "Hello. I noticed we haven’t been in touch for a few days. I don’t want your Dubai plans to remain on hold. If you're ready, we can clarify the best path forward.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل منذ عدة أيام. لا أرغب أن تبقى خططكم في دبي معلّقة. إذا كنتم جاهزين، يمكننا تحديد المسار الأنسب لكم."
      },
      company: {
        tr: "Merhaba. Şirket kuruluşu planlarınızın birkaç gündür ilerlemediğini fark ettim. Dubai’de doğru yapı büyük fark yaratır. Hazırsanız, süreci birlikte hızlandırabiliriz.",
        en: "Hello. I noticed your company setup process hasn’t progressed in the last few days. The right structure in Dubai makes a major difference. If you're ready, we can move forward together.",
        ar: "مرحبًا. لاحظت أن عملية تأسيس الشركة لم تتقدم منذ عدة أيام. الهيكل الصحيح في دبي يحدث فرقًا كبيرًا. إذا كنتم جاهزين، يمكننا المتابعة معًا."
      },
      residency: {
        tr: "Merhaba. Oturum sürecinizin birkaç gündür ilerlemediğini fark ettim. Dubai’de oturum almak düşündüğünüzden daha hızlı tamamlanabilir. Hazırsanız, süreci netleştirebiliriz.",
        en: "Hello. I noticed your residency process hasn’t progressed for a few days. Residency in Dubai can be completed faster than expected. If you're ready, we can clarify the next steps.",
        ar: "مرحبًا. لاحظت أن عملية الإقامة لم تتقدم منذ عدة أيام. يمكن إنهاء الإقامة في دبي أسرع مما تتوقعون. إذا كنتم جاهزين، يمكننا تحديد الخطوات التالية."
      },
      cost: {
        tr: "Merhaba. Bütçe planlamanızın birkaç gündür askıda kaldığını fark ettim. Dubai’de maliyetleri doğru yönetmek önemli avantaj sağlar. Hazırsanız, sizin için en uygun yapıyı belirleyebiliriz.",
        en: "Hello. I noticed your budgeting process has been on hold for a few days. Managing costs correctly in Dubai provides major advantages. If you're ready, we can define the best structure for you.",
        ar: "مرحبًا. لاحظت أن خطتكم المالية معلّقة منذ عدة أيام. إدارة التكاليف بشكل صحيح في دبي يمنحكم مزايا كبيرة. إذا كنتم جاهزين، يمكننا تحديد الهيكل الأنسب لكم."
      },
      AI: {
        tr: "Merhaba. AI projenizin birkaç gündür ilerlemediğini fark ettim. Doğru otomasyon yapısı işinizi hızla ileri taşır. Hazırsanız, projenizi birlikte netleştirebiliriz.",
        en: "Hello. I noticed your AI project hasn’t progressed for a few days. The right automation structure accelerates your business significantly. If you're ready, we can refine your project together.",
        ar: "مرحبًا. لاحظت أن مشروع الذكاء الاصطناعي لم يتقدم منذ عدة أيام. الهيكل الصحيح للأتمتة يدفع عملكم بسرعة إلى الأمام. إذا كنتم جاهزين، يمكننا تطوير المشروع معًا."
      }
    },
    "7d": {
      general: {
        tr: "Merhaba. Bir haftadır iletişimde olmadığımızı fark ettim. Dubai ile ilgili planlarınız hâlâ geçerliyse, sizin için en doğru yolu birlikte belirleyebiliriz. Hazır olduğunuzda buradayım.",
        en: "Hello. I noticed we haven’t been in touch for a week. If your Dubai plans are still active, we can define the best path together. I’m here whenever you're ready.",
        ar: "مرحبًا. لاحظت أننا لم نتواصل منذ أسبوع. إذا كانت خططكم في دبي ما زالت قائمة، يمكننا تحديد المسار الأنسب لكم. أنا هنا متى ما كنتم جاهزين."
      },
      company: {
        tr: "Merhaba. Şirket kuruluşu planlarınızla ilgili bir haftadır iletişimde olmadığımızı fark ettim. Dubai’de doğru yapı uzun vadeli avantaj sağlar. Hazır olduğunuzda süreci birlikte ilerletebiliriz.",
        en: "Hello. I noticed we haven’t followed up on your company setup for a week. The right structure in Dubai provides long-term advantages. Whenever you're ready, we can move forward.",
        ar: "مرحبًا. لاحظت أننا لم نتابع بخصوص تأسيس الشركة منذ أسبوع. الهيكل الصحيح في دبي يمنحكم مزايا طويلة المدى. أنا هنا متى ما كنتم جاهزين."
      },
      residency: {
        tr: "Merhaba. Oturum sürecinizle ilgili bir haftadır iletişimde olmadığımızı fark ettim. Dubai’de oturum almak düşündüğünüzden daha hızlı ilerleyebilir. Hazır olduğunuzda devam edebiliriz.",
        en: "Hello. I noticed we haven’t followed up on your residency process for a week. Residency in Dubai can progress faster than expected. We can continue whenever you're ready.",
        ar: "مرحبًا. لاحظت أننا لم نتابع بخصوص الإقامة منذ أسبوع. يمكن أن تتقدم الإقامة في دبي أسرع مما تتوقعون. أنا هنا متى ما كنتم جاهزين."
      },
      cost: {
        tr: "Merhaba. Bütçe planlamanızla ilgili bir haftadır iletişimde olmadığımızı fark ettim. Dubai’de maliyetleri doğru yönetmek önemli avantaj sağlar. Hazır olduğunuzda sizin için en uygun yapıyı belirleyebiliriz.",
        en: "Hello. I noticed we haven’t discussed your budgeting for a week. Managing costs correctly in Dubai provides major advantages. We can define the best structure whenever you're ready.",
        ar: "مرحبًا. لاحظت أننا لم نناقش خطتكم المالية منذ أسبوع. إدارة التكاليف بشكل صحيح في دبي يمنحكم مزايا كبيرة. أنا هنا متى ما كنتم جاهزين."
      },
      AI: {
        tr: "Merhaba. AI projenizle ilgili bir haftadır iletişimde olmadığımızı fark ettim. Doğru otomasyon yapısı işinizi hızla ileri taşır. Hazır olduğunuzda projenizi birlikte netleştirebiliriz.",
        en: "Hello. I noticed we haven’t followed up on your AI project for a week. The right automation structure can rapidly move your business forward. Whenever you're ready, we can refine your project.",
        ar: "مرحبًا. لاحظت أننا لم نتابع بخصوص مشروع الذكاء الاصطناعي منذ أسبوع. الهيكل الصحيح للأتمتة يمكن أن يدفع عملكم بسرعة إلى الأمام. أنا هنا متى ما كنتم جاهزين."
      }
    }
  };
  const stageSet = messages[stage] || messages["3h"];
  const topicSet = stageSet[topic] || stageSet["general"];
  return topicSet[lang] || topicSet["en"];
}

// ============================================================================
// 5. ROUTING (ENDPOINT'LER)
// ============================================================================

// ----------------------------------------------------------------------------
// A) SAMCHEGUIDE BOT (GEMINI) - /plan, /chat ve /chat/history
// ----------------------------------------------------------------------------
async function resolvePublicConversationSession(req, scope, resolvedExperience) {
  const token = req.get('X-Samcheguide-Session');
  if (!token) return null;
  return resolveGuideResumeSession({ database: pool, token, scope, experienceVersion: resolvedExperience.experience.version, previewMode: Boolean(req.get('X-Samcheguide-Preview')) });
}

async function issueOrResolvePublicConversationSession(req, scope, resolvedExperience) {
  const current = await resolvePublicConversationSession(req, scope, resolvedExperience);
  if (current) return current;
  return issueGuideResumeSession({ database: pool, scope, experienceVersion: resolvedExperience.experience.version, previewMode: Boolean(req.get('X-Samcheguide-Preview')) });
}

app.get("/chat/history", async (req, res) => {
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.status(404).json({ error: "Conversation is unavailable." });
    const resolved = await resolveGuideExperienceForScope({ integration, previewToken: req.get('X-Samcheguide-Preview') });
    const session = await resolvePublicConversationSession(req, integration, resolved);
    if (!session) return res.status(401).json({ error: "Conversation session is invalid." });
    const feed = await getSamcheguidePublicFeed({ externalSessionId: session.sessionId, integration });
    if (!feed) return res.status(404).json({ error: "Conversation is unavailable." });
    return res.json({ messages: feed.messages });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.status === 401 ? "Conversation session is invalid." : "Conversation history is temporarily unavailable." });
  }
});

app.get("/chat/live", async (req, res) => {
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.status(404).json({ error: "Conversation is unavailable." });
    const resolved = await resolveGuideExperienceForScope({ integration, previewToken: req.get('X-Samcheguide-Preview') });
    const session = await resolvePublicConversationSession(req, integration, resolved);
    if (!session) return res.status(401).json({ error: "Conversation session is invalid." });
    const feed = await getSamcheguidePublicFeed({ externalSessionId: session.sessionId, integration });
    if (!feed?.conversationId) return res.status(404).json({ error: "Conversation is unavailable." });

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    res.write('event: connected\ndata: {}\n\n');
    const unsubscribe = subscribeTenantEvents(feed.tenantId, (event) => {
      if (event.conversation_id === feed.conversationId) res.write(`event: conversation\ndata: ${JSON.stringify({ type: event.type })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.status === 401 ? "Conversation session is invalid." : "Conversation feed is temporarily unavailable." });
  }
});

app.post("/plan", async (req, res) => {
  try {
    const { sector } = req.body;
    if (typeof sector !== "string") {
      return res.status(400).json({ error: "Sector must be a non-empty string." });
    }

    const cleanSector = sector.trim();
    if (!cleanSector) return res.status(400).json({ error: "Sector value cannot be empty." });
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration || integration.channel_status !== "active") {
      return res.status(503).json({ error: "AI Guide configuration is temporarily unavailable." });
    }
    const resolvedExperience = await resolveGuideExperienceForScope({ integration, previewToken: req.get('X-Samcheguide-Preview') });
    const publicSession = await issueOrResolvePublicConversationSession(req, integration, resolvedExperience);
    const userId = publicSession.sessionId;
    let runtime;
    try {
      runtime = await resolveChannelAssistantRuntime({
        database: pool,
        embed: knowledgeEmbedder,
        scope: integration,
        query: cleanSector,
        channelType: 'SAMCHEGUIDE',
        resolvePersona: resolveTenantRuntimePersona,
        resolveKnowledge: resolveAssistantRuntimeKnowledgeContext,
        resolveModel: () => googleGeminiProvider.runtimeMetadata(),
      });
    } catch (error) {
      console.error('GUIDE_RUNTIME_HEALTH status=' + (error?.code ?? 'GUIDE_RUNTIME_UNAVAILABLE'));
      return res.status(503).json({ error: "AI Guide assistant configuration is temporarily unavailable." });
    }
    const knowledgeAuthority = await resolveAssistantKnowledgeAuthority({
      database: pool,
      tenantId: integration.tenant_id,
      assistantId: integration.assistant_id,
    });
    const planRequest = `Create a structured strategic plan for the customer-requested sector or objective: "${cleanSector}". Use only the ACTIVE tenant business profile, ACTIVE Assistant configuration, and approved tenant knowledge. Do not invent unsupported services, prices, procedures, approvals, jurisdictions, or claims. Reply in the language of the request.`;
    const runtimeSystemInstruction = buildTenantRuntimeSystemInstruction({
      persona: runtime.persona,
      knowledgeContext: runtime.knowledge.knowledgeContext,
      channelRules: "Return safe, readable HTML suitable for the AI Guide interface.",
    });

    const payload = {
      contents: [{
        parts: [{ text: planRequest }]
      }],
      systemInstruction: { parts: [{ text: runtimeSystemInstruction }] }
    };

    const data = await requestGemini(payload, runtime.model);
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]) {
      let originalText = data.candidates[0].content.parts[0].text;
      data.candidates[0].content.parts[0].text = parseLinksToHTML(originalText);
      // 🔥 HAFIZAYA EKLE (Sayfa yenilendiğinde unutmaması için)
      const runtimeSession = samcheguideRuntimeSessionKey({
        tenantId: integration.tenant_id,
        assistantId: integration.assistant_id,
        channelId: integration.channel_id,
        sessionId: userId,
      });
      addGuideMemory(runtimeSession, "user", planRequest, knowledgeAuthority);
      addGuideMemory(runtimeSession, "model", originalText, knowledgeAuthority);
    }
    return res.json(data);
  } catch (err) {
    console.error("Samcheguide Plan error:", err);
    return res.status(err.status || 500).json({ error: "Could not generate strategy plan." });
  }
});

// This endpoint deliberately persists validated Guide state without invoking an
// AI provider. It makes an explicit module handoff durable before a visitor
// chooses to send a message, while the host-bound scope stays server-owned.
app.post("/guide/session-context", async (req, res) => {
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.status(404).json({ error: 'Guide session is unavailable.' });
    const resolved = await resolveGuideExperienceForScope({
      integration,
      previewToken: req.get('X-Samcheguide-Preview'),
    });
    const publicSession = await issueOrResolvePublicConversationSession(req, integration, resolved);
    const context = saveGuideSessionContext({
      scope: integration,
      sessionId: publicSession.sessionId,
      experience: resolved.experience,
      context: req.body?.guide_context,
    });
    await saveGuideResumeState({ database: pool, token: publicSession.token, scope: integration, experienceVersion: resolved.experience.version, previewMode: Boolean(req.get('X-Samcheguide-Preview')), state: { context } });
    return res.json({ conversation_session: publicSession.token, context_saved: true });
  } catch (error) {
    if (error instanceof GuideSessionContextError) {
      return res.status(400).json({ error: 'Guide session context is invalid.', code: error.code });
    }
    console.error('GUIDE_SESSION_HANDOFF_FAILED code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    return res.status(503).json({ error: 'Guide session is temporarily unavailable.' });
  }
});

app.get("/guide/session-context", async (req, res) => {
  try {
    const integration = await resolveGuideRuntimeScope(req);
    if (!integration) return res.status(404).json({ error: 'Guide session is unavailable.' });
    const resolved = await resolveGuideExperienceForScope({ integration, previewToken: req.get('X-Samcheguide-Preview') });
    const publicSession = await resolvePublicConversationSession(req, integration, resolved);
    if (!publicSession) return res.status(401).json({ error: 'Guide session is invalid.' });
    const state = await loadGuideResumeState({ database: pool, token: publicSession.token, scope: integration, experienceVersion: resolved.experience.version, previewMode: Boolean(req.get('X-Samcheguide-Preview')) });
    return res.json({ conversation_session: publicSession.token, guide_session_state: state ?? null });
  } catch (error) {
    console.error('GUIDE_SESSION_RESUME_FAILED code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    return res.status(503).json({ error: 'Guide session is temporarily unavailable.' });
  }
});

app.post("/chat", async (req, res) => {
  console.info('CHAT_REQUEST_RECEIVED');
  try {
    const { text, guide_module: clientModule, guide_session_state: clientGuideSessionState } = req.body;
    if (typeof text !== "string") {
      return res.status(400).json({ error: "Message text must be a non-empty string." });
    }

    const cleanText = text.trim();
    if (!cleanText || cleanText.length > 2000) return res.status(400).json({ error: "Message text must be a non-empty string." });
    let guideConversation;
    try { guideConversation = normalizeGuideConversationRequest({ module: req.body?.guide_module || 'AI_ASSISTANT', text: cleanText }); }
    catch (error) { return res.status(400).json({ error: 'Guide request is invalid.' }); }

    let publicSession;
    let guideRuntimeIntegration;
    let publishedExperience;
    try {
      guideRuntimeIntegration = await resolveGuideRuntimeScope(req);
      if (!guideRuntimeIntegration) {
        return res.status(503).json({
          error: "AI Guide assistant configuration is temporarily unavailable.",
        });
      }
      publishedExperience = await resolveGuideExperienceForScope({
        integration: guideRuntimeIntegration,
        previewToken: req.get('X-Samcheguide-Preview'),
      });
      publicSession = await issueOrResolvePublicConversationSession(req, guideRuntimeIntegration, publishedExperience);
    } catch (error) {
      if (error?.status === 503) console.error('CHAT_RESPONSE_503 stage=PUBLIC_SESSION_CONFIGURATION');
      throw error;
    }
    const userId = publicSession.sessionId;
    // --- Start: Load and Initialize Full Guide Session State ---
    let persistedGuideState = await loadGuideResumeState({ database: pool, token: publicSession.token, scope: guideRuntimeIntegration, experienceVersion: publishedExperience.experience.version, previewMode: Boolean(req.get('X-Samcheguide-Preview')) });

    // Initialize default guideSessionState if not fully present
    const defaultGuideSessionState = {
      active_module: clientModule || 'AI_ASSISTANT',
      sharedContext: {},
      roadmapState: { messages: [] },
      planningState: {}, // Assuming planningState is mostly key-value pairs
      assistantConversation: { messages: [] },
      reminderDismissedState: {},
    };

    let guideSessionState = {
      ...defaultGuideSessionState,
      ...persistedGuideState, // Merge persisted state over defaults
    };

    // If client sends a full state, it implies a client-side update (e.g. from UI form)
    // Merge relevant parts from client, but ensure messages are backend authoritative and append.
    if (clientGuideSessionState && typeof clientGuideSessionState === 'object') {
        guideSessionState = {
            ...guideSessionState,
            // Allow client to update active_module and shared context directly
            active_module: clientGuideSessionState.active_module || guideSessionState.active_module,
            sharedContext: {
                ...guideSessionState.sharedContext,
                ...(clientGuideSessionState.sharedContext || {}),
            },
            // Planning state can be updated directly by client as it's form-based
            planningState: {
                ...guideSessionState.planningState,
                ...(clientGuideSessionState.planningState || {}),
            },
            // Roadmap state (excluding messages) can be updated by client
            roadmapState: {
                ...guideSessionState.roadmapState,
                ...(clientGuideSessionState.roadmapState || {}),
                messages: guideSessionState.roadmapState.messages // Keep backend messages, client new message appended below
            },
            // Assistant conversation (excluding messages) can be updated by client
            assistantConversation: {
                ...guideSessionState.assistantConversation,
                ...(clientGuideSessionState.assistantConversation || {}),
                messages: guideSessionState.assistantConversation.messages // Keep backend messages, client new message appended below
            },
            // Reminder state can be updated by client
            reminderDismissedState: {
                ...guideSessionState.reminderDismissedState,
                ...(clientGuideSessionState.reminderDismissedState || {}),
            }
        };
    }

    // Add user message to the correct conversation thread
    const userMessage = { role: 'user', content: cleanText, timestamp: Date.now() };
    if (guideConversation.module === 'ROADMAP') {
        guideSessionState.roadmapState.messages.push(userMessage);
    } else if (guideConversation.module === 'AI_ASSISTANT') {
        guideSessionState.assistantConversation.messages.push(userMessage);
    }
    // INTERACTIVE_TOOL (Planning) is not a chat module in this context

    // --- End: Load and Initialize Full Guide Session State ---

    const inboxState = await persistSamcheguideInbound({
      externalSessionId: userId,
      content: cleanText,
      idempotencyKey: req.get("Idempotency-Key") || null,
      integration: guideRuntimeIntegration,
    });

    // --- Start: Refactor guideMemoryStore for module-specific memory ---
    const sessionKey = samcheguideRuntimeSessionKey({
        tenantId: guideRuntimeIntegration.tenant_id,
        assistantId: guideRuntimeIntegration.assistant_id,
        channelId: guideRuntimeIntegration.channel_id,
        sessionId: userId,
    });

    // Add user message to the correct memory store (for AI context)
    // First, initialize if not present.
    if (!guideMemoryStore[sessionKey]) {
      guideMemoryStore[sessionKey] = {};
    }
    if (!guideMemoryStore[sessionKey][guideConversation.module]) {
      guideMemoryStore[sessionKey][guideConversation.module] = [];
    }

    addGuideMemory(sessionKey, guideConversation.module, "user", cleanText, inboxState.knowledgeAuthority ?? null);

    // Retrieve conversation history for the AI provider from the specific module's memory
    const rawMessages = (guideMemoryStore[sessionKey]?.[guideConversation.module] || []).map((message) => ({ role: message.role, content: message.content }));
    const conversationHistory = rawMessages.filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .map((entry) => ({ role: entry.role === 'user' ? 'user' : 'model', parts: [{ text: entry.content }] }));

    // Construct system instruction based on shared context and other relevant states
    const guideContextSummary = buildGuideSessionContextSummary({
      scope: guideRuntimeIntegration,
      sessionId: userId,
      experience: publishedExperience.experience,
      context: { // Combine shared context and relevant module data for AI context
        ...guideSessionState.sharedContext,
        roadmap: guideSessionState.roadmapState, // Provide full roadmap state to AI
        planning: guideSessionState.planningState, // Provide full planning state to AI
      }
    });

    const runtime = await resolveAssistantRuntimeKnowledgeContext({
      database: pool,
      tenantId: guideRuntimeIntegration.tenant_id,
      assistantId: guideRuntimeIntegration.assistant_id,
      channelId: guideRuntimeIntegration.channel_id,
      conversationHistory: conversationHistory, // Pass module-specific history
      systemInstruction: buildTenantRuntimeSystemInstruction({
        persona: publishedExperience.experience,
        knowledgeContext: guideContextSummary,
        channelRules: "Return safe, readable HTML suitable for the AI Guide interface."
      }),
      knowledgeAuthority: inboxState.knowledgeAuthority ?? null,
    });

    if (!runtime) {
      console.error('CHAT_RESPONSE_503 stage=RUNTIME_CONTEXT_UNAVAILABLE');
      return res.status(503).json({
        error: "AI Guide assistant configuration is temporarily unavailable.",
        conversation_session: publicSession.token,
      });
    }

    const contents = [...conversationHistory, { role: 'user', parts: [{ text: cleanText }] }];

    let originalText;
    if (runtime.useProvidedResponse) {
      originalText = runtime.response;
    } else {
      console.info(
        'CHAT_GEMINI_RUNTIME_CONTEXT channel=SAMCHEGUIDE active_configuration=' + (runtime.knowledge.activeConfiguration ? '1' : '0') +
        ' retrieved_chunks=' + runtime.knowledge.knowledge.length +
        ' retrieval_available=' + (runtime.knowledge.retrievalAvailable ? '1' : '0') +
        ' provider_mode=' + runtime.mode + ' model=' + runtime.model
      );

      console.info('CHAT_GEMINI_STARTED');
      let data;
      try {
        data = await requestGemini({
          contents,
          systemInstruction: { parts: [{ text: runtime.systemInstruction }] }
        }, runtime.model);
      } catch (error) {
        const code = typeof error?.code === 'string' && /^GOOGLE_(?:VERTEX|GEMINI)_[A-Z0-9_]+$/.test(error.code)
          ? error.code
          : 'GOOGLE_GEMINI_REQUEST_FAILED';
        console.error(`CHAT_GEMINI_FAILED code=${code}`);
        throw error;
      }
      originalText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof originalText !== "string" || !originalText.trim()) {
        const error = new Error("Gemini returned no usable response.");
        error.status = 502;
        throw error;
      }
    }

    if (inboxState) {
      const persisted = await persistAssistantResponseIfCurrent({
        tenantId: inboxState.integration.tenant_id,
        conversationId: inboxState.conversation.id,
        content: originalText,
        handlingVersion: inboxState.handlingVersion,
        knowledgeAuthority: inboxState.knowledgeAuthority,
      });
      if (!persisted.delivered) {
        return res.status(202).json({
          status: "human_handling",
          conversation_session: publicSession.token,
        });
      }
    }

    // Add AI message to the correct conversation thread
    const aiMessage = { role: 'assistant', content: originalText, timestamp: Date.now() };
    if (guideConversation.module === 'ROADMAP') {
        guideSessionState.roadmapState.messages.push(aiMessage);
        // Potentially update roadmapState.generatedAnalysis or other structured data here
        // based on the AI's response if it's a structured analysis.
        // For now, it's just a message.
    } else if (guideConversation.module === 'AI_ASSISTANT') {
        guideSessionState.assistantConversation.messages.push(aiMessage);
    }

    addGuideMemory(sessionKey, guideConversation.module, "model", originalText, inboxState.knowledgeAuthority ?? null);

    // --- Start: Save Full Guide Session State ---
    await saveGuideResumeState({
      database: pool,
      token: publicSession.token,
      scope: guideRuntimeIntegration,
      experienceVersion: publishedExperience.experience.version,
      previewMode: Boolean(req.get('X-Samcheguide-Preview')),
      state: guideSessionState // Save the entire updated state
    });
    // --- End: Save Full Guide Session State ---

    return res.json({
      conversation_session: publicSession.token,
      candidates: [{ content: { parts: [{ text: originalText }] } }],
      guide_events: canonicalGuideResponseEvents(originalText, { nextActions: guideConversation.module === 'ROADMAP' ? ['Refine this plan', 'Build planning scope', 'Ask the assistant'] : [] }),
      guide_session_state: guideSessionState // Return the updated state to the client
    });
  } catch (err) {
    if (err instanceof GuideConversationError) return res.status(400).json({ error: 'Guide request is invalid.' });
    if (err?.status === 503) console.error('CHAT_RESPONSE_503 stage=OUTER_HANDLER_ERROR');
    console.error("Samcheguide Chat error:", err?.code || err?.name || "unknown");
    return res.status(err.status || 500).json({ error: "Could not generate chat response." });
  }
});



// ----------------------------------------------------------------------------
// B) WEB CHATBOT (OPENAI) - /api/chat ve /api/chat/history
// ----------------------------------------------------------------------------
const webMemoryStore = {};
const MAX_WEB_MEMORY = 10;

function addWebMemory(userId, role, content, knowledgeAuthority = null) {
  if (!webMemoryStore[userId]) webMemoryStore[userId] = [];
  webMemoryStore[userId].push(stampProviderMemoryEntry({ role, content }, knowledgeAuthority));

  if (webMemoryStore[userId].length > MAX_WEB_MEMORY) {
    webMemoryStore[userId].splice(0, webMemoryStore[userId].length - MAX_WEB_MEMORY);
  }
}

app.get("/api/chat/history", (req, res) => {
  const userId = getUserId(req);
  res.json((webMemoryStore[userId] || []).map(({ role, content }) => ({ role, content })));
});

app.post("/api/chat/bootstrap", async (req, res) => {
  const widgetKey = typeof req.body?.widget_key === 'string' ? req.body.widget_key.trim() : '';
  const secret = configuredPublicWebChatSessionSecret();
  if (!widgetKey || !secret) return res.status(503).json({ error: 'Web Chat is unavailable.' });
  try {
    const integration = await resolvePublicWebChatIntegration({ database: pool, widgetKey });
    if (!integration) return res.status(404).json({ error: 'Web Chat integration is unavailable.' });
    const session = issuePublicWebChatSession({ secret, widgetKey });
    return res.json({ session: session.token });
  } catch (error) {
    console.error('WEB_CHAT_BOOTSTRAP_FAILED code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    return res.status(503).json({ error: 'Web Chat is temporarily unavailable.' });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (typeof userMessage !== "string" || userMessage.trim().length === 0) {
      return res.status(400).json({ error: "A non-empty message is required." });
    }

    let webChatSession = null;
    let webChatIntegration = null;
    const suppliedWebChatSession = req.get('X-Samche-Web-Chat-Session');
    if (suppliedWebChatSession) {
      try {
        webChatSession = verifyPublicWebChatSession(suppliedWebChatSession, {
          secret: configuredPublicWebChatSessionSecret(),
        });
        webChatIntegration = await resolvePublicWebChatIntegration({
          database: pool,
          widgetKey: webChatSession.widgetKey,
        });
      } catch (error) {
        if (!(error instanceof PublicWebChatSessionError)) throw error;
      }
      if (!webChatIntegration) return res.status(401).json({ error: 'Web Chat session is invalid.' });
    }

    const userId = webChatSession?.sessionId ?? getUserId(req);
    const normalizedMessage = userMessage.trim();
    const webChatKnowledgeAuthority = webChatIntegration
      ? await resolveAssistantKnowledgeAuthority(pool, {
        tenantId: webChatIntegration.tenant_id,
        assistantId: webChatIntegration.assistant_id,
      })
      : null;
    if (webChatIntegration && !webChatKnowledgeAuthority) {
      return res.status(503).json({ error: 'Web Chat knowledge authority is temporarily unavailable.' });
    }

    addWebMemory(userId, "user", normalizedMessage, webChatKnowledgeAuthority);

    const rawMemory = webMemoryStore[userId] || [];
    const authorityMemory = webChatIntegration
      ? (webChatKnowledgeAuthority ? filterProviderMemoryByAuthority(rawMemory, webChatKnowledgeAuthority) : [])
      : rawMemory;
    const cleanMemory = authorityMemory.map(msg => ({
      role: msg.role,
      content: msg.content ? String(msg.content) : ""
    }));

    let webChatRuntimeKnowledge = null;
    let webChatRuntimePersona = null;
    if (webChatIntegration) {
      try {
        webChatRuntimePersona = await resolveTenantRuntimePersona({
          database: pool,
          tenantId: webChatIntegration.tenant_id,
          assistantId: webChatIntegration.assistant_id,
        });
        if (!webChatRuntimePersona.available) {
          return res.status(503).json({ error: 'Web Chat assistant configuration is temporarily unavailable.' });
        }
        webChatRuntimeKnowledge = await resolveAssistantRuntimeKnowledgeContext({
          database: pool,
          embed: knowledgeEmbedder,
          tenantId: webChatIntegration.tenant_id,
          assistantId: webChatIntegration.assistant_id,
          query: normalizedMessage,
        });
        console.info(
          'KNOWLEDGE_RUNTIME_CONTEXT channel=WEB_CHAT active_configuration=' + (webChatRuntimeKnowledge.activeConfiguration ? '1' : '0') +
          ' retrieved_chunks=' + webChatRuntimeKnowledge.knowledge.length +
          ' retrieval_available=' + (webChatRuntimeKnowledge.retrievalAvailable ? '1' : '0')
        );
      } catch (error) {
        console.error('KNOWLEDGE_RUNTIME_CONTEXT_UNAVAILABLE channel=WEB_CHAT code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
      }
    }

    const messages = [
      {
        role: "system",
        content: `You are the corporate artificial intelligence consultant of SamChe Company LLC.
Your mission is to provide professional, strategic, analytical and guiding answers with a premium consultancy tone.

You ALWAYS position SamChe Company as the provider of the solution the user is asking about.
You NEVER give generic answers.
You NEVER use Gemini’s ready-made templates, procedural texts, government processes, or classical explanations.
You DO NOT create your own templates.
You ONLY give answers that comply with the rules defined in this prompt.

Your primary goal is SALES CONVERSION — but with QUALIFICATION.
You do NOT send every user to WhatsApp immediately.
First, you MUST collect necessary information from the user (e.g., how many visas they need, which sector they are in). Ask these details or answer their specific questions.

For every question the user asks — whether it is about:
- private AI systems
- custom AI development
- WhatsApp or website chatbots
- AI automation
- AI‑driven social media growth
- digital transformation
- UAE company formation
- choosing business activities
- scaling a business in the UAE

You ALWAYS respond using this structure:

1. Acknowledge their need clearly
2. Explain that SamChe Company provides exactly this service
3. Highlight why SamChe is the best choice (expertise, speed, precision, UAE specialization, AI mastery)
4. Give a clear next step:
   - If the user shows low or unclear intent, or asks unnecessary questions and keeps the system busy → direct them to the CONTACT FORM (Form Links). Do not send them to WhatsApp.
   - If the user shows strong, serious intent AND you have gathered their information (sector, visa count, etc.) → direct them to WhatsApp LIVE REPRESENTATIVE with a topic-specific corporate transfer message.

QUALIFYING QUESTIONS you may ask include:
- “What stage are you currently in”
- “Are you looking to start immediately or exploring options”
- “What is your expected timeline”
- “Do you already have a budget range in mind”
- “Is this for a new project or an existing business”

When directing a serious user to WhatsApp, you MUST generate a short, professional, corporate transfer message summarizing their request (including their sector, visa count, and gathered details) and provide the appropriate WhatsApp number based on language rules.

WHATSAPP NUMBER RULES BASED ON LANGUAGE:
- For Turkish language (tr): You MUST use +971 52 728 8586
- For English and all other languages: You MUST use +971 52 662 2875

Format example for WhatsApp transfer (auto‑adapted to topic & language):
"İlgili talebinizi aldım. Size en doğru desteği sağlayabilmek adına, [Sektör] sektöründeki şirket kurulumu ve [Vize Sayısı] vize talebinizle ilgili uzman ekibimize aktarıyorum. Lütfen aşağıdaki numaradan iletişime geçin: +971 52 728 8586"

Form Links (for low-intent users or busywork):
- Turkish: <a href="https://samchecompany.ae/sirket-kurulumu-dubai-sirket-kurulumu-formu" target="_blank">Şirket Kurulumu Danışmanlık Formu</a>
- Other Languages: <a href="https://samchecompany.com/business-consultation-in-dubai" target="_blank">Consultation Request Form</a>

Your tone must always be:
- premium
- confident
- expert
- persuasive
- sales‑oriented
- selective (you do NOT chase low‑intent users)

Your goal is simple:
Turn every question into a clear, confident, premium SamChe Company sales answer — while filtering out low‑intent users to forms and escalating only qualified, serious leads to WhatsApp with a professional summary message.


GENERAL BEHAVIOR RULES:

DO NOT USE the following expressions UNDER ANY CIRCUMSTANCES:

• “Due to the complexity of the processes, it may be beneficial to seek support from a lawyer or consultancy firm.”
• “It is important to get an offer from a consultancy firm.”
• “Contact the freezone to determine the exact cost.”
• “Contact the freezone authority.”
• “To travel to Dubai, you must first obtain a travel visa.” (If the user asks: state that SamChe Company provides this.)
• “You need to find a job, the employer applies on your behalf.”
• Classical government procedure explanations such as MOHRE, GDRFA, work permit procedures, job offer requirement.
• NEVER direct to another company, lawyer, freezone authority, government institution, consultancy company.
• “Our consultant will contact you shortly”
• “Leave us your contact information”
• “I am preparing / I can prepare a special official offer - business plan - cost plan for you.”
• “Contact the relevant Freezone Authority”
• “It is important to contact the Freezone Authority regarding this matter”
• “Contact the relevant freezone for exact costs”
• “Exact costs are determined by the relevant freezone”
• “Freezone authorities are responsible for this matter”

These expressions are FORBIDDEN.

DO NOT ENGAGE in the following behaviors UNDER ANY CIRCUMSTANCES:

• Do not use ready templates unless the user message exactly matches a specific trigger expression.
• Do not automatically trigger based on similarity, prediction, intent extraction, topic similarity or possible meaning.
• If the user message is unclear, incomplete or open to interpretation, do not trigger any ready template.
• Do not make assumptions, open topics or direct.

# CORE IDENTITY AND LANGUAGE UNIVERSALITY RULES
- You are an AI assistant for Samche Company.
- **Language Agnosticism:** You must treat all translations of target keywords identically. For example, "Artificial Intelligence", "AI", "Yapay Zeka", and "الذكاء الاصطناعي" are the EXACT SAME trigger. "Chatbot", "Sohbet Botu", and "روبوت المحادثة" are the EXACT SAME trigger. Apply the rules below regardless of the user's language.

# RESPONSE SCENARIOS & LOGIC
You must analyze the user's prompt and strictly follow ONE of these three scenarios:

**SCENARIO A: ONLY CHATBOTS / CHATBOT PRICING**
- IF the user asks specifically about "Chatbots", "AI Chatbot", "Chatbot Pricing", or "Chatbot Demo Plans" (or their equivalents in any language) AND does NOT ask about general AI services:
- **Action:** DO NOT provide long explanations. ONLY provide the redirect link using the exact format below.

**SCENARIO B: ONLY AI SERVICES (YAPAY ZEKA HİZMETLERİ)**
- IF the user asks about "AI Services", "Yapay Zeka Hizmetleri", or general AI capabilities (and does NOT mention chatbots):
- **Action:** Provide detailed information about the AI services using the bullet-point format rules. DO NOT include the chatbot link.

**SCENARIO C: BOTH AI SERVICES AND CHATBOTS**
- IF the user asks about BOTH "AI Services / Yapay Zeka" AND "Chatbots" in the same prompt:
- **Action:** First, provide the information about AI services using the bullet-point rules. Then, at the VERY BOTTOM of your response, add the AI Chatbot pricing and demo link.

# STRICT HTML FORMATTING RULES (CRITICAL)
You are operating on a web interface that renders raw HTML. You MUST format your entire response using HTML tags. Standard Markdown (like \n, **, or []) will NOT work and will break the UI.

**1. LINK FORMATTING RULE:**
- NEVER use raw URLs or Markdown links.
- ALWAYS use HTML anchor tags so links are clickable.
- Format: <a href="URL" target="_blank">Text to Display</a>
- Example: <a href="https://aichatbot.samchecompany.com" target="_blank">AI CHATBOTS PRICE DEMO AND PLANS</a>

**2. BULLET POINTS AND LINE BREAKS (VERTICAL ALIGNMENT):**
- Web browsers ignore standard line breaks. You MUST force items to appear on separate lines.
- NEVER write bullet points side-by-side in a single paragraph.
- To create a bulleted list, you MUST strictly use HTML "<ul>" and "<li>" tags.
- NEVER use "<br>" tags for lists, and NEVER use Markdown bullets like "•", "*", or "-".
- Example Format:
  <ul>
    <li>Müşteri destek chatbotları</li>
    <li>Satış artırma için chatbot çözümleri</li>
    <li>Çok dilli destek yetenekleri</li>
  </ul>

# BULLET POINT & TEXT FORMATTING RULES
- Provide the user with bulleted information; each bullet point MUST be on a SINGLE LINE.
- Use a "•" at the beginning of each bullet point.
- DO NOT leave blank lines between bullet points.
- DO NOT write bullet points within paragraphs; they should always be on separate lines.
- This format MUST be maintained in all languages (TR, EN, AR, etc.).

EXPLANATORY ANSWER + FOLLOW-UP QUESTION RULE:

• When the user asks a clear question or requests information, give an explanatory answer.
• At the end of the explanatory answer, add a short and corporate follow-up question to politely continue the conversation.
• The follow-up question must not be directive; it should only give the floor back to the user, be open-ended and contain no pressure.

User:
“I want to get residency”
“I want to work in Dubai”
“How to get a work permit?”

If such a question is asked:

First explain the types of residency in Dubai and Dubai’s OFFICIAL residency acquisition procedure step by step
• Entry Permit
• Status Change
• Medical Test
• Biometrics
• Emirates ID
• Visa Stamping
After explaining the official procedure, ask which type of residency they want. Do not give information about residency without explaining the official procedure and AFTER explaining the official procedure, DEFINITELY learn which type of residency they choose.

• Do not suggest a live consultant until the user shows clear and advanced intent such as “let’s start the process”, “I want to send documents” AND you have gathered the required parameters.
• When the user asks about payment and document submission process or document list process, state that a passport valid for at least 3 years (PDF copy) and a biometric photo are sufficient and provide contact information (via email or our communication channels) to send them. When the user asks questions like “payment, bank details, where to pay?”, provide bank details.
• NEVER use expressions like “you can share your documents with me, you can send your documents to me.” If document submission is required, provide contact information.
• NEVER recommend another company, freezone authority, lawyer or consultancy. You are already the corporate consultant of SamChe Company LLC; expressions like “get support from a consultant” are STRICTLY forbidden.
• Do not use ready answers unless the user message exactly matches the trigger expression. Do not make assumptions, open topics or direct.

TRUST QUESTIONS RULE:

When the user uses trust-questioning expressions such as:
“How can I trust you?”, “Is this real?”, “I don’t want to be scammed”, “send proof”, “send official document”, “give me confidence”:

• Use a professional, calm and corporate tone.
• NEVER ask the user for ID, passport, document, screenshot, personal information or contact details.
• Do not request email, phone number or any other contact detail from the user.
• Explain in a professional manner that SamChe Company LLC is an official company, processes are carried out transparently and all operations are conducted within a legal framework.
• Do not give exaggerated trust promises (“100% guarantee”, “absolutely no problem”).
• Do not direct the user to another company, lawyer or institution.
• Only explain the company’s corporate structure, service approach and process transparency.
• Provide clear, logical and professional explanations that will reassure the user.

AI CHATBOT RULES
- If the user asks specifically about **AI chatbot pricing**, you MUST redirect them to:
  https://aichatbot.samchecompany.com/
- You do NOT redirect users for any other topic.
- You never provide external links except the one above, and only when the user asks about AI chatbot pricing.

CONTACT INFORMATION RULES:

• FIRST provide detailed, deep and explanatory information answers.
• NEVER ask users for contact information.
• NEVER automatically add contact information to any answer.
• NEVER provide links in markdown format, only write them as plain text.
• NEVER use expressions like “Our consultant will contact you shortly”. WHILE DIRECTING THE CUSTOMER TO A LIVE CONSULTANT, YOU MUST PROVIDE CONTACT INFORMATION.


PAYMENT / BANK INFORMATION RULES:

• Even if the user wants to make a payment, do not immediately provide bank information.
• First provide detailed information, explain the process steps and confirm whether the user is really ready to start the process.
• Bank information is provided ONLY in the following case:
• If the user clearly uses expressions like “I will send documents”, “I want to make payment and start the process”.
• If the user is only asking for price, collecting information or researching, do not provide bank information.
• Bank information is NEVER automatically added; it is only shared when the user is ready to send documents or asks where to pay.
• If the user asks questions like “payment, bank details, where to pay?”, provide bank information.
• While sharing bank information, do not use markdown links, write as plain text.
• Do not use ready answers unless the user message exactly matches the trigger expression. Do not make assumptions, open topics or direct.

Bank details:
Account holder: SamChe Company LLC
Account Type: USD $
Account number: 9726414926
IBAN: AE210860000009726414926
BIC: WIOBAEADXXX
Bank address:
Etihad Airways Centre 5th Floor, Abu Dhabi, UAE

Contact information:
mail: info@samchecompany.com

Company Adress:
Sheikh Zayed Road Latifa Tower Office No 402

LIVE REPRESENTATIVE WhatsApp numbers:
- For Turkish language (tr): You MUST use +971 52 728 8586
- For English and all other languages: You MUST use +971 52 662 2875


If the user asks about travel to Dubai, residency, work permit, company formation, investment, cost, process, procedure:

• State that SamChe Company provides these services.
• Do not direct elsewhere.
• Do not create your own procedural texts.
• Speak only through the services offered by SamChe Company. - Do not use Gemini’s ready, template, automatic procedural texts, classical government explanations and template recommendations. However, you may explain up-to-date information, official process steps and real procedures in an original way. Template text is forbidden; up-to-date information and official process explanation are allowed. Speak only as the corporate consultant of SamChe Company LLC.
• Do not use ready answers unless the user message exactly matches the trigger expression. Do not make assumptions, open topics or direct.

DANIŞMANLIK ÜCRETİ YANIT KURALLARI

**Free Zone şirket kuruluşları için:**

* Kullanıcı doğrudan **danışmanlık ücretini sorarsa**, fiyat vermeden **resmi teklif alması gerektiğini** belirt.
* Kullanıcı danışmanlık ücretini sormadığı ve **maliyet analizi istemediği sürece**, danışmanlık ücretinden kesinlikle bahsetme.
* Kullanıcı danışmanlık ücretinde ısrar ederse veya **“fiyata dahil mi?”, “danışmanlık ücreti ne kadar?”** gibi sorularla net fiyat talep ederse, **Free Zone şirket kuruluşlarında danışmanlık ücretinin 8.000 AED olduğunu** belirt.
* **8.000 AED danışmanlık ücretine banka hesap açılışı ve KYC desteğinin dahil olduğunu** açıkça belirt.

**Mainland (Ana Kara) şirket kuruluşları için:**

* Kullanıcı doğrudan **danışmanlık ücretini sorarsa**, fiyat verme; **danışmanlık ücretlerinin ana karada sektöre göre belirlendiğini resmi teklif alması gerektiğini** belirt.
* Kullanıcı danışmanlık ücretini sormadığı ve **maliyet analizi istemediği sürece**, Mainland şirket kuruluşlarında danışmanlık ücretinden kesinlikle bahsetme.
* Kullanıcı danışmanlık ücretinde ısrar etse dahi, mevcut resmi teklif sürecine yönlendir ve **resmi teklif almadan fiyat belirtme**.

**Maliyet hesaplamalarında uygulanacak genel kural:**

* Kullanıcı herhangi bir **şirket kuruluşu maliyet hesaplaması, toplam maliyet veya fiyat analizi** istediğinde, hesaplanan toplam tutarın **danışmanlık ücretini içermediğini** mutlaka açıkça belirt.
* Maliyet analizinin sonunda şu anlamı net şekilde ifade et: **“Belirtilen maliyetlere danışmanlık ücreti dahil değildir.”**
* Danışmanlık ücretinin dahil olmadığı belirtilirken, **banka hesap açılışı ve KYC desteğinin danışmanlık hizmeti kapsamında olduğu** ayrıca belirtilebilir.
* Kullanıcı danışmanlık ücretini ayrıca sormadığı sürece, maliyet analizinde danışmanlık ücretinin rakamını kendiliğinden açıklama.

**Önemli:** Danışmanlık ücretini kullanıcı sormadan veya açıkça maliyet analizi talep etmeden kendiliğinden gündeme getirme. Kullanıcının sorusuna doğrudan cevap ver ve gereksiz fiyat bilgisi verme.

COMPANY FORMATION EXPLANATION RULE:

• Use ALL ready answers given below ONLY if the user clearly asks about this topic.
• Do not use ready answers unless the user message exactly matches the trigger expression. Do not make assumptions, open topics or direct.

User:
“I want to establish a company”
“How to establish a company in Dubai?”
“What is the company formation process?”
“I will establish a company”
“I want to establish a company”

If such questions are asked:

First explain Dubai’s official company formation process step by step:
• Company types (Mainland Company, Free Zone Company)
• Selection of commercial activity
• Trade name approval
• License application
• Office address / virtual office
• Incorporation documents
• Bank account opening
• Visa quota and residency rights
After explaining the official process, explain the services offered by SamChe Company in this process.
After explaining both, ask the user which sector they want to operate in (if already stated, do not ask again) and how many visas they need, and after receiving the answer, provide ALL details about company formation and inform the user, but while doing this, guide according to the sector and if it is a Mainland activity explain accordingly, if it is a Freezone-eligible activity explain accordingly.
Do not offer a live consultant unless the user clearly says “I want to start”, “I will send documents”, “I will make payment”.
DO NOT use early direction sentences like “If you want a detailed business plan and official offer…”. Only provide detailed information and answer questions.
First provide detailed information, answer questions and clarify the process. Direction is only done at payment and document stage.
NEVER use expressions like “you can send documents to me”. If needed, provide contact information.
When the user asks for company setup cost, first collect required data (visa count, region, sector etc.) and then provide estimated costs in detail. Do not suggest live consultant at this stage.
Do not suggest live consultant until advanced intent is shown.
If the user wants Freezone company:
• State that there are many freezones across UAE. If no physical office is needed, mention lower-cost options like Shams, SPC, RAKEZ, Ajman besides Dubai zones (Meydan, JAFZA, IFZA, DMCC).
• Proceed based on user’s sector and chosen freezone, NEVER randomly select.
Mainland-only sectors (cannot be Freezone):
-Restaurant, cafe, catering and food services
-Retail stores
-Construction
-Real estate brokerage
-Tourism agencies
-Security / CCTV
-Cleaning
-Transport / Uber
NEVER mention campaigns, promotions, payment plans when discussing costs.
NEVER include promotions in cost calculations.
NEVER say “contact freezone for exact cost” or similar.
Mainland companies DO NOT require local sponsor anymore. NEVER say otherwise.
If user asks about post-setup services:

List exactly:

1️⃣ PRO (Government Relations) Services
Employee visa applications
Investor / Partner visas
Work visa renewals
Emirates ID
Medical & biometrics
Immigration & labour card
License renewal
Company documents
Contract renewals
Visa quota management

2️⃣ Accounting & Finance
Monthly bookkeeping
VAT registration
VAT filing
Corporate tax advisory
Financial statements

3️⃣ Bank Account Support
Corporate account opening
KYC preparation

4️⃣ Office & Operations
Flexi desk / office
Virtual office
Meeting rooms
Phone & email management

5️⃣ Business Development & Marketing
Website setup
Digital marketing
Social media marketing

6️⃣ AI & Automation
AI chatbot
Instagram / WhatsApp automation
CRM integration
Sales automation systems

If the user already provided sector info, NEVER ask again.`
      },
      ...cleanMemory
    ];
    if (webChatIntegration && webChatRuntimePersona) {
      messages[0].content = buildTenantRuntimeSystemInstruction({
        persona: webChatRuntimePersona,
        knowledgeContext: webChatRuntimeKnowledge?.knowledgeContext ?? '',
        channelRules: 'Return safe HTML suitable for Web Chat. Do not reveal internal metadata.',
      });
    } else if (webChatRuntimeKnowledge) {
      messages[0].content = appendRuntimeKnowledgeToSystemInstruction(messages[0].content, webChatRuntimeKnowledge);
    }

    const completion = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages
    });

    const aiReply = completion.choices[0].message.content;
    if (webChatIntegration && webChatKnowledgeAuthority) {
      const currentKnowledgeAuthority = await resolveAssistantKnowledgeAuthority(pool, {
        tenantId: webChatIntegration.tenant_id,
        assistantId: webChatIntegration.assistant_id,
      });
      if (!isSameKnowledgeAuthority(currentKnowledgeAuthority, webChatKnowledgeAuthority)) {
        return res.status(409).json({ error: 'Knowledge changed while generating the response. Please retry.' });
      }
    }
    addWebMemory(userId, "assistant", aiReply, webChatKnowledgeAuthority);

    res.send(aiReply);
  } catch (err) {
    console.error("OpenAI Web Chatbot error:", err);
    res.status(500).send("AI error, please try again.");
  }
});

// ----------------------------------------------------------------------------
// C) WHATSAPP BOT (GEMINI 2.5 PRO) - /webhook ve /telegram-webhook
// ----------------------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ============================================================================
// WHATSAPP WEBHOOK (POST) - "TEK TIK" VE KİLİTLENME KESİN ÇÖZÜMÜ
// ============================================================================
app.post("/webhook", verifyWhatsAppSignature, (req, res) => {
  res.status(200).send("OK");

  (async () => {
    const whatsappRequestStartedAt = Date.now();
    const logWhatsAppTiming = (phase) => console.info(`WHATSAPP_MEDIA_TIMING phase=${phase} elapsed_ms=${Date.now() - whatsappRequestStartedAt}`);
    logWhatsAppTiming('webhook_received');
    try {
      const change = req.body.entry?.[0]?.changes?.[0]?.value ?? {};
      const phoneNumberId = change.metadata?.phone_number_id;
      const deliveryStatuses = Array.isArray(change.statuses) ? change.statuses : [];
      if (deliveryStatuses.length) {
        for (const status of deliveryStatuses) {
          await recordWhatsAppDeliveryStatus({ phoneNumberId, status, database: pool });
        }
        return;
      }

      const message = change.messages?.[0];
      if (!message) return;

      // --------------------------------------
      // WHATSAPP RETRY (TEKRAR) KORUMASI
      // --------------------------------------
      const wpMessageId = message.id;
      if (wpMessageId && processedWpMessages.has(wpMessageId)) return;
      if (wpMessageId) {
        processedWpMessages.add(wpMessageId);
        setTimeout(() => processedWpMessages.delete(wpMessageId), 2 * 60 * 1000);
      }

      const from = message.from;
      if (!from) return;

      const cleanFrom = from.replace("+", "");
      // phoneNumberId was resolved from the same webhook change above.
      let text = "";

      if (message.text?.body) text = message.text.body;
      else if (message.button?.text) text = message.button.text;
      else if (message.interactive?.button_reply?.title) text = message.interactive.button_reply.title;
      else if (message.interactive?.list_reply?.title) text = message.interactive.list_reply.title;
      else if (message.image?.caption) text = message.image.caption;
      else if (message.document?.caption) text = message.document.caption;

      text = (text || "").trim();
      const mediaDescriptor = extractWhatsAppMediaDescriptor(message);
      let whatsappInbox = null;
      let resourceFollowUp = { action: 'CONTINUE' };
      try {
        if (!phoneNumberId) {
          console.error('WHATSAPP_INBOUND_UNMAPPED_PHONE');
          return;
        }
        let mediaBytes = null;
        if (mediaDescriptor) {
          const retrieveMedia = createWhatsAppMediaRetriever({
            http: axios,
            accessToken: process.env.WHATSAPP_TOKEN,
          });
          const media = await retrieveMedia(mediaDescriptor.externalMediaId);
          logWhatsAppTiming('media_download_complete');
          mediaDescriptor.declaredMimeType = media.declaredMimeType || mediaDescriptor.declaredMimeType;
          mediaDescriptor.originalFilename = media.filename || mediaDescriptor.originalFilename;
          mediaBytes = media.bytes;
        }
        whatsappInbox = await persistWhatsAppInbound({
          pool,
          phoneNumberId,
          customerPhone: cleanFrom,
          externalMessageId: wpMessageId,
          content: text,
          descriptor: mediaDescriptor,
          bytes: mediaBytes,
          ensureConversationCrmIdentity,
          queueLeadQualification,
        });
        logWhatsAppTiming('resource_persistence_complete');
        if (whatsappInbox?.resource) {
          console.info(`WHATSAPP_MEDIA_TIMING phase=resource_status_${whatsappInbox.resource.processing_status} elapsed_ms=${Date.now() - whatsappRequestStartedAt}`);
          if (whatsappInbox.resource.processing_status === 'FAILED') console.info(`WHATSAPP_RESOURCE_FAILURE stage=processing failure_code=${whatsappInbox.resource.failure_code ?? 'RESOURCE_PROCESSING_FAILED'}`);
        }
        if (!whatsappInbox || whatsappInbox.unmapped) {
          console.error(
            'WHATSAPP_INBOUND_UNMAPPED_PHONE runtime_db_identity=' +
            (whatsappInbox?.runtimeDbIdentity ?? 'unavailable') +
            ' phone_id_hash=' + (whatsappInbox?.phoneNumberFingerprint ?? 'unavailable')
          );
          return;
        }
        if (whatsappInbox.duplicate || !whatsappInbox.shouldInvokeAi) return;
        resourceFollowUp = planWhatsAppResourceFollowUp({
          customerText: text,
          readyResourceCount: whatsappInbox.aiContextParts?.length ?? 0,
          processingResourceCount: whatsappInbox.resourceContext?.processingResourceCount ?? 0,
        });
        if (resourceFollowUp.action === 'RESOURCE_PROCESSING') {
          const runtimeSessionKey = whatsappRuntimeSessionKey({
            tenantId: whatsappInbox.integration.tenant_id,
            assistantId: whatsappInbox.integration.assistant_id,
            customerPhone: cleanFrom,
          });
          const processingMessage = resourceProcessingAcknowledgement(wpSessions[runtimeSessionKey]?.lang ?? 'tr');
          const persisted = await persistAssistantResponseIfCurrent({
            tenantId: whatsappInbox.integration.tenant_id,
            conversationId: whatsappInbox.conversation.id,
            content: processingMessage,
            handlingVersion: whatsappInbox.handlingVersion,
            knowledgeAuthority: whatsappInbox.knowledgeAuthority,
          });
          if (persisted.delivered) await sendMessage(cleanFrom, processingMessage);
          return;
        }
        const latestResourcePlan = planLatestExplicitResource({
          explicit: resourceFollowUp.action !== 'CONTINUE',
          latestResource: whatsappInbox.resourceContext?.latestResource,
        });
        if (latestResourcePlan.action === 'RESOURCE_FAILED') {
          const runtimeSessionKey = whatsappRuntimeSessionKey({
            tenantId: whatsappInbox.integration.tenant_id,
            assistantId: whatsappInbox.integration.assistant_id,
            customerPhone: cleanFrom,
          });
          const failureMessage = resourceFailureAcknowledgement(wpSessions[runtimeSessionKey]?.lang ?? 'tr', whatsappInbox.resourceContext.latestResource.media_category);
          const persisted = await persistAssistantResponseIfCurrent({ tenantId: whatsappInbox.integration.tenant_id, conversationId: whatsappInbox.conversation.id, content: failureMessage, handlingVersion: whatsappInbox.handlingVersion, knowledgeAuthority: whatsappInbox.knowledgeAuthority });
          if (persisted.delivered) await sendMessage(cleanFrom, failureMessage);
          return;
        }
        const standaloneMediaPlan = planStandaloneWhatsAppMediaResponse({
          customerText: text,
          descriptor: mediaDescriptor,
          shouldInvokeAi: whatsappInbox.shouldInvokeAi,
          duplicate: whatsappInbox.duplicate,
          language: whatsappInbox.tenantContext?.mediaResponseLanguage ?? whatsappInbox.tenantContext?.communicationLanguage ?? 'en',
        });
        if (standaloneMediaPlan.action === 'ACKNOWLEDGE') {
          const acknowledgement = await persistAssistantResponseIfCurrent({
            tenantId: whatsappInbox.integration.tenant_id,
            conversationId: whatsappInbox.conversation.id,
            content: standaloneMediaPlan.message,
            handlingVersion: whatsappInbox.handlingVersion,
            knowledgeAuthority: whatsappInbox.knowledgeAuthority,
          });
          if (acknowledgement.delivered) {
            await sendMessage(cleanFrom, standaloneMediaPlan.message);
          }
          return;
        }
        if (!text && mediaDescriptor) text = 'Customer shared an attachment.';
      } catch (error) {
        if (error?.code === 'RESOURCE_STORAGE_WRITE_FAILED') {
          console.error('WHATSAPP_MEDIA_INGESTION_FAILED', safeWhatsAppStorageFailureLog(error));
        } else {
          console.error('WHATSAPP_MEDIA_INGESTION_FAILED', error?.code ?? 'UNKNOWN', error?.safeDiagnostic ? JSON.stringify(error.safeDiagnostic) : '');
        }
        return;
      }

      // 🔥 TELEGRAMA BİLDİRİM FORWARD ET (Ateşle ve Unut)
      sendMessageToTelegram(`WhatsApp → +${cleanFrom}: ${text}`).catch(() => {});

      // 🔥 MAVİ TIK (OKUNDU) ONAYI (Ateşle ve Unut)
      if (wpMessageId) {
        axios.post(
          `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
          { messaging_product: "whatsapp", status: "read", message_id: wpMessageId },
          { httpsAgent, headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, timeout: 10000 }
        ).catch(() => {});
      }

      // --------------------------------------
      // SESSION OLUŞTURMA VE BAŞLANGIÇ
      // --------------------------------------
      const runtimeSessionKey = whatsappRuntimeSessionKey({
        tenantId: whatsappInbox.integration.tenant_id,
        assistantId: whatsappInbox.integration.assistant_id,
        customerPhone: cleanFrom,
      });
      if (!wpSessions[runtimeSessionKey]) {
        wpSessions[runtimeSessionKey] = {
          lang: null, history: [], lastMessageTime: Date.now(), followUpStage: 0,
          intentScore: 0, topics: [],
          profile: { name: null, country: null, budget: null, interest: null },
          firstMessageTime: Date.now(), pingSentOnce: false, humanOverride: false,
          manualTakeover: false, lastUserText: ""
        };
      }

      const session = wpSessions[runtimeSessionKey];
      session.tenantId = whatsappInbox.integration.tenant_id;
      session.assistantId = whatsappInbox.integration.assistant_id;
      const lower = text.toLowerCase();

      const now = Date.now();

      // 🔥 SPAM FİLTRESİ HATA ÇÖZÜMÜ: SADECE BOT MODUNDAYKEN SPAM FİLTRESİ ÇALIŞIR
      if (!session.humanOverride && session.lastUserText === text && (now - session.lastMessageTime) < 30000) {
        return;
      }

      session.lastUserText = text;
      session.lastMessageTime = now;

      // ====================================================================
      // 🔥 CANLI DESTEK AÇIKSA BOT BURADA DURUR VE SADECE DİNLER 🔥
      // ====================================================================
      if (session.humanOverride) {
        // Müşteri canlı desteği sonlandırmak isterse:
        if (lower === "/end" || lower === "/bot" || lower === "bot" || lower === "kapat") {
          session.humanOverride = false;
          session.manualTakeover = false;
          session.lastUserText = ""; // KİLİTLENMEYİ ÖNLER
          let closeMsg = `🔒 Canlı destek oturumu sona ermiştir.\n\nYapay zeka asistanımızla sohbete devam edebilir ya da canlı temsilciye tekrar bağlanmak isterseniz sohbet alanına 'canlı destek' yazmanız yeterlidir.\nEkibimiz size her zaman yardımcı olmaktan mutluluk duyacaktır.`;
          if (session.lang === "en") closeMsg = `🔒 This chat session has ended.\n\nYou may continue chatting with our AI assistant, or type 'live support' anytime to reconnect. Our team will be happy to assist you anytime.`;
          if (session.lang === "ar") closeMsg = `🔒 انتهت جلسة الدردشة هذه.\n\nيمكنك متابعة الدردشة مع مساعد الذكاء الاصطناعي أو كتابة 'دعم مباشر' للاتصال بممثل.`;
          sendMessage(cleanFrom, closeMsg).catch(()=>{});
          sendMessageToTelegram(`Canlı destek kapatıldı → +${cleanFrom}`).catch(()=>{});
          return;
        }

        return; // Botu susturuyoruz. İletim zaten yukarıda Telegram'a yapıldı.
      }

      // Gelen içerik desteklenmiyorsa
      const isInvalid = ((!text || text === "") && !mediaDescriptor) || message.type === "video" || message.type === "sticker";
      if (isInvalid) {
        if (!session.humanOverride) {
          await persistAndSendWhatsAppAssistant(whatsappInbox, cleanFrom, "Gönderdiğiniz içeriği işleyemiyorum. Lütfen mesajınızı yazılı olarak iletin.");
        }
        return;
      }

      // --------------------------------------
      // DİL TESPİTİ VE İLK MESAJLAR
      // --------------------------------------
      const tenantContext = whatsappInbox?.tenantContext;
      if (!tenantContext) {
        console.error('WHATSAPP_TENANT_CONTEXT_UNAVAILABLE');
        return;
      }
      const lang = ['tr', 'en', 'ar'].includes(tenantContext.communicationLanguage)
        ? tenantContext.communicationLanguage
        : 'en';
      session.lang = lang;

      let runtimeTenantContext;
      let runtime;
      try {
        runtime = await resolveChannelAssistantRuntime({
          database: pool,
          embed: knowledgeEmbedder,
          scope: whatsappInbox.integration,
          query: text,
          channelType: 'WHATSAPP',
          resolvePersona: resolveTenantRuntimePersona,
          resolveKnowledge: resolveAssistantRuntimeKnowledgeContext,
          resolveModel: () => googleGeminiProvider.runtimeMetadata(),
        });
        runtimeTenantContext = buildWhatsAppActivePersonaTenantContext({
          persona: runtime.persona,
          knowledgeContext: runtime.knowledge.knowledgeContext,
          communicationLanguage: tenantContext.communicationLanguage,
        });
        console.info(
          'KNOWLEDGE_RUNTIME_CONTEXT channel=WHATSAPP active_configuration=' + (runtime.knowledge.activeConfiguration ? '1' : '0') +
          ' retrieved_chunks=' + runtime.knowledge.knowledge.length +
          ' retrieval_available=' + (runtime.knowledge.retrievalAvailable ? '1' : '0') +
          ' provider_mode=' + runtime.mode + ' model=' + runtime.model
        );
      } catch (error) {
        console.error('KNOWLEDGE_RUNTIME_CONTEXT_UNAVAILABLE code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
        await persistAndSendWhatsAppAssistant(whatsappInbox, cleanFrom, resolveWhatsAppPersonaUnavailableResponse(tenantContext.communicationLanguage));
        return;
      }

      const currentIntent = classifyWhatsAppCurrentCustomerIntent(text);
      const deterministicDetectedLanguage = inferWhatsAppDeterministicInboundLanguage(text);
      const deterministicTemplateLanguage = resolveWhatsAppDeterministicTemplateLanguage({ currentInboundMessage: text, detectedLanguage: deterministicDetectedLanguage });
      const deterministicSocialResponse = planWhatsAppDeterministicSocialResponse({
        tenant: runtimeTenantContext,
        communicationLanguage: tenantContext.communicationLanguage,
        currentInboundMessage: text,
        detectedLanguage: deterministicDetectedLanguage,
        currentIntent,
        firstAssistantResponse: whatsappInbox.isFirstAssistantResponse,
      });
      if (deterministicSocialResponse) {
        console.info(
          'WHATSAPP_RESPONSE_POLICY current_intent=' + currentIntent +
          ' first_assistant_response=' + (whatsappInbox.isFirstAssistantResponse ? '1' : '0') +
          ' model_invoked=0 deterministic_kind=' + deterministicSocialResponse.kind +
          ' current_detected=' + deterministicDetectedLanguage +
          ' template_language=' + deterministicTemplateLanguage +
          ' persisted_language=' + tenantContext.communicationLanguage
        );
        await persistAndSendWhatsAppAssistant(whatsappInbox, cleanFrom, deterministicSocialResponse.content);
        return;
      }

      // --------------------------------------
      // FOLLOW-UP RESETLERİ
      // --------------------------------------
      session.followUpStage = 0;
      session.pingSentOnce = false;

      // --------------------------------------
      // CUSTOMER-REQUESTED HUMAN SUPPORT
      // The explicit customer request is handled before normal model routing.
      // A bare request stays zero-token; meaningful context permits exactly
      // one legacy topic-summary call.
      // --------------------------------------
      const humanSupportRequest = parseCustomerHumanSupportRequest(text);
      if (humanSupportRequest.requested) {
        const supportTemplates = tenantContext?.deterministicTemplates?.human_support;
        const topicSummary = humanSupportRequest.hasMeaningfulContext
          ? await getTopicSummary(session, text)
          : supportTemplates?.general_topic?.[lang];
        const transferTemplates = supportTemplates?.transfer;
        const transfer = transferTemplates?.[lang] ?? transferTemplates?.tr;
        if (!transfer) {
          console.error('WHATSAPP_HUMAN_SUPPORT_TEMPLATE_UNAVAILABLE');
          return;
        }
        if (typeof topicSummary !== 'string' || !topicSummary.trim()) {
          console.error('WHATSAPP_HUMAN_SUPPORT_TEMPLATE_UNAVAILABLE');
          return;
        }
        const acknowledgement = transfer.replace(/{{topicSummary}}/g, topicSummary);
        const handoff = await requestCustomerHumanSupport({
          tenantId: whatsappInbox.integration.tenant_id,
          conversationId: whatsappInbox.conversation.id,
          acknowledgement,
          topicSummary,
        });
        if (!handoff.duplicate) {
          await sendMessage(cleanFrom, acknowledgement);
          sendMessageToTelegram(`🚨 CANLI TEMSİLCİ TALEBİ!\n📞 Numara: +${cleanFrom}\n💬 Konu: ${topicSummary}\n\nCevap göndermek için tek tıkla kopyala:\n\`/w +${cleanFrom} \``).catch(() => {});
        }
        return;
      }

      // --------------------------------------
      // KISA CEVAPLAR
      // --------------------------------------
      // --------------------------------------
      // TARİHÇE VE SKOR
      // --------------------------------------
      session.history.push({ role: "user", text });
      if (session.history.length > 10) session.history.shift();

      const topic = detectTopic(text);
      if (!session.topics) session.topics = [];
      if (topic !== "other" && !session.topics.includes(topic)) session.topics.push(topic);
      session.intentScore = calculateIntentScore(text, session.intentScore || 0);

      if (lower.includes("yapay zeka") || lower.includes("ai ") || lower.includes("bot") || lower.includes("otomasyon")) {
        if (!session.topics.includes("Yapay Zeka / Chatbot")) session.topics.push("Yapay Zeka / Chatbot");
      }

      const historyText = session.history.map((m) => `${m.role === "user" ? "User" : "Model"}: ${m.text}`).join("\n");

      // --------------------------------------
      // BÜYÜK DİL PROMPTLARI
      // --------------------------------------
      let modelContext;
      try {
        modelContext = buildWhatsAppTenantModelContext({
          tenant: runtimeTenantContext,
          history: whatsappInbox.conversationHistory,
          customerText: text,
          communicationLanguage: tenantContext.communicationLanguage,
        });
      } catch (error) {
        const reason = error instanceof WhatsAppTenantContextError
          ? error.code
          : 'WHATSAPP_TENANT_CONTEXT_UNAVAILABLE';
        console.error('WHATSAPP_TENANT_CONTEXT_UNAVAILABLE', reason);
        return;
      }
      console.info(
        'WHATSAPP_RESPONSE_POLICY current_intent=' + modelContext.currentIntent +
        ' first_assistant_response=' + (modelContext.firstResponse ? '1' : '0') +
        ' model_invoked=1'
      );

      // --------------------------------------
      // YAPAY ZEKA API ÇAĞRISI
      // --------------------------------------
      logWhatsAppTiming('model_request_started');
      let aiResponse = await callWpGemini(
        modelContext.userPrompt,
        whatsappInbox?.aiContextParts ?? (whatsappInbox?.aiContextPart ? [whatsappInbox.aiContextPart] : []),
        modelContext.systemInstruction,
        runtime.model,
      );
      let responseLanguage = detectWhatsAppModelResponseLanguage(aiResponse);
      const expectedLanguage = tenantContext.communicationLanguage;
      console.info('WHATSAPP_LANGUAGE_TRACE previous=' + (whatsappInbox.languageTrace?.previous ?? 'und') +
        ' detected=' + (whatsappInbox.languageTrace?.detected ?? 'und') +
        ' resolved=' + expectedLanguage + ' persisted=' + (whatsappInbox.languageTrace?.persisted ?? expectedLanguage) +
        ' context=' + expectedLanguage + ' response_lock=' + expectedLanguage + ' session=' + (session.lang ?? 'und') +
        ' model_response_detected=' + responseLanguage);
      if (aiResponse && isWhatsAppResponseLanguageMismatch({ expectedLanguage, responseContent: aiResponse })) {
        const firstResponseLanguage = responseLanguage;
        aiResponse = await callWpGemini(
          modelContext.userPrompt + '\n\nLANGUAGE_COMPLIANCE_RETRY: The prior response violated the required output language. Respond only in ' + expectedLanguage + ' while preserving the same tenant business policy and answer.',
          whatsappInbox?.aiContextParts ?? (whatsappInbox?.aiContextPart ? [whatsappInbox.aiContextPart] : []),
          modelContext.systemInstruction,
          runtime.model,
        );
        responseLanguage = detectWhatsAppModelResponseLanguage(aiResponse);
        console.info('LANGUAGE_COMPLIANCE_RETRY triggered=1 required=' + expectedLanguage + ' first_response=' + firstResponseLanguage + ' retry_response=' + responseLanguage);
        if (aiResponse && isWhatsAppResponseLanguageMismatch({ expectedLanguage, responseContent: aiResponse })) {
          console.error('LANGUAGE_COMPLIANCE_RETRY status=FAILED required=' + expectedLanguage);
          aiResponse = corporateFallback(expectedLanguage);
          responseLanguage = expectedLanguage;
        }
      }

      logWhatsAppTiming('model_response_complete');
      if (!aiResponse) {
        await persistAndSendWhatsAppAssistant(whatsappInbox, cleanFrom, corporateFallback(session.lang || "en"));
        return;
      }

      const lowerAi = aiResponse.toLowerCase();

      // Model text is conversational only. A human-support transition may
      // originate from the customer request above, never from model wording.
      await persistAndSendWhatsAppAssistant(whatsappInbox, cleanFrom, aiResponse);
      session.history.push({ role: "assistant", text: aiResponse });
      return;

    } catch (error) {
      console.error("WhatsApp webhook error:", error);
    }
  })();
}); // WHATSAPP WEBHOOK KAPANIŞI

// ============================================================================
// TELEGRAM WEBHOOK — NORMAL MESAJ + CANLI DESTEK
// ============================================================================
app.post("/telegram-webhook", (req, res) => {
  res.status(200).send("OK");

  (async () => {
    try {
      const updateId = req.body?.update_id;
      if (updateId && processedTgUpdates.has(updateId)) {
        return;
      }
      if (updateId) {
        processedTgUpdates.add(updateId);
        setTimeout(() => processedTgUpdates.delete(updateId), 10 * 60 * 1000);
      }

      const msg = req.body.message;
      if (!msg || !msg.text) return;

      const chatId = msg.chat.id.toString();
      const text = msg.text.trim();

      if (!text.startsWith("/w ") && !text.startsWith("/end ")) {
        return;
      }

      if (process.env.TELEGRAM_CHAT_ID && chatId !== process.env.TELEGRAM_CHAT_ID) {
        return;
      }

      // ------------------------------------------------------
      // 3) /w KOMUTU → CANLI DESTEK BAŞLAT / MESAJ GÖNDER
      // ------------------------------------------------------
      if (text.startsWith("/w ")) {
        const parts = text.split(" ");
        const to = parts[1];
        const cleanTo = to?.replace("+", "");
        const message = parts.slice(2).join(" ");

        if (!cleanTo || !message) {
          sendMessageToTelegram("Format yanlış. Örnek:\n/w +905551112233 Merhaba").catch(()=>{});
          return;
        }

        if (!wpSessions[cleanTo]) {
          wpSessions[cleanTo] = {
            lang: "tr", history: [], lastMessageTime: Date.now(), followUpStage: 0,
            intentScore: 0, topics: [], profile: { name: null, country: null, budget: null, interest: null },
            firstMessageTime: Date.now(), pingSentOnce: false, humanOverride: false,
            manualTakeover: false, lastUserText: ""
          };
        }
        const session = wpSessions[cleanTo];

        if (!session.humanOverride) {
          session.humanOverride = true;
          session.manualTakeover = true;

          let takeoverMsg = `DİKKAT⚠️ Canlı temsilcimiz bu konuşmayı devralmıştır. Lütfen sohbete bağlanana kadar beklemede kalın ⌛️ \n\n ⚠️Canlı temsilci bu konuşmayı sonlandırmadığı sürece yapay zeka danışmanı devre dışıdır.🔒`;
          if (session.lang === "en") takeoverMsg = `Our live representative has taken over the conversation. Please stay on hold...\n\nAs SamChe AI, the AI is deactivated until the live representative ends your conversation.`;
          if (session.lang === "ar") takeoverMsg = `تولى ممثلنا المباشر المحادثة. يرجى البقاء على الخط...\n\nبصفتي SamChe AI، تم إلغاء تنشيط الذكاء الاصطناعي حتى ينهي الممثل المباشر محادثتك.`;

          try { await sendMessage(cleanTo, takeoverMsg); } catch(e) {}
        }

        session.lastMessageTime = Date.now();
        session.warning5MinSent = false;
        session.lastUserText = ""; // KİLİTLENMEYİ ÖNLER

        try {
          await sendMessage(cleanTo, message);
          sendMessageToTelegram(`Gönderildi → WhatsApp +${cleanTo}:\n${message}\n\nSohbeti bitirmek için kopyala:\n\`/end +${cleanTo}\``).catch(()=>{});
        } catch(e) {
          sendMessageToTelegram(`Mesaj iletilemedi! Lütfen tekrar deneyin.`).catch(()=>{});
        }

        return;
      }

      // ------------------------------------------------------
      // 4) /end KOMUTU → CANLI DESTEK KAPAT
      // ------------------------------------------------------
      if (text.startsWith("/end ")) {
        const parts = text.split(" ");
        const to = parts[1];
        const cleanTo = to?.replace("+", "");

        if (!cleanTo) {
          sendMessageToTelegram("Format yanlış. Örnek:\n/end +905551112233").catch(()=>{});
          return;
        }

        if (!wpSessions[cleanTo]) wpSessions[cleanTo] = {};

        wpSessions[cleanTo].humanOverride = false;
        wpSessions[cleanTo].manualTakeover = false;
        wpSessions[cleanTo].warning5MinSent = false;
        wpSessions[cleanTo].lastUserText = ""; // KİLİTLENMEYİ ÖNLER

        let closeMessage = "🔒 Bu sohbet oturumu sona ermiştir.\n\nBaşka sorularınız varsa veya ek yardıma ihtiyacınız olursa, lütfen istediğiniz zaman tekrar bizimle iletişime geçmekten çekinmeyin. Canlı Destek Ekibimiz size yardımcı olmaktan mutluluk duyacaktır.";
        if (wpSessions[cleanTo]?.lang === "en") closeMessage = "🔒 This chat session has ended.\n\nIf you have further questions or need additional assistance, please feel free to reach out again anytime. Our Live Support Team will be happy to assist you.";
        if (wpSessions[cleanTo]?.lang === "ar") closeMessage = "🔒 انتهت جلسة الدردشة هذه.\n\nإذا كانت لديك أسئلة أخرى أو احتجت إلى مساعدة إضافية، فلا تتردد في الاتصال بنا مرة أخرى في أي وقت. سيسعد فريق الدعم المباشر لدينا بمساعدتك.";

        try { await sendMessage(cleanTo, closeMessage); } catch (e) {}
        sendMessageToTelegram(`Canlı destek kapatıldı → +${cleanTo}`).catch(()=>{});

        return;
      }

    } catch (err) {
      console.error("Telegram webhook error:", err);
    }
  })();
});

// ============================================================================
// 6. CRON JOB (WHATSAPP FOLLOW-UP)
// ============================================================================
cron.schedule("* * * * *", async () => {
  try {
    let lifecycleActions;
    try {
      lifecycleActions = await claimDueCustomerSupportLifecycle({ database: pool });
      for (const action of lifecycleActions) {
        try {
          await sendMessage(action.recipient, action.content);
          console.info('HUMAN_SUPPORT_' + action.type + ' status=DELIVERED tenant=' + String(action.tenantId).slice(0, 8));
        } catch {
          console.error('HUMAN_SUPPORT_' + action.type + ' status=FAILED tenant=' + String(action.tenantId).slice(0, 8));
        }
        if (action.type === 'TIMEOUT_CLOSE') {
          sendMessageToTelegram(`Zaman Aşımı: Canlı destek kapatıldı → +${action.recipient}`).catch(() => {});
        }
      }
    } catch (error) {
      console.error('HUMAN_SUPPORT_LIFECYCLE_CRON status=FAIL reason=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
      lifecycleActions = [];
    }
    const now = Date.now();
    if (!wpSessions || typeof wpSessions !== "object") return;
    const users = Object.keys(wpSessions);
    if (!users.length) return;

    for (const user of users) {
      try {
        const s = wpSessions[user];
        if (!s || typeof s !== "object") continue;

        if (!s.lastMessageTime || isNaN(s.lastMessageTime)) s.lastMessageTime = Date.now();
        if (!s.followUpStage || isNaN(s.followUpStage)) s.followUpStage = 0;
        if (!s.pingSentOnce) s.pingSentOnce = false;

        if (s.warning5MinSent === undefined) s.warning5MinSent = false;

        const diffMinutesLast = (now - s.lastMessageTime) / (1000 * 60);
        const diffHoursLast = (now - s.lastMessageTime) / (1000 * 60 * 60);

        const topics = Array.isArray(s.topics) ? s.topics : [];
        const lastTopic = topics.length ? topics[topics.length - 1] : "general";
        const lang = typeof s.lang === "string" ? s.lang : "en";

        if (s.humanOverride) {
          if (s.manualTakeover) continue;

          if (diffMinutesLast >= 10) {
            s.humanOverride = false;
            s.warning5MinSent = false;
            s.lastUserText = ""; // KİLİTLENMEYİ ÖNLER

            const autoCloseMsg = `🔒 Bu sohbet oturumu sona ermiştir.\n\nBaşka sorularınız varsa veya ek yardıma ihtiyacınız olursa, lütfen istediğiniz zaman tekrar bizimle iletişime geçmekten çekinmeyin. Canlı Destek Ekibimiz size yardımcı olmaktan mutluluk duyacaktır.`;

            try { await sendMessage(user, autoCloseMsg); } catch(e){}
            try { await sendMessageToTelegram(`Zaman Aşımı: Canlı destek kapatıldı → +${user}`); } catch(e){}

          } else if (diffMinutesLast >= 5 && !s.warning5MinSent) {
            s.warning5MinSent = true;

            const warningMsg = `⚠️Lütfen dikkat, bu sohbet oturumu 5 dakika sonra sona erecektir.\nEkibimizden yanıt beklerken oturumu aktif tutmak için bu sohbette mesaj gönderebilirsiniz.\n\nOturumunuz sona ererse, istediğiniz zaman tekrar bizimle iletişime geçmekten çekinmeyin; daha fazla sorunuzda size yardımcı olmaktan memnuniyet duyarız.`;

            try { await sendMessage(user, warningMsg); } catch(e){}
          } else if (diffMinutesLast < 5 && s.warning5MinSent) {
            s.warning5MinSent = false;
          }
          continue;
        }

        if (diffMinutesLast >= 10 && !s.pingSentOnce) {
          const pingMessage = await generateTenantFollowUpMessage({ session: s, stage: "10m" });
          if (pingMessage) {
            try { await sendMessage(user, pingMessage); } catch (e) {}
          }
          s.pingSentOnce = true;
          continue;
        }

        if (diffMinutesLast < 10 && s.pingSentOnce) s.pingSentOnce = false;

        if (s.followUpStage === 0 && diffHoursLast >= 3) {
          const msg = await generateTenantFollowUpMessage({ session: s, stage: "3h" });
          if (msg) { try { await sendMessage(user, msg); } catch {} }
          s.followUpStage = 1;
          continue;
        }
        if (s.followUpStage === 1 && diffHoursLast >= 24) {
          const msg = await generateTenantFollowUpMessage({ session: s, stage: "24h" });
          if (msg) { try { await sendMessage(user, msg); } catch {} }
          s.followUpStage = 2;
          continue;
        }
        if (s.followUpStage === 2 && diffHoursLast >= 48) {
          const msg = await generateTenantFollowUpMessage({ session: s, stage: "48h" });
          if (msg) { try { await sendMessage(user, msg); } catch {} }
          s.followUpStage = 3;
          continue;
        }
        if (s.followUpStage === 3 && diffHoursLast >= 72) {
          const msg = await generateTenantFollowUpMessage({ session: s, stage: "72h" });
          if (msg) { try { await sendMessage(user, msg); } catch {} }
          s.followUpStage = 4;
          continue;
        }
        if (s.followUpStage === 4 && diffHoursLast >= 168) {
          const msg = await generateTenantFollowUpMessage({ session: s, stage: "7d" });
          if (msg) { try { await sendMessage(user, msg); } catch {} }
          s.followUpStage = 5;
          continue;
        }
      } catch (err) {
        console.error("[CRON] User loop error:", err);
      }
    }
  } catch (err) {
    console.error("[CRON] Genel hata:", err);
  }
});

// ============================================================================
// 7. SUNUCU BAŞLATMA
// ============================================================================
app.get("/ping", (req, res) => {
  res.send("OK");
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await runMigrations();
    startKnowledgeWorkers();
    customerInvitationOutboxStartup = createCustomerInvitationOutboxStartup({
      database: pool,
      environment: process.env,
      onStatus: (status) => console.info(`CUSTOMER_INVITATION_OUTBOX_${status}`),
    });
    customerInvitationOutboxStartup.start();
    const server = app.listen(PORT, () => {
      console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor.`);
    });
    server.on('close', () => customerInvitationOutboxStartup?.stop());
    server.on('close', () => imageSemanticGenerationWorker?.());
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  }
}

startServer();

