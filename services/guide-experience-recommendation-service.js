import { neutralGuideExperience, normalizeGuideExperience } from './guide-experience-service.js';
import { resolveActiveAssistantKnowledgeConfiguration } from './knowledge-configuration-service.js';

const SECTORS = Object.freeze({
  EVENT_MANAGEMENT: ['event', 'conference', 'gala', 'exhibition', 'venue', 'catering', 'production'],
  REAL_ESTATE: ['property', 'real estate', 'mortgage', 'residence', 'off-plan', 'bedroom'],
  COMPANY_FORMATION: ['company formation', 'free zone', 'mainland', 'business setup', 'visa'],
  HEALTHCARE: ['clinic', 'patient', 'medical', 'healthcare', 'treatment'],
  AUTOMOTIVE: ['automotive', 'vehicle', 'car', 'fleet'],
  TOURISM: ['tourism', 'travel', 'hotel', 'trip', 'holiday'],
  ECOMMERCE: ['e-commerce', 'ecommerce', 'shopping', 'catalog', 'product'],
  PROFESSIONAL_SERVICES: ['consulting', 'professional services', 'advisory', 'legal', 'accounting'],
});

export class GuideRecommendationError extends Error {
  constructor(code) { super('Guide recommendation is unavailable.'); this.code = code; }
}

function textOf(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => textOf(item, depth + 1)).join(' ');
  if (typeof value === 'object') return Object.values(value).map((item) => textOf(item, depth + 1)).join(' ');
  return '';
}

export function classifyGuideSector({ profile = {}, configuration = {} } = {}) {
  const corpus = `${textOf(profile)} ${textOf(configuration)}`.toLowerCase();
  const ranked = Object.entries(SECTORS).map(([sector, signals]) => ({ sector, score: signals.reduce((sum, signal) => sum + (corpus.includes(signal) ? 1 : 0), 0) }));
  ranked.sort((a, b) => b.score - a.score || a.sector.localeCompare(b.sector));
  return ranked[0]?.score > 0 ? ranked[0].sector : 'GENERAL_SERVICE';
}

const field = (id, label, input_type, options = [], extras = {}) => ({ id, label, description: '', input_type, required: true, options, min: null, max: null, unit: '', ...extras });
const options = (...labels) => labels.map((label, index) => ({ value: `option_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'value'}_${index + 1}`, label }));

function layoutPresetForSector(sector) {
  const presets = {
    EVENT_MANAGEMENT: 'SERVICE',
    PROFESSIONAL_SERVICES: 'PROFESSIONAL',
    REAL_ESTATE: 'PREMIUM',
    COMPANY_FORMATION: 'SERVICE',
    HEALTHCARE: 'SERVICE',
    AUTOMOTIVE: 'SERVICE',
    TOURISM: 'PREMIUM',
    ECOMMERCE: 'COMMERCE',
    GENERAL_SERVICE: 'PROFESSIONAL',
  };
  return presets[sector] ?? 'PROFESSIONAL';
}

