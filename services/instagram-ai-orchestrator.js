import pool from '../config/db.js';
import { parseCustomerHumanSupportRequest } from './human-support-intent.js';
import { resolvePlatformHumanSupportPolicy } from './platform-lifecycle-message-service.js';
import { requestCustomerHumanSupport, triggerImmediateHumanSupportNotificationPipeline } from './human-support-service.js';
import { persistAssistantResponseIfCurrent } from './live-inbox-service.js';
import { deliverInstagramText, sendInstagramTypingIndicator } from './instagram-delivery-service.js';
import { resolveTenantRuntimePersona, buildTenantRuntimeSystemInstruction } from './tenant-runtime-persona-service.js';
import { resolveAssistantRuntimeKnowledgeContext } from './knowledge-runtime-context-service.js';
import { resolveCommunicationLanguage } from './conversation-communication-language.js';
import { evaluateChannelAiActivationPolicy } from './channel-ai-activation-policy-service.js';
import { applyWhatsAppAdaptivePacing } from './whatsapp-response-pacing-service.js';
import { createGoogleGeminiProvider } from './google-gemini-provider.js';

export const INSTAGRAM_CHANNEL_PRESENTATION_RULES = Object.freeze([
  'INSTAGRAM DM PRESENTATION & NATURAL HUMAN CONVERSATION RULES:',
  '1. CHANNEL MEDIUM: You are conversing directly with a customer inside an Instagram Direct Message (DM). Keep responses concise, clear, and natural like a seasoned human business consultant.',
  '2. DIRECT ANSWERS: Answer the customer’s actual question first. Do not add unnecessary filler greetings or generic pleasantries to every message.',
  '3. IDENTITY PRESENTATION RULES:',
  '   - DO NOT introduce yourself as an "AI", "AI Assistant", "bot", or "virtual assistant".',
  '   - DO NOT unnecessarily start messages with unsolicited company introductions (e.g. "Hello, I am...", "SamChe Company LLC olarak...", "SamChe Company olarak size yardımcı olabiliriz...").',
  '   - Normal business questions must be answered directly and naturally without stating company name unless the customer explicitly asks.',
  '   - WHEN TO DISCLOSE COMPANY IDENTITY: Only mention company identity if the customer explicitly asks who you are ("Siz kimsiniz?", "Şirket misiniz?", "Resmi kurum musunuz?", "Hangi firmayla görüşüyorum?"), or for company contact/contract/invoice questions.',
  '   - NON-GOVERNMENT ENTITY CLARIFICATION: When asked if you are an official/government authority, clarify truthfully and politely that you are a private corporate consultancy and business setup services provider. NEVER imply that SamChe Company LLC is a UAE government authority, immigration authority, Free Zone authority, bank, or government entity.',
  '4. LANGUAGE & CONVERSATION FLOW:',
  '   - Respond in the customer’s language. When the customer writes in Turkish, respond in natural, professional Turkish.',
  '   - Do not repeat "How can we help you?" or "Nasıl yardımcı olabilirim?" on every message.',
  '   - Use multi-turn conversation history: remember details provided earlier in the chat and never ask again for information the customer has already given.',
  '5. FORMATTING RULES (CRITICAL FOR READABILITY):',
  '   - When presenting lists of 2 or more items (numbered 1., 2., 3. or bullet points •), EACH item MUST be placed on its own separate line.',
  '   - NEVER concatenate list items horizontally onto the same line.',
  '   - Separate distinct points with clean paragraph breaks so the message is effortless to read on mobile DM screens.',
  '6. STRICT FACTUAL GROUNDING:',
  '   - Ground all statements strictly in the active approved Business Profile and approved Knowledge.',
  '   - Never invent prices, legal requirements, approvals, guarantees, or unsupported claims.',
].join('\n'));


/**
 * Normalizes and formats AI response text for optimal readability in Instagram Direct Messages.
 * Guarantees vertical separation of list items and clean paragraph breaks.
 */
