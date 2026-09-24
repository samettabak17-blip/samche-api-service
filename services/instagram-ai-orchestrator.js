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

export async function orchestrateInstagramInboundAiResponse({
  database = pool,
  inboundState,
  senderIgsid,
  text = '',
  http,
  generateAiResponse,
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