function eventGuide() {
  const services = options('Venue sourcing', 'Stage / AV / production', 'Decoration', 'Catering', 'Photography / video', 'Hostesses / staffing', 'Entertainment', 'Full event management');
  return {
    classification: { sector: 'EVENT_MANAGEMENT', capabilities: ['event-planning', 'event-budget-estimator', 'event-advisor'], source: 'APPROVED_TENANT_INTELLIGENCE' },
    hero: { title: 'Plan your event with confidence', message: 'Share your event requirements and receive an indicative planning brief.', cta_label: 'Start planning' },
    roadmap: { enabled: true, title: 'Event Planning Roadmap', description: 'Tell us the essentials so we can prepare meaningful next steps.', summary_label: 'Your Event Roadmap', steps: [
      field('event_type', 'What type of event are you planning?', 'SELECT', options('Corporate Event', 'Product Launch', 'Conference', 'Gala Dinner', 'Private Event', 'Exhibition', 'Other')),
      field('event_date', 'When is the event?', 'TEXT'),
      field('guest_count', 'How many guests are you expecting?', 'NUMBER', [], { min: 1, max: 100000, unit: 'guests' }),
      field('location', 'Where would you like to hold the event?', 'SELECT', options('Dubai', 'Abu Dhabi', 'Other UAE', 'Venue not selected yet')),
      field('services', 'Which services do you need?', 'SELECT', services),
      field('budget_range', 'What is your indicative budget range?', 'SELECT', options('Under 25,000', '25,000–50,000', '50,000–100,000', '100,000–250,000', '250,000+')),
      field('special_requirements', 'Any special requirements?', 'TEXT', [], { required: false }),
    ] },
    interactive_tool: { enabled: true, title: 'Event Budget Estimator', description: 'Capture your event scope for a commercial review. Final pricing and quotation require review.', currency: 'AED', pricing_mode: 'QUOTE_REQUIRED', approved_pricing_source: '', result_label: 'Event Planning Scope', result_breakdown_label: 'Category', fields: [
      field('guest_count', 'Guest count', 'NUMBER', [], { min: 1, max: 100000, unit: 'guests' }),
      field('venue', 'Venue requirement', 'SELECT', options('Not selected', 'Hotel ballroom', 'Dedicated venue', 'Outdoor venue')),
      field('catering', 'Catering required', 'BOOLEAN'),
      field('production', 'Stage / AV / production', 'SELECT', options('None', 'Essential', 'Enhanced', 'Premium')),
      field('decoration', 'Decoration level', 'SELECT', options('None', 'Essential', 'Enhanced', 'Premium')),
      field('entertainment', 'Entertainment', 'BOOLEAN'),
      field('media', 'Photography / video', 'BOOLEAN'),
      field('staffing', 'Staffing / hostesses', 'BOOLEAN'),
      field('duration_days', 'Event duration', 'NUMBER', [], { min: 1, max: 30, unit: 'days' }),
    ], calculation: { base_amount: 0, terms: [
      { field_id: 'guest_count', kind: 'NUMBER_MULTIPLIER', multiplier: 0, label: 'Guest-driven planning' },
      { field_id: 'venue', kind: 'SELECT_AMOUNT', amounts: { option_not_selected_1: 0, option_hotel_ballroom_2: 0, option_dedicated_venue_3: 0, option_outdoor_venue_4: 0 }, label: 'Venue' },
      { field_id: 'catering', kind: 'BOOLEAN_AMOUNT', amount: 0, label: 'Catering' },
      { field_id: 'production', kind: 'SELECT_AMOUNT', amounts: { option_none_1: 0, option_essential_2: 0, option_enhanced_3: 0, option_premium_4: 0 }, label: 'Production / AV' },
      { field_id: 'decoration', kind: 'SELECT_AMOUNT', amounts: { option_none_1: 0, option_essential_2: 0, option_enhanced_3: 0, option_premium_4: 0 }, label: 'Decoration' },
      { field_id: 'entertainment', kind: 'BOOLEAN_AMOUNT', amount: 0, label: 'Entertainment' },
      { field_id: 'media', kind: 'BOOLEAN_AMOUNT', amount: 0, label: 'Media' },
      { field_id: 'staffing', kind: 'BOOLEAN_AMOUNT', amount: 0, label: 'Staffing' },
      { field_id: 'duration_days', kind: 'NUMBER_MULTIPLIER', multiplier: 0, label: 'Duration' },
    ] } },
    assistant_copy: { intro: 'Tell us about your event, or continue from your Roadmap and Event Budget Estimator.', contextual_intro: 'Your event planning details are available. I can help refine venue, services and next steps.' },
  };
}

