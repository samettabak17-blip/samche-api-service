import {
  buildUntrustedKnowledgeContext,
  retrieveApprovedKnowledge,
} from './knowledge-intelligence-service.js';
import { resolveActiveAssistantKnowledgeConfiguration } from './knowledge-configuration-service.js';

const CONFIGURATION_FIELDS = Object.freeze([
  'company_context',
  'assistant_instructions',
  'tone',
  'greeting',
  'faq_guidance',
  'qualification_guidance',
  'fallback_guidance',
  'escalation_guidance',
  'sales_guidance',
  'prohibited_claims',
  'terminology',
  'operating_rules',
]);

const PROFILE_FIELDS = Object.freeze([
  'company_summary',
  'industry',
  'business_type',
  'products',
  'services',
  'faq_themes',
  'pricing_information',
  'policies',
  'procedures',
  'operating_information',
  'sales_information',
  'support_escalation_rules',
  'tone',
  'terminology',
]);

function compactValue(value) {
  if (typeof value === 'string') return value.trim().slice(0, 4000);
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20)
      .join('; ')
      .slice(0, 4000);
  }
  return '';
}

function renderFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return fields
    .map((field) => [field, compactValue(value[field])])
    .filter(([, item]) => Boolean(item))
    .map(([field, item]) => field.replace(/_/g, ' ') + ': ' + item);
}

export function buildActiveAssistantConfigurationContext(configuration) {
  if (!configuration?.id) return '';
  const configFields = renderFields(configuration.configuration_data, CONFIGURATION_FIELDS);
  const profileFields = renderFields(configuration.active_business_profile, PROFILE_FIELDS);
  const content = [...configFields, ...profileFields];
  if (!content.length) return '';
  return [
    'ACTIVE APPROVED TENANT ASSISTANT CONFIGURATION:',
    'This is approved tenant configuration. It is lower priority than platform safety, authentication, tenant isolation, human-handoff state, and channel delivery rules.',
    ...content,
  ].join('\n');
}

export function applyRuntimeKnowledgeContext(tenantContext, runtimeContext) {
  const additions = [
    runtimeContext?.activeConfigurationContext,
    runtimeContext?.knowledgeContext,
  ].filter((item) => typeof item === 'string' && item.trim());
  if (!additions.length) return tenantContext;
  return {
    ...tenantContext,
    knowledge: [...(Array.isArray(tenantContext?.knowledge) ? tenantContext.knowledge : []), ...additions],
  };
}

export function appendRuntimeKnowledgeToSystemInstruction(systemInstruction, runtimeContext) {
  return [
    String(systemInstruction ?? '').trim(),
    runtimeContext?.activeConfigurationContext,
    runtimeContext?.knowledgeContext,
  ].filter((item) => typeof item === 'string' && item.trim()).join('\n\n');
}

export async function resolveAssistantRuntimeKnowledgeContext({
  database,
  embed,
  tenantId,
  assistantId,
  query,
  resolveConfiguration = resolveActiveAssistantKnowledgeConfiguration,
  retrieve = retrieveApprovedKnowledge,
}) {
  const activeConfiguration = await resolveConfiguration({ database, tenantId, assistantId });
  if (!activeConfiguration?.id) {
    return { activeConfiguration: null, activeConfigurationContext: '', knowledge: [], knowledgeContext: '' };
  }

  const activeConfigurationContext = buildActiveAssistantConfigurationContext(activeConfiguration);
  try {
    const knowledge = await retrieve({ database, embed, tenantId, assistantId, query });
    return {
      activeConfiguration,
      activeConfigurationContext,
      knowledge,
      knowledgeContext: buildUntrustedKnowledgeContext(knowledge),
      retrievalAvailable: true,
    };
  } catch {
    return {
      activeConfiguration,
      activeConfigurationContext,
      knowledge: [],
      knowledgeContext: '',
      retrievalAvailable: false,
    };
  }
}