export function formatInstagramDmResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();

  // Strip markdown headers like ### or ## at line starts
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Fix horizontally concatenated numbered lists: e.g. "1. First 2. Second 3. Third" -> "1. First\n\n2. Second\n\n3. Third"
  text = text.replace(/([^\n])\s+(\d+\.\s+)/g, '$1\n\n$2');

  // Fix horizontally concatenated bullet points: e.g. "• Item 1 • Item 2" or "- Item 1 - Item 2" -> "• Item 1\n• Item 2"
  text = text.replace(/([^\n])\s+([•\-\*]\s+)/g, '$1\n$2');

  // Normalize excessive blank lines (more than 2 consecutive newlines to 2)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Loads recent chronological conversation history for multi-turn AI context.
 */
async function loadRecentConversationHistory(database, tenantId, conversationId, limit = 10) {
  try {
    const res = await database.query(
      `SELECT id, sender_type, content, created_at
         FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [tenantId, conversationId, limit]
    );
    return (res.rows || []).reverse().map((msg) => ({
      role: msg.sender_type === 'CUSTOMER' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }],
      sender_type: msg.sender_type,
      content: msg.content,
    }));
  } catch (err) {
    console.warn('INSTAGRAM_LOAD_HISTORY_WARN', err?.message);
    return [];
  }
}

/**
 * Invokes the canonical Google Gemini provider with active system instruction & history.
 */
async function defaultGenerateInstagramAiResponse({
  systemInstruction,
  text,
  conversationHistory = [],
  model = null,
}) {
  let provider;
  try {
    provider = createGoogleGeminiProvider();
  } catch (providerErr) {
    console.error('INSTAGRAM_GEMINI_PROVIDER_INIT_ERROR', providerErr?.message);
    return null;
  }

  const runtimeModel = model || provider.runtimeMetadata().model;

  // Prepare Gemini contents from history
  const contents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const h of conversationHistory) {
      if (h.role && Array.isArray(h.parts) && h.parts.length > 0 && h.parts[0]?.text) {
        contents.push({ role: h.role, parts: h.parts });
      }
    }
  }

  // Ensure current user message is at the end if not already present
  if (contents.length === 0 || contents[contents.length - 1].role !== 'user' || contents[contents.length - 1].parts?.[0]?.text !== text) {
    contents.push({ role: 'user', parts: [{ text }] });
  }

  try {
    const response = await provider.generateContent({
      model: runtimeModel,
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (genErr) {
    console.error(`INSTAGRAM_AI_GENERATION_ERROR model=${runtimeModel} code=${genErr?.code ?? 'UNKNOWN'} err=${genErr?.message}`);
    return null;
  }
}

export async function orchestrateInstagramInboundAiResponse({
  database = pool,
  inboundState,
  senderIgsid,
  text = '',
  http,
  embed = null,
  generateAiResponse,
  generateAiClassification,
}) {
  if (!inboundState || inboundState.duplicate || !inboundState.integration || !inboundState.conversation) {
    return { skipped: true, reason: 'INVALID_INBOUND_STATE' };
  }

  const { integration, conversation, handlingVersion } = inboundState;
  const tenantId = integration.tenant_id;
  const conversationId = conversation.id;
  const assistantId = integration.assistant_id;
  const assistantModel = integration.assistant_model || null;

  const accessToken = integration.config?.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const accountId = integration.config?.instagram_account_id || integration.config?.instagram_business_account_id || integration.config?.page_id || integration.external_channel_id;

  // 1. Human Support Intent check (Ownership transition precedes AI generation)
  const humanSupport = parseCustomerHumanSupportRequest(text);
  if (humanSupport.requested) {
    const lang = resolveCommunicationLanguage({
      currentLanguage: conversation.communication_language || 'en',
      content: text,
    });

    let handoffPolicy;
    try {
      handoffPolicy = await resolvePlatformHumanSupportPolicy({ database, locale: lang });
    } catch {
      handoffPolicy = {
        defaultTopic: 'Customer Support Request',
        acknowledgement: () => lang === 'tr'
          ? 'Canlı temsilcimize aktarıyorum, lütfen beklemede kalın.'
          : 'Connecting you to a representative, please hold on.',
      };
    }

    const acknowledgement = typeof handoffPolicy.acknowledgement === 'function'
      ? handoffPolicy.acknowledgement(humanSupport.topic || handoffPolicy.defaultTopic)
      : 'Connecting you to a representative, please hold on.';

    const handoff = await requestCustomerHumanSupport({
      tenantId,
      conversationId,
      acknowledgement,
      topicSummary: handoffPolicy.defaultTopic,
      database,
    });

    if (!handoff.duplicate && accessToken) {
      try {
        await deliverInstagramText({
          recipientId: senderIgsid,
          content: acknowledgement,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          http,
        });
      } catch (err) {
        console.warn('INSTAGRAM_HANDOFF_ACK_DELIVERY_WARN', err?.message);
      }
    }

    await triggerImmediateHumanSupportNotificationPipeline({
      database,
      tenantId,
      conversationId,
    }).catch((err) => {
      console.error('INSTAGRAM_PUSH_NOTIFICATION_TRIGGER_ERROR', err?.message);
    });

    return { handoff: true, handoffOutcome: handoff };
  }

  // 2. Check AI eligibility (must be in AI handling mode and conversation open)
  if (!inboundState.shouldInvokeAi) {
    return { aiInvoked: false, reason: 'NOT_IN_AI_MODE' };
  }

  // 3. Evaluate generic Channel AI Activation Policy & Contact/Conversation Overrides
  const activationEvaluation = await evaluateChannelAiActivationPolicy({
    messageText: text,
    conversation,
    channelConfig: integration.config,
    tenantContext: {
      tenantId,
      assistantId,
    },
    generateAiClassification,
  });

  if (!activationEvaluation.eligible) {
    console.info(
      `INSTAGRAM_AI_ACTIVATION_SUPPRESSED tenant=${tenantId ? tenantId.slice(0, 8) : 'unknown'}` +
      ` conversation=${conversationId ? conversationId.slice(0, 8) : 'unknown'}` +
      ` policy=${activationEvaluation.policy}` +
      ` reason=${activationEvaluation.reasonCode}`
    );
    return {
      aiInvoked: false,
      suppressed: true,
      activationEvaluation,
    };
  }

  // 4. Verify Latest Message is CUSTOMER and Unanswered (guards against duplicates/races)
  try {
    const msgCheck = await database.query(
      `SELECT id, sender_type, content, created_at
         FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [tenantId, conversationId]
    );
    const latest = msgCheck.rows?.[0];
    if (latest && latest.sender_type !== 'CUSTOMER') {
      return { skipped: true, reason: 'ALREADY_ANSWERED' };
    }
  } catch (chkErr) {
    console.warn('INSTAGRAM_MSG_CHECK_WARN', chkErr?.message);
  }

  // 5. Resolve Active Persona and Knowledge context
  let persona = null;
  let knowledge = null;

  try {
    persona = await resolveTenantRuntimePersona({
      database,
      tenantId,
      assistantId,
    });
  } catch (personaErr) {
    console.warn('INSTAGRAM_AI_PERSONA_WARN', personaErr?.message);
  }

  try {
    knowledge = await resolveAssistantRuntimeKnowledgeContext({
      database,
      embed,
      tenantId,
      assistantId,
      query: text,
    });
  } catch (knowledgeErr) {
    console.warn('INSTAGRAM_AI_KNOWLEDGE_WARN', knowledgeErr?.message);
  }

  // 6. Load Recent Conversation History
  const history = await loadRecentConversationHistory(database, tenantId, conversationId, 10);

  // 7. Build System Instruction with Channel Presentation Rules
  const systemInstruction = persona?.available
    ? buildTenantRuntimeSystemInstruction({
        persona,
        knowledgeContext: knowledge?.knowledgeContext || '',
        channelRules: INSTAGRAM_CHANNEL_PRESENTATION_RULES,
      })
    : [
        'PLATFORM RUNTIME SAFETY: Enforce tenant isolation and channel delivery rules.',
        INSTAGRAM_CHANNEL_PRESENTATION_RULES,
        knowledge?.knowledgeContext ? `APPROVED KNOWLEDGE:\n${knowledge.knowledgeContext}` : '',
      ].filter(Boolean).join('\n\n');

  // 8. Start Instagram Typing Indicator (non-blocking)
  const generationStartedAt = Date.now();
  if (accessToken && senderIgsid) {
    try {
      await sendInstagramTypingIndicator({
        recipientId: senderIgsid,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        http,
      });
    } catch (typingErr) {
      console.warn('INSTAGRAM_TYPING_INDICATOR_NON_BLOCKING_WARN', typingErr?.message);
    }
  }

  // 9. Generate AI response
  let rawAiResponseText = '';
  if (typeof generateAiResponse === 'function') {
    rawAiResponseText = await generateAiResponse({
      systemInstruction,
      text,
      conversationHistory: history,
      model: assistantModel,
    });
  } else {
    rawAiResponseText = await defaultGenerateInstagramAiResponse({
      systemInstruction,
      text,
      conversationHistory: history,
      model: assistantModel,
    });
  }

  const formattedResponse = formatInstagramDmResponse(rawAiResponseText);
  if (!formattedResponse) {
    return { aiInvoked: false, reason: 'EMPTY_AI_RESPONSE' };
  }

  // 10. Bounded Human-Like Adaptive Pacing
  await applyWhatsAppAdaptivePacing({
    generationStartedAt,
    content: formattedResponse,
  });

  // 11. Persist Assistant response atomically (guards against operator takeover race)
  const persisted = await persistAssistantResponseIfCurrent({
    tenantId,
    conversationId,
    content: formattedResponse,
    handlingVersion,
    database,
  });

  if (!persisted.delivered) {
    console.info('INSTAGRAM_AI_RESPONSE_DROPPED reason=HANDLING_MODE_CHANGED');
    return { delivered: false, dropped: true, reason: 'CONVERSATION_TAKEN_OVER' };
  }

  // 12. Deliver outbound message to Instagram
  let deliveryResult = null;
  if (accessToken && senderIgsid) {
    deliveryResult = await deliverInstagramText({
      recipientId: senderIgsid,
      content: formattedResponse,
      accessToken,
      instagramAccountId: accountId,
      pageId: accountId,
      http,
    });
  }

  return {
    delivered: true,
    responseText: formattedResponse,
    deliveryResult,
    assistantMessageId: persisted.message?.id || null,
  };
}