function genericGuide(sector) {
  const labels = sector === 'REAL_ESTATE' ? ['Property Journey', 'Property Planning Tool', 'Property AI Advisor']
    : sector === 'COMPANY_FORMATION' ? ['Business Setup Roadmap', 'Setup Planning Tool', 'Business Setup Assistant']
      : ['Service Roadmap', 'Planning Tool', 'AI Assistant'];
  return {
    classification: { sector, capabilities: ['guided-discovery', 'planning-estimator', 'sector-advisor'], source: 'APPROVED_TENANT_INTELLIGENCE' },
    hero: { title: labels[0], message: 'Share a few details to receive a useful planning brief.', cta_label: 'Get started' },
    roadmap: { enabled: true, title: labels[0], description: 'Answer a few questions to shape your next steps.', summary_label: 'Your planning summary', steps: [field('objective', 'What would you like to achieve?', 'TEXT'), field('budget', 'What is your indicative budget?', 'NUMBER', [], { required: false, min: 0, max: 100000000 }), field('timeline', 'When would you like to proceed?', 'TEXT', [], { required: false })] },
    interactive_tool: { enabled: true, title: labels[1], description: 'Capture planning inputs to prepare the next step. Commercial pricing is confirmed after review.', currency: '', pricing_mode: 'QUOTE_REQUIRED', approved_pricing_source: '', result_label: 'Planning scope', result_breakdown_label: 'Planning factor', fields: [field('budget', 'Indicative budget', 'NUMBER', [], { required: false, min: 0, max: 100000000 })], calculation: { base_amount: 0, terms: [{ field_id: 'budget', kind: 'NUMBER_MULTIPLIER', multiplier: 1, label: 'Indicative budget' }] } },
    assistant_copy: { intro: `Tell us what you need, or continue from your ${labels[0]}.`, contextual_intro: 'Your planning details are available. I can help refine the next steps.' },
  };
}

export function buildGuideExperienceRecommendation({ activeProfile, activeConfiguration, assistantName, currentExperience = null }) {
  const sector = classifyGuideSector({ profile: activeProfile, configuration: activeConfiguration });
  const recommended = sector === 'EVENT_MANAGEMENT' ? eventGuide() : genericGuide(sector);
  const current = currentExperience ? normalizeGuideExperience(currentExperience, { allowSerializedLegacyPricing: true }) : neutralGuideExperience();
  const profileName = typeof activeProfile?.company_identity === 'string' ? activeProfile.company_identity : null;
  // A recommendation may retain the current brand logo as an explicit draft
  // asset, but it never clones an old Experience avatar into a new draft.
  // Avatar selection is an explicit current-version decision.
  const experience = normalizeGuideExperience({ ...current, logo_url: current.logo_url, avatar_url: null, brand_name: profileName || current.brand_name, assistant_display_name: activeConfiguration?.assistant_identity || assistantName || current.assistant_display_name, welcome_title: recommended.hero.title, welcome_message: recommended.hero.message, hero: recommended.hero, layout: { ...current.layout, preset: layoutPresetForSector(sector) }, roadmap: recommended.roadmap, interactive_tool: recommended.interactive_tool, assistant_copy: recommended.assistant_copy, classification: recommended.classification });
  return { experience, recommendation: { classification: recommended.classification, facts_used: { active_profile: Boolean(activeProfile), active_configuration: Boolean(activeConfiguration) } } };
}

export async function generateGuideExperienceRecommendation({ database, tenantId, assistantId, currentExperience = null }) {
  const active = await resolveActiveAssistantKnowledgeConfiguration({ database, tenantId, assistantId });
  if (!active?.active_business_profile || !active?.configuration_data) throw new GuideRecommendationError('GUIDE_RECOMMENDATION_CONTEXT_UNAVAILABLE');
  return buildGuideExperienceRecommendation({ activeProfile: active.active_business_profile, activeConfiguration: active.configuration_data, assistantName: active.assistant_metadata_name, currentExperience });
}
