import pool from '../config/db.js';
import { qualifyConversation, persistLeadQualification } from './lead-qualification-service.js';
import { createGoogleGeminiProvider } from './google-gemini-provider.js';
import { getLeadQualificationProviderPolicy } from './lead-qualification-provider-policy.js';

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

export async function runLeadQualification({ tenantId, conversationId, force = false, invokeModel = invokeGeminiQualification }) {
  const executionKey = `${tenantId}:${conversationId}:${force ? 'force' : 'automatic'}`;
  if (inFlight.has(executionKey)) return null;
  inFlight.add(executionKey);
  const client = await pool.connect();
  let advisoryLock = false;
  try {
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
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (advisoryLock) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`crm-qualification:${tenantId}:${conversationId}`]).catch(() => {});
    client.release();
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

