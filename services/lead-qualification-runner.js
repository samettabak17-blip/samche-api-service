import pool from '../config/db.js';
import OpenAI from 'openai';
import { qualifyConversation, persistLeadQualification } from './lead-qualification-service.js';
import { createGoogleGeminiProvider } from './google-gemini-provider.js';
import { getLeadQualificationProviderPolicy } from './lead-qualification-provider-policy.js';
import { getDashboardAiProviderPolicy } from './dashboard-ai-provider-policy.js';
import { executeAiProviderFailover, defaultAiCircuitBreakerRegistry, AllAiProvidersFailedError } from './shared-ai-provider-resilience.js';

const inFlight = new Set();
let googleProvider = null;

const qualificationPolicy = getLeadQualificationProviderPolicy();

async function invokeGeminiQualification(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), qualificationPolicy.timeoutMs);
  try {
    googleProvider ??= createGoogleGeminiProvider();
    const body = await googleProvider.generateContent({
      model: qualificationPolicy.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: qualificationPolicy.maxOutputTokens,
        thinkingConfig: { thinkingLevel: qualificationPolicy.thinkingLevel },
      },
      signal: controller.signal,
    });
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LEAD_QUALIFICATION_PROVIDER_EMPTY');
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseQualificationProviderOutput(text) {
  if (typeof text !== 'string' || !text.trim()) {
    const error = new Error('Lead qualification provider returned no usable response');
    error.code = 'LEAD_QUALIFICATION_PROVIDER_RESPONSE_INVALID';
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    const error = new Error('Lead qualification provider returned invalid JSON', { cause });
    error.code = 'LEAD_QUALIFICATION_PROVIDER_RESPONSE_INVALID';
    throw error;
  }
}

export async function invokeLeadQualificationModel(prompt, {
  env = process.env,
  googleProviderFactory = null,
  openaiClient = null,
  openaiClientFactory = null,
  circuitRegistry = defaultAiCircuitBreakerRegistry,
  telemetry = null,
} = {}) {
  const policy = getDashboardAiProviderPolicy('CRM_LEAD_QUALIFICATION', env);
  if (!policy.failoverEnabled) {
    const output = await invokeGeminiQualification(prompt);
    return { output, provider: 'GEMINI', model: qualificationPolicy.model, fallbackUsed: false };
  }

  let google = null;
  let openai = openaiClient;
  try {
    const result = await executeAiProviderFailover({
      operation: policy.operation,
      capability: policy.capability,
      correlationId: null,
      primaryProvider: policy.primaryProvider,
      primaryModel: policy.primaryModel,
      secondaryProvider: policy.secondaryProvider,
      secondaryModel: policy.secondaryModel,
      primaryTimeoutMs: policy.primaryTimeoutMs,
      secondaryTimeoutMs: policy.secondaryTimeoutMs,
      totalTimeoutMs: policy.totalTimeoutMs,
      circuitRegistry,
      telemetry,
      primary: async ({ signal }) => {
        google ??= typeof googleProviderFactory === 'function' ? googleProviderFactory() : createGoogleGeminiProvider({ env });
        const body = await google.generateContent({
          model: policy.primaryModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            maxOutputTokens: qualificationPolicy.maxOutputTokens,
            thinkingConfig: { thinkingLevel: qualificationPolicy.thinkingLevel },
          },
          signal,
        });
        return body?.structured_text ?? body?.candidates?.[0]?.content?.parts?.[0]?.text;
      },
      secondary: async ({ signal }) => {
        if (!env.OPENAI_API_KEY) {
          const error = new Error('OpenAI lead qualification is unavailable');
          error.code = 'LEAD_QUALIFICATION_PROVIDER_UNAVAILABLE';
          throw error;
        }
        openai ??= typeof openaiClientFactory === 'function'
          ? openaiClientFactory({ apiKey: env.OPENAI_API_KEY })
          : new OpenAI({ apiKey: env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          model: policy.secondaryModel,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }, { signal });
        return completion?.choices?.[0]?.message?.content;
      },
    });
    return {
      output: parseQualificationProviderOutput(result.output),
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
    };
  } catch (error) {
    if (error instanceof AllAiProvidersFailedError) {
      const unavailable = new Error('Lead qualification providers are temporarily unavailable', { cause: error });
      unavailable.code = 'LEAD_QUALIFICATION_PROVIDERS_UNAVAILABLE';
      throw unavailable;
    }
    throw error;
  }
}

export async function runLeadQualification({ database = pool, tenantId, conversationId, force = false, invokeModel = invokeLeadQualificationModel }) {
  const executionKey = `${tenantId}:${conversationId}:${force ? 'force' : 'automatic'}`;
  if (inFlight.has(executionKey)) return null;
  inFlight.add(executionKey);
  let client = null;
  let advisoryLock = false;
  try {
    client = await database.connect();
    const leadResult = await client.query(
      `SELECT l.id, c.email, c.phone
         FROM crm_leads l
         JOIN crm_contacts c ON c.id = l.contact_id AND c.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.conversation_id = $2
        LIMIT 1`,
      [tenantId, conversationId]
    );
    const lead = leadResult.rows[0];
    if (!lead) return null;

    const messagesResult = await client.query(
      `SELECT id, sender_type, content, created_at
         FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at ASC, id ASC`,
      [tenantId, conversationId]
    );
    const existingResult = await client.query(
      `SELECT analysis_hash, analyzed_customer_message_count
         FROM crm_lead_analyses
        WHERE tenant_id = $1 AND lead_id = $2
        ORDER BY analyzed_at DESC
        LIMIT 1`,
      [tenantId, lead.id]
    );
    const lockResult = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
      [`crm-qualification:${tenantId}:${conversationId}`]
    );
    advisoryLock = lockResult.rows[0]?.acquired === true;
    if (!advisoryLock) return null;

    const qualification = await qualifyConversation({
      messages: messagesResult.rows,
      contact: lead,
      existingAnalysis: existingResult.rows[0] ?? null,
      force,
      invokeModel,
      provider: 'GEMINI',
      model: qualificationPolicy.model,
    });
    if (!qualification) return null;

    await client.query('BEGIN');
    await persistLeadQualification(client, { tenantId, leadId: lead.id, conversationId, qualification });
    await client.query('COMMIT');
    return qualification;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (advisoryLock) await client?.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`crm-qualification:${tenantId}:${conversationId}`]).catch(() => {});
    client?.release();
    inFlight.delete(executionKey);
  }
}

export function queueLeadQualification({ tenantId, conversationId, force = false }) {
  queueMicrotask(() => {
    void runLeadQualification({ tenantId, conversationId, force }).catch((error) => {
      const safeCode = typeof error?.code === 'string' ? error.code : 'LEAD_QUALIFICATION_FAILED';
      const safeStatus = Number.isInteger(error?.safeMetadata?.http_status) ? error.safeMetadata.http_status : 'none';
      console.error(`LEAD_QUALIFICATION_DEFERRED_FAILURE code=${safeCode} http_status=${safeStatus} model=${qualificationPolicy.model} timeout_ms=${qualificationPolicy.timeoutMs} max_attempts=${qualificationPolicy.maxAttempts}`);
    });
  });
}

