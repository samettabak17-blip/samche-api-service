import pool from '../config/db.js';
import { parseCustomerHumanSupportRequest } from './human-support-intent.js';
import { resolvePlatformHumanSupportPolicy } from './platform-lifecycle-message-service.js';
import { requestCustomerHumanSupport, triggerImmediateHumanSupportNotificationPipeline } from './human-support-service.js';
import { persistAssistantResponseIfCurrent } from './live-inbox-service.js';
import { deliverInstagramText } from './instagram-delivery-service.js';
import { resolveTenantRuntimePersona } from './tenant-runtime-persona-service.js';
import { resolveAssistantRuntimeKnowledgeContext } from './knowledge-runtime-context-service.js';
import { buildTenantRuntimeSystemInstruction } from './tenant-runtime-persona-service.js';
import { resolveCommunicationLanguage } from './conversation-communication-language.js';
import { evaluateChannelAiActivationPolicy } from './channel-ai-activation-policy-service.js';

export async function orchestrateInstagramInboundAiResponse({
  database = pool,
  inboundState,
  senderIgsid,
  text = '',
  http,
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

  // 3. Resolve Persona and Knowledge context
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
      tenantId,
      assistantId,
      query: text,
    });
  } catch (knowledgeErr) {
    console.warn('INSTAGRAM_AI_KNOWLEDGE_WARN', knowledgeErr?.message);
  }

  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona: persona || { available: false, name: 'Assistant' },
    knowledgeContext: knowledge?.knowledgeContext || '',
    channelRules: 'You are an AI assistant responding to an Instagram DM. Keep messages conversational, helpful, concise, and formatted clearly without markdown headers.',
  });

  // 4. Generate AI response
  let aiResponseText = '';
  if (typeof generateAiResponse === 'function') {
    aiResponseText = await generateAiResponse({
      systemInstruction,
      text,
      conversationHistory: [],
    });
  } else {
    aiResponseText = persona?.configuration?.systemPrompt
      ? 'Thank you for reaching out! How can I assist you today?'
      : 'Hello! Thank you for messaging us. How can we help you today?';
  }

  aiResponseText = String(aiResponseText ?? '').trim();
  if (!aiResponseText) {
    return { aiInvoked: false, reason: 'EMPTY_AI_RESPONSE' };
  }

  // 5. Persist Assistant response with handling version check (atomically guards against operator takeover race)
  const persisted = await persistAssistantResponseIfCurrent({
    tenantId,
    conversationId,
    content: aiResponseText,
    handlingVersion,
    database,
  });

  if (!persisted.delivered) {
    console.info('INSTAGRAM_AI_RESPONSE_DROPPED reason=HANDLING_MODE_CHANGED');
    return { delivered: false, dropped: true, reason: 'CONVERSATION_TAKEN_OVER' };
  }

  // 6. Deliver outbound message to Instagram
  let deliveryResult = null;
  if (accessToken) {
    deliveryResult = await deliverInstagramText({
      recipientId: senderIgsid,
      content: aiResponseText,
      accessToken,
      instagramAccountId: accountId,
      pageId: accountId,
      http,
    });
  }

  return {
    delivered: true,
    responseText: aiResponseText,
    deliveryResult,
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
  generateAiResponse,
}) {
  const client = await database.connect();
  try {
    const convRes = await client.query(
      `SELECT c.id, c.tenant_id, c.channel_id, c.customer_external_id, c.handling_mode,
              c.handling_version, c.status, c.communication_language,
              tc.channel_type, tc.assistant_id,
              ci.config AS integration_config
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
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
    const config = conversation.integration_config || {};
    const accessToken = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    const accountId = config.instagram_account_id || config.instagram_business_account_id || config.page_id || 'me';
    const recipientIgsid = String(conversation.customer_external_id || '').replace(/^instagram:\s*/i, '');

    // Resolve persona & knowledge
    let persona = null;
    let knowledge = null;
    try {
      persona = await resolveTenantRuntimePersona({ database, tenantId, assistantId });
    } catch {}
    try {
      knowledge = await resolveAssistantRuntimeKnowledgeContext({ database, tenantId, assistantId, query: textToAnswer });
    } catch {}

    const channelRules = [
      'INSTAGRAM CHANNEL PRESENTATION RULES:',
      '- Communicate naturally, concisely, and helpfully on behalf of the company in plain text without markdown headers or hashtags.',
      '- Do NOT start replies with unsolicited AI self-identification phrases (e.g. "Ben SamChe AI\'yım", "Ben bir yapay zeka asistanıyım", "I am an AI assistant"). Address the customer\'s business question directly.',
      '- If and only if the customer explicitly asks whether you are an AI/bot/human ("Sen yapay zeka mısın?", "Bot musun?", "Gerçek bir insan mısın?"), answer truthfully and briefly as the digital assistant without inventing a false human persona.',
    ].join('\n');

    const systemInstruction = buildTenantRuntimeSystemInstruction({
      persona: persona || { available: false, name: 'Assistant' },
      knowledgeContext: knowledge?.knowledgeContext || '',
      channelRules,
    });

    let aiResponseText = '';
    if (typeof generateAiResponse === 'function') {
      aiResponseText = await generateAiResponse({ systemInstruction, text: textToAnswer, conversationHistory: [] });
    } else {
      aiResponseText = persona?.configuration?.systemPrompt
        ? 'Thank you for reaching out! How can I assist you today?'
        : 'Hello! Thank you for messaging us. How can we help you today?';
    }

    aiResponseText = String(aiResponseText ?? '').trim();
    if (!aiResponseText) return { skipped: true, reason: 'EMPTY_AI_RESPONSE' };

    const persisted = await persistAssistantResponseIfCurrent({
      tenantId,
      conversationId,
      content: aiResponseText,
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
        content: aiResponseText,
        accessToken,
        instagramAccountId: accountId,
        pageId: accountId,
        http,
      });
    }

    return {
      delivered: true,
      responseText: aiResponseText,
      deliveryResult,
      assistantMessageId: persisted.message?.id || null,
    };
  } finally {
    client.release();
  }
}