/**
 * Generates and immediately delivers an AI response to the latest unanswered customer message
 * in an Instagram conversation (used when an operator activates AI_ONLY).
 */
export async function generateAndDeliverInstagramAssistantResponse({
  database = pool,
  tenantId,
  conversationId,
  messageText = '',
  http,
  embed = null,
  generateAiResponse,
}) {
  const shouldRelease = typeof database?.connect === 'function';
  const client = shouldRelease ? await database.connect() : database;
  try {
    const convRes = await client.query(
      `SELECT c.id, c.tenant_id, c.channel_id, c.customer_external_id, c.handling_mode,
              c.handling_version, c.status, c.communication_language,
              tc.channel_type, tc.assistant_id,
              a.model AS assistant_model,
              ci.config AS integration_config
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
         LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [conversationId, tenantId]
    );
    if (convRes.rowCount < 1) return { skipped: true, reason: 'CONVERSATION_NOT_FOUND' };
    const conversation = convRes.rows[0];

    if (conversation.status !== 'open' || conversation.handling_mode === 'HUMAN') {
      return { skipped: true, reason: 'HUMAN_MODE_ACTIVE' };
    }

    // Atomically verify latest message is CUSTOMER and unanswered
    const msgRes = await client.query(
      `SELECT id, sender_type, content, created_at
         FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [tenantId, conversationId]
    );
    const latestMsg = msgRes.rows[0];
    if (!latestMsg || latestMsg.sender_type !== 'CUSTOMER') {
      return { skipped: true, reason: 'ALREADY_ANSWERED' };
    }

    const textToAnswer = String(messageText || latestMsg.content || '').trim();
    const assistantId = conversation.assistant_id;
    const assistantModel = conversation.assistant_model || null;
    const config = conversation.integration_config || {};
    const accessToken = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    const accountId = config.instagram_account_id || config.instagram_business_account_id || config.page_id || 'me';
    const recipientIgsid = String(conversation.customer_external_id || '').replace(/^instagram:\s*/i, '');

    // Resolve Persona & Knowledge
    let persona = null;
    let knowledge = null;
    try {
      persona = await resolveTenantRuntimePersona({ database: client, tenantId, assistantId });
    } catch {}
    try {
      knowledge = await resolveAssistantRuntimeKnowledgeContext({ database: client, embed, tenantId, assistantId, query: textToAnswer });
    } catch {}

    const history = await loadRecentConversationHistory(client, tenantId, conversationId, 10);

    const systemInstruction = persona?.available
      ? buildTenantRuntimeSystemInstruction({
          persona,
          knowledgeContext: knowledge?.knowledgeContext || '',
          channelRules: INSTAGRAM_CHANNEL_PRESENTATION_RULES,
        })
      : [
          'PLATFORM RUNTIME SAFETY: Enforce tenant isolation and channel delivery rules.',
          INSTAGRAM_CHANNEL_PRESENTATION_RULES,
          knowledge?.knowledgeContext ? `APPROVED KNOWLEDGE:\n${knowledge.knowledgeContext}` : '',
        ].filter(Boolean).join('\n\n');

    const generationStartedAt = Date.now();
    if (accessToken && recipientIgsid) {
      try {
        await sendInstagramTypingIndicator({
          recipientId: recipientIgsid,
          accessToken,
          instagramAccountId: accountId,
          pageId: accountId,
          http,
        });
      } catch (typingErr) {
        console.warn('INSTAGRAM_TYPING_INDICATOR_NON_BLOCKING_WARN', typingErr?.message);
      }
    }

    let rawAiResponseText = '';
    if (typeof generateAiResponse === 'function') {
      rawAiResponseText = await generateAiResponse({
        systemInstruction,
        text: textToAnswer,
        conversationHistory: history,
        model: assistantModel,
      });
    } else {
      rawAiResponseText = await defaultGenerateInstagramAiResponse({
        systemInstruction,
        text: textToAnswer,
        conversationHistory: history,
        model: assistantModel,
      });
    }

    const formattedResponse = formatInstagramDmResponse(rawAiResponseText);
    if (!formattedResponse) return { skipped: true, reason: 'EMPTY_AI_RESPONSE' };

    await applyWhatsAppAdaptivePacing({
      generationStartedAt,
      content: formattedResponse,
    });

    const persisted = await persistAssistantResponseIfCurrent({
      tenantId,
      conversationId,
      content: formattedResponse,
      handlingVersion: conversation.handling_version,
      database,
    });

    if (!persisted.delivered) {
      return { delivered: false, dropped: true, reason: 'CONVERSATION_TAKEN_OVER' };
    }

    let deliveryResult = null;
    if (accessToken && recipientIgsid) {
      deliveryResult = await deliverInstagramText({
        recipientId: recipientIgsid,
        content: formattedResponse,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        http,
      });
    }

    return {
      delivered: true,
      responseText: formattedResponse,
      deliveryResult,
      assistantMessageId: persisted.message?.id || null,
    };
  } finally {
    if (shouldRelease && typeof client?.release === 'function') {
      client.release();
    }
  }
}


