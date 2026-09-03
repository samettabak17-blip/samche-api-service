let session = '';

const root = document.querySelector('#guide-root');
let guideInitialized = false;
let experience = null;
let guideState = null;
let messages = [];
let contextSyncState = 'idle';
let contextSyncTimer;
const previewToken = new URLSearchParams(window.location.search).get('preview') || '';
const resumeStorageKey = previewToken ? `samcheguide-preview-resume:${previewToken.slice(-16)}` : 'samcheguide-public-resume';
try { session = window.localStorage?.getItem(resumeStorageKey) || ''; } catch { session = ''; }

const MODULES = Object.freeze({ ROADMAP: 'ROADMAP', INTERACTIVE_TOOL: 'INTERACTIVE_TOOL', AI_ASSISTANT: 'AI_ASSISTANT' });
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const element = (tag, className, content) => { const node = document.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = String(content); return node; };
const clear = (node) => node.replaceChildren();
const safeNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

const showGuideError = () => {
  if (guideInitialized || !root) return;
  guideInitialized = true;
  root.replaceChildren(element('main', 'guide-safe-error', 'Guide experience is temporarily unavailable. Please refresh or try again shortly.'));
};
const initializationTimeout = window.setTimeout(showGuideError, 10000);

function stateStorageKey() { return `samcheguide-v1-state:${previewToken ? 'preview:' + previewToken.slice(-16) : 'public'}:${experience?.version ?? 'unknown'}`; }
function firstAvailableModule() { if (experience?.modules?.guide) return MODULES.ROADMAP; if (experience?.modules?.calculator) return MODULES.INTERACTIVE_TOOL; return MODULES.AI_ASSISTANT; }
function loadState() {
  const fallback = { active_module: firstAvailableModule(), roadmap: {}, tool: {}, roadmap_step: 0, roadmap_reviewed: false, roadmap_validation_error: '', assistant_draft: '', assistant_draft_origin: 'NONE' };
  try {
    const saved = JSON.parse(window.sessionStorage?.getItem(stateStorageKey()) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback;
    return { active_module: Object.values(MODULES).includes(saved.active_module) ? saved.active_module : fallback.active_module, roadmap: saved.roadmap && typeof saved.roadmap === 'object' && !Array.isArray(saved.roadmap) ? saved.roadmap : {}, tool: saved.tool && typeof saved.tool === 'object' && !Array.isArray(saved.tool) ? saved.tool : {}, roadmap_step: Number.isInteger(saved.roadmap_step) && saved.roadmap_step >= 0 ? saved.roadmap_step : 0, roadmap_reviewed: saved.roadmap_reviewed === true, roadmap_validation_error: typeof saved.roadmap_validation_error === 'string' ? saved.roadmap_validation_error.slice(0, 180) : '', assistant_draft: typeof saved.assistant_draft === 'string' ? saved.assistant_draft.slice(0, 2000) : '', assistant_draft_origin: saved.assistant_draft_origin === 'HANDOFF' || saved.assistant_draft_origin === 'USER' ? saved.assistant_draft_origin : 'NONE' };
  } catch { return fallback; }
}
function persistState() { try { window.sessionStorage?.setItem(stateStorageKey(), JSON.stringify(guideState)); } catch {} }
function guideContext() { return { active_module: guideState.active_module, roadmap: guideState.roadmap, tool: guideState.tool }; }
function saveSession(token) { if (!token) return; session = token; try { window.localStorage?.setItem(resumeStorageKey, session); } catch {} }
async function resumeGuideSession() { if (!session || !experience) return; try { const response = await fetch('/guide/session-context', { headers: { 'X-Samcheguide-Session': session, ...(previewToken ? { 'X-Samcheguide-Preview': previewToken } : {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok || !payload.guide_context) return; const saved = payload.guide_context; if (saved.roadmap && typeof saved.roadmap === 'object') guideState.roadmap = saved.roadmap; if (saved.tool && typeof saved.tool === 'object') guideState.tool = saved.tool; if (Object.values(MODULES).includes(saved.active_module)) guideState.active_module = saved.active_module; persistState(); renderActiveModule(); } catch {} }

function setAsset(image, value, alt) { if (!value) { image.hidden = true; return; } image.src = value; image.alt = alt; image.hidden = false; image.addEventListener('error', () => { image.hidden = true; }, { once: true }); }
function moduleLabel(type) { if (type === MODULES.ROADMAP) return text(experience.roadmap?.navigation_label, 'Roadmap'); if (type === MODULES.INTERACTIVE_TOOL) return text(experience.interactive_tool?.navigation_label, 'Planning'); return text(experience.assistant_copy?.navigation_label, 'Assistant'); }
function moduleIcon(type) { return type === MODULES.ROADMAP ? '◫' : type === MODULES.INTERACTIVE_TOOL ? '◈' : '✦'; }
function enabledModules() { return [experience.modules?.guide && MODULES.ROADMAP, experience.modules?.calculator && MODULES.INTERACTIVE_TOOL, experience.modules?.chat && MODULES.AI_ASSISTANT].filter(Boolean); }

function inputForField(field, values, onChange) {
  const wrapper = element('label', 'guide-field'); wrapper.append(element('span', 'guide-field__label', field.label)); if (field.description) wrapper.append(element('span', 'guide-field__hint', field.description));
  let control;
  if (field.input_type === 'SELECT') { control = document.createElement('select'); control.append(new Option(`Select ${field.label}`, '')); for (const option of field.options || []) control.append(new Option(option.label, option.value)); control.value = text(values[field.id]); }
  else if (field.input_type === 'BOOLEAN') { control = document.createElement('input'); control.type = 'checkbox'; control.checked = values[field.id] === true; wrapper.classList.add('guide-field--boolean'); }
  else { control = document.createElement('input'); control.type = field.input_type === 'NUMBER' ? 'number' : 'text'; if (field.input_type === 'NUMBER') { if (field.min !== null) control.min = String(field.min); if (field.max !== null) control.max = String(field.max); control.step = 'any'; } control.maxLength = field.input_type === 'TEXT' ? 240 : 40; control.value = values[field.id] ?? ''; control.placeholder = field.unit ? `${field.label} (${field.unit})` : field.label; }
  control.required = field.required === true;
  control.addEventListener('change', () => { const value = field.input_type === 'BOOLEAN' ? control.checked : field.input_type === 'NUMBER' ? (control.value === '' ? undefined : Number(control.value)) : control.value; if (value === undefined || value === '') delete values[field.id]; else values[field.id] = value; onChange(); });
  wrapper.append(control); return wrapper;
}
function roadmapValueValid(field, value) { if (!field.required && (value === undefined || value === null || value === '')) return true; if (field.input_type === 'NUMBER') return typeof value === 'number' && Number.isFinite(value) && (field.min === null || value >= field.min) && (field.max === null || value <= field.max); if (field.input_type === 'SELECT') return field.options.some((option) => option.value === value); if (field.input_type === 'BOOLEAN') return typeof value === 'boolean'; return typeof value === 'string' && value.trim().length > 0 && value.length <= 240; }
function displayFieldValue(field, value) { if (field.input_type === 'SELECT') return field.options.find((option) => option.value === value)?.label || value; if (field.input_type === 'BOOLEAN') return value ? 'Yes' : 'No'; return String(value); }
function visibleFields(fields, values) { return (fields || []).filter((field) => !field.visible_when || values[field.visible_when.field_id] === field.visible_when.equals); }
function validateRoadmapForReview(steps) { return steps.find((field) => !roadmapValueValid(field, guideState.roadmap[field.id])); }
function renderRoadmapReview(container, roadmap, steps) { const summary = element('section', 'guide-summary guide-summary--review'); summary.append(element('h3', '', roadmap.summary_label || 'Planning summary')); const rows = element('dl', 'guide-context-summary__list'); for (const item of steps) if (guideState.roadmap[item.id] !== undefined) { const row = element('div', 'guide-context-summary__row'); row.append(element('dt', '', item.label), element('dd', '', displayFieldValue(item, guideState.roadmap[item.id]))); rows.append(row); } summary.append(rows); const actions = element('div', 'guide-actions'); const edit = element('button', 'guide-button guide-button--secondary', 'Back to edit'); edit.type = 'button'; edit.addEventListener('click', () => { guideState.roadmap_reviewed = false; guideState.roadmap_step = Math.max(steps.length - 1, 0); persistState(); renderActiveModule(); }); const ask = element('button', 'guide-button', 'Discuss this plan with the assistant'); ask.type = 'button'; ask.addEventListener('click', handoffToAssistant); actions.append(edit, ask); summary.append(actions); container.append(summary); }

function suggestedRoadmapIntents(roadmap) {
  const configured = Array.isArray(roadmap.suggested_intents) ? roadmap.suggested_intents : [];
  if (configured.length) return configured.map((item) => typeof item === 'string' ? item : item?.label).filter(Boolean).slice(0, 5);
  return (roadmap.steps || []).filter((field) => field.input_type === 'SELECT').flatMap((field) => field.options || []).map((option) => option.label).slice(0, 5);
}
function addThinking(board) { const thinking = element('p', 'guide-thinking', document.documentElement.lang?.startsWith('tr') ? 'Düşünüyorum…' : 'Thinking…'); thinking.setAttribute('role', 'status'); board.append(thinking); thinking.scrollIntoView({ block: 'end' }); return thinking; }
const responseDelay = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 24;
async function progressiveText(node, value) { const words = text(value).split(/(\s+)/); for (let index = 0; index < words.length; index += 3) { node.textContent += words.slice(index, index + 3).join(''); if (responseDelay()) await new Promise((resolve) => window.setTimeout(resolve, responseDelay())); } }
async function playGuideResponseEvents(board, events) {
  for (const event of Array.isArray(events) ? events : []) {
    if (event.type === 'THINKING' || event.type === 'MESSAGE_START' || event.type === 'MESSAGE_COMPLETE') continue;
    if (event.type === 'SECTION') { const heading = element('h3', 'guide-response__section'); await progressiveText(heading, event.text || event.title); board.append(heading); continue; }
    if (event.type === 'LIST') { const list = element('ul', 'guide-response__list'); for (const item of event.items || []) list.append(element('li', '', item)); board.append(list); continue; }
    if (event.type === 'ACTION') { for (const label of event.actions || [event.label]) { const action = element('button', 'guide-response__action', label); action.type = 'button'; action.addEventListener('click', () => { guideState.active_module = /assistant/i.test(label) ? MODULES.AI_ASSISTANT : MODULES.INTERACTIVE_TOOL; persistState(); renderActiveModule(); }); board.append(action); } continue; }
    if (event.type === 'TEXT_DELTA') { const paragraph = element('p', 'guide-response__text'); board.append(paragraph); await progressiveText(paragraph, event.text); }
  }
}
async function submitGuideRequest({ value, module, board, input, submit }) {
  const thinking = addThinking(board); submit.disabled = true;
  try {
    const response = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Samcheguide-Session': session } : {}), ...(previewToken ? { 'X-Samcheguide-Preview': previewToken } : {}) }, body: JSON.stringify({ text: value, guide_module: module, guide_context: guideContext() }) });
    const payload = await response.json().catch(() => ({})); saveSession(payload.conversation_session); thinking.remove();
    if (!response.ok || !Array.isArray(payload.guide_events)) throw new Error('unavailable');
    await playGuideResponseEvents(board, payload.guide_events);
  } catch { thinking.remove(); board.append(element('p', 'guide-validation', 'The guide is temporarily unavailable. Please try again.')); }
  finally { submit.disabled = false; input?.focus(); }
}
function renderConversationalRoadmap(container) {
  const roadmap = experience.roadmap || { steps: [] }; container.append(element('p', 'guide-module__eyebrow', 'ROADMAP'), element('h2', 'guide-module__title', roadmap.title || 'Your roadmap')); if (roadmap.description) container.append(element('p', 'guide-module__description', roadmap.description));
  const board = element('section', 'guide-conversation-board'); board.setAttribute('aria-live', 'polite'); board.append(element('p', 'guide-empty-state', 'Tell us what you want to plan. We will shape a clear next-step roadmap with you.'));
  const intents = element('div', 'guide-intent-list'); for (const intent of suggestedRoadmapIntents(roadmap)) { const chip = element('button', 'guide-intent', intent); chip.type = 'button'; chip.addEventListener('click', () => { const input = container.querySelector('.guide-roadmap-composer'); input.value = intent; input.focus(); }); intents.append(chip); } container.append(board, intents);
  const form = element('form', 'guide-chat-form guide-roadmap-form'); const input = document.createElement('textarea'); input.className = 'guide-roadmap-composer'; input.rows = 3; input.maxLength = 2000; input.placeholder = 'Describe your goal or choose a suggestion'; input.setAttribute('aria-label', 'Describe your planning goal'); const submit = element('button', 'guide-button guide-chat-form__send', 'Analyze'); submit.type = 'submit'; form.append(input, submit); form.addEventListener('submit', async (event) => { event.preventDefault(); const value = input.value.trim(); if (!value) return; board.append(element('p', 'guide-message guide-message--user', value)); input.value = ''; await submitGuideRequest({ value, module: 'ROADMAP', board, input, submit }); }); container.append(form);
  const details = element('details', 'guide-structured-details'); details.append(element('summary', '', 'Add or review planning details')); const formFields = element('div', 'guide-step-card'); for (const field of visibleFields(roadmap.steps, guideState.roadmap)) formFields.append(inputForField(field, guideState.roadmap, () => { guideState.roadmap_validation_error = ''; persistState(); queueGuideContextSync(); })); const review = element('button', 'guide-button guide-button--secondary', 'Review roadmap'); review.type = 'button'; review.addEventListener('click', () => { const invalid = validateRoadmapForReview(visibleFields(roadmap.steps, guideState.roadmap)); if (invalid) { guideState.roadmap_validation_error = `Please complete ${invalid.label}.`; formFields.append(element('p', 'guide-validation', guideState.roadmap_validation_error)); return; } guideState.roadmap_reviewed = true; persistState(); queueGuideContextSync(); renderActiveModule(); }); formFields.append(review); details.append(formFields); container.append(details);
}
function renderRoadmap(container) { const roadmap = experience.roadmap || { steps: [] }; if (guideState.roadmap_reviewed) { container.append(element('p', 'guide-module__eyebrow', 'ROADMAP'), element('h2', 'guide-module__title', roadmap.title || 'Your roadmap')); renderRoadmapReview(container, roadmap, visibleFields(roadmap.steps, guideState.roadmap)); return; } renderConversationalRoadmap(container); }

function calculateTool() { const tool = experience.interactive_tool; let amount = safeNumber(tool.calculation?.base_amount); const rows = []; for (const term of tool.calculation?.terms || []) { const value = guideState.tool[term.field_id]; let valueAmount = 0; if (term.kind === 'NUMBER_MULTIPLIER' && typeof value === 'number') valueAmount = value * safeNumber(term.multiplier); else if (term.kind === 'BOOLEAN_AMOUNT' && value === true) valueAmount = safeNumber(term.amount); else if (term.kind === 'SELECT_AMOUNT' && typeof value === 'string') valueAmount = safeNumber(term.amounts?.[value]); amount += valueAmount; if (valueAmount || value !== undefined) rows.push({ label: term.label || term.field_id, amount: Number(valueAmount.toFixed(2)) }); } return { total: Number(amount.toFixed(2)), rows }; }
function renderInteractiveTool(container) { const tool = experience.interactive_tool || { fields: [], calculation: { terms: [] } }; const pricingAvailable = tool.pricing_mode === 'APPROVED_PRICING'; container.append(element('p', 'guide-module__eyebrow', 'INTERACTIVE TOOL'), element('h2', 'guide-module__title', tool.title || 'Interactive tool')); if (tool.description) container.append(element('p', 'guide-module__description', tool.description)); const form = element('form', 'guide-tool-form'); form.noValidate = true; for (const field of visibleFields(tool.fields, guideState.tool)) form.append(inputForField(field, guideState.tool, () => { persistState(); renderActiveModule(); })); const result = element('section', 'guide-tool-result'); result.append(element('p', 'guide-tool-result__label', tool.result_label || 'Planning snapshot')); if (pricingAvailable) { const calculated = calculateTool(); if (calculated.rows.length) { const table = document.createElement('table'); table.className = 'guide-tool-breakdown'; const head = document.createElement('thead'); const header = document.createElement('tr'); header.append(element('th', '', tool.result_breakdown_label || 'Category'), element('th', '', 'Estimate')); head.append(header); const body = document.createElement('tbody'); for (const row of calculated.rows) { const item = document.createElement('tr'); item.append(element('td', '', row.label), element('td', '', `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(row.amount)}${tool.currency ? ` ${tool.currency}` : ''}`)); body.append(item); } table.append(head, body); result.append(table); } result.append(element('strong', 'guide-tool-result__amount', `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(calculated.total)}${tool.currency ? ` ${tool.currency}` : ''}`), element('p', 'guide-tool-result__notice', 'Indicative estimate only. Final scope and pricing are confirmed after review.')); } else { const selected = visibleFields(tool.fields, guideState.tool).filter((field) => guideState.tool[field.id] !== undefined && guideState.tool[field.id] !== ''); if (selected.length) { const table = document.createElement('table'); table.className = 'guide-tool-breakdown'; const head = document.createElement('thead'); const header = document.createElement('tr'); header.append(element('th', '', tool.result_breakdown_label || 'Category'), element('th', '', 'Selected requirement')); head.append(header); const body = document.createElement('tbody'); for (const field of selected) { const item = document.createElement('tr'); item.append(element('td', '', field.label), element('td', '', displayFieldValue(field, guideState.tool[field.id]))); body.append(item); } table.append(head, body); result.append(table); } result.append(element('p', 'guide-tool-result__notice', 'Your planning scope is ready for commercial review. Final pricing and quotation require confirmation.')); } form.append(result); const assistant = element('button', 'guide-button', 'Ask the assistant about this'); assistant.type = 'button'; assistant.addEventListener('click', handoffToAssistant); form.append(assistant); container.append(form); }

function contextEntries(fields, values) { return visibleFields(fields, values).filter((field) => values[field.id] !== undefined && values[field.id] !== '').map((field) => ({ label: field.label, value: displayFieldValue(field, values[field.id]) })); }
function buildAssistantPrefill() {
  const groups = [{ label: experience.roadmap?.summary_label || 'Roadmap', entries: contextEntries(experience.roadmap?.steps || [], guideState.roadmap) }, { label: experience.interactive_tool?.result_label || 'Planning scope', entries: contextEntries(experience.interactive_tool?.fields || [], guideState.tool) }].filter((group) => group.entries.length);
  const lines = ['I would like recommendations based on my plan.'];
  for (const group of groups) { lines.push('', `${group.label}:`); for (const item of group.entries) lines.push(`${item.label}: ${item.value}`); }
  lines.push('', 'Please recommend the most suitable next steps based on this plan.');
  return lines.join('\n').slice(0, 2000);
}
function renderGuideContextSummary() {
  const roadmapEntries = contextEntries(experience.roadmap?.steps || [], guideState.roadmap);
  const toolEntries = contextEntries(experience.interactive_tool?.fields || [], guideState.tool);
  if (!roadmapEntries.length && !toolEntries.length) return null;
  const summary = element('section', 'guide-context-summary'); summary.setAttribute('aria-label', 'Current guide context');
  summary.append(element('p', 'guide-context-summary__eyebrow', 'YOUR CONTEXT'), element('h3', 'guide-context-summary__title', 'Your planning details'));
  for (const section of [{ label: experience.roadmap?.summary_label || 'Roadmap', entries: roadmapEntries }, { label: experience.interactive_tool?.result_label || 'Planning scope', entries: toolEntries }]) {
    if (!section.entries.length) continue;
    const block = element('section', 'guide-context-summary__section'); block.append(element('h4', '', section.label)); const list = element('dl', 'guide-context-summary__list');
    for (const item of section.entries) { const row = element('div', 'guide-context-summary__row'); row.append(element('dt', '', item.label), element('dd', '', item.value)); list.append(row); }
    block.append(list); summary.append(block);
  }
  if (experience.interactive_tool?.pricing_mode === 'QUOTE_REQUIRED') summary.append(element('p', 'guide-context-summary__notice', 'Planning scope saved. Final pricing requires commercial review.'));
  if (contextSyncState === 'saving') summary.append(element('p', 'guide-context-summary__sync', 'Saving this context for your assistant…'));
  if (contextSyncState === 'error') summary.append(element('p', 'guide-context-summary__sync guide-context-summary__sync--error', 'Your details are ready here. They will be sent when you message the assistant.'));
  return summary;
}
async function persistGuideContext() {
  const response = await fetch('/guide/session-context', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Samcheguide-Session': session } : {}), ...(previewToken ? { 'X-Samcheguide-Preview': previewToken } : {}) }, body: JSON.stringify({ guide_context: guideContext() }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.context_saved) throw new Error('context unavailable');
  saveSession(payload.conversation_session);
}
function queueGuideContextSync() { window.clearTimeout(contextSyncTimer); contextSyncTimer = window.setTimeout(async () => { contextSyncState = 'saving'; try { await persistGuideContext(); contextSyncState = 'saved'; } catch { contextSyncState = 'error'; } }, 350); }
async function handoffToAssistant() {
  if (!guideState.assistant_draft || guideState.assistant_draft_origin === 'HANDOFF') { guideState.assistant_draft = buildAssistantPrefill(); guideState.assistant_draft_origin = 'HANDOFF'; }
  guideState.active_module = MODULES.AI_ASSISTANT; persistState(); contextSyncState = 'saving'; renderActiveModule();
  try { await persistGuideContext(); contextSyncState = 'saved'; } catch { contextSyncState = 'error'; }
  if (guideState.active_module === MODULES.AI_ASSISTANT) { renderActiveModule(); window.requestAnimationFrame(() => root.querySelector('.guide-chat-form textarea')?.focus()); }
}
function addMessage(value, kind) { messages.push({ value: text(value), kind }); const board = root.querySelector('.guide-chat-messages'); if (!board) return; const item = element('p', `guide-message guide-message--${kind}`, value); board.append(item); item.scrollIntoView({ block: 'end' }); }
async function submitMessage(event) { event.preventDefault(); const input = event.currentTarget.querySelector('textarea'); const value = input.value.trim(); if (!value) return; guideState.assistant_draft = ''; guideState.assistant_draft_origin = 'NONE'; persistState(); input.value = ''; const board = root.querySelector('.guide-chat-messages'); board.append(element('p', 'guide-message guide-message--user', value)); await submitGuideRequest({ value, module: 'ASSISTANT', board, input, submit: event.currentTarget.querySelector('button[type="submit"]') }); }
function renderAssistant(container) { const hasContext = Object.keys(guideState.roadmap).length || Object.keys(guideState.tool).length; const intro = hasContext ? experience.assistant_copy?.contextual_intro : experience.assistant_copy?.intro; container.append(element('p', 'guide-module__eyebrow', 'AI ASSISTANT'), element('h2', 'guide-module__title', experience.assistant_display_name || 'AI Assistant'), element('p', 'guide-module__description', intro || experience.empty_state_copy || 'Ask a question or continue from your roadmap and tool selections.')); const summary = renderGuideContextSummary(); if (summary) container.append(summary); const chat = element('section', 'guide-chat'); const board = element('section', 'guide-chat-messages'); board.setAttribute('aria-live', 'polite'); if (!messages.length) { const empty = element('section', 'guide-empty-state'); empty.append(element('strong', '', hasContext ? 'Your details are ready to discuss.' : 'Start with a question, roadmap, or planning tool.'), element('p', '', hasContext ? 'Review the prepared message, edit it if needed, then send it when ready.' : (intro || experience.welcome_message || 'Tell us what you would like to plan.'))); board.append(empty); } for (const message of messages) board.append(element('p', `guide-message guide-message--${message.kind}`, message.value)); chat.append(board); const form = element('form', 'guide-chat-form'); const input = document.createElement('textarea'); input.rows = 5; input.maxLength = 2000; input.required = true; input.value = guideState.assistant_draft; input.placeholder = experience.input_placeholder || 'Type your message'; input.setAttribute('aria-label', 'Message'); input.addEventListener('input', () => { guideState.assistant_draft = input.value.slice(0, 2000); guideState.assistant_draft_origin = 'USER'; persistState(); }); const button = element('button', 'guide-button guide-chat-form__send', experience.launcher_label || 'Send'); button.type = 'submit'; form.append(input, button); form.addEventListener('submit', submitMessage); chat.append(form); container.append(chat); }

function renderConversationReminder(container) { if (!messages.some((message) => message.kind === 'assistant')) return; container.append(element('p', 'guide-conversation-reminder', 'Continue your conversation whenever you are ready.')); }
function renderActiveModule() { const outlet = root.querySelector('.guide-module'); if (!outlet) return; clear(outlet); if (guideState.active_module === MODULES.ROADMAP) renderRoadmap(outlet); else if (guideState.active_module === MODULES.INTERACTIVE_TOOL) renderInteractiveTool(outlet); else { renderAssistant(outlet); renderConversationReminder(outlet); } for (const button of root.querySelectorAll('[data-guide-module]')) { const active = button.dataset.guideModule === guideState.active_module; button.classList.toggle('is-active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); } }

export function applyExperience(value) {
  if (!root || !value || typeof value !== 'object') throw new Error('invalid guide experience');
  experience = value; guideState = loadState(); if (!enabledModules().includes(guideState.active_module)) guideState.active_module = firstAvailableModule();
  const theme = experience.theme || {}; const styles = document.documentElement.style; styles.setProperty('--guide-primary', theme.primary_color || '#1F4B99'); styles.setProperty('--guide-accent', theme.accent_color || '#4F7FD8'); styles.setProperty('--guide-background', theme.background_color || '#0E1522'); styles.setProperty('--guide-foreground', theme.foreground_color || '#F8FAFC'); styles.setProperty('--guide-surface', theme.surface_color || '#18212F'); styles.setProperty('--guide-border', theme.border_color || '#334155'); styles.setProperty('--guide-button-foreground', theme.button_foreground || '#FFFFFF'); styles.setProperty('--guide-radius', theme.corner_radius === 'LARGE' ? '1.4rem' : theme.corner_radius === 'SMALL' ? '.65rem' : '1rem'); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background_color || '#0E1522'); document.title = text(experience.brand_name, 'AI Guide');
  const shell = element('main', 'guide-shell'); const canvas = element('section', 'guide-canvas'); canvas.setAttribute('aria-label', text(experience.brand_name, 'AI Guide'));
  const header = element('header', 'guide-header'); const identity = element('div', 'guide-identity'); const logo = document.createElement('img'); logo.className = 'guide-logo'; logo.hidden = true; setAsset(logo, experience.logo_url, `${text(experience.brand_name)} logo`); identity.append(logo); const names = element('div', 'guide-names'); names.append(element('p', 'guide-brand-name', experience.brand_name || 'AI Guide'), element('p', 'guide-status', experience.assistant_status_label || 'Online')); identity.append(names); header.append(identity); const avatar = document.createElement('img'); avatar.className = 'guide-avatar'; avatar.hidden = true; setAsset(avatar, experience.avatar_url, `${text(experience.assistant_display_name)} avatar`); header.append(avatar); canvas.append(header);
  const hero = element('section', 'guide-hero'); hero.append(element('p', 'guide-hero__eyebrow', 'AI GUIDE'), element('h1', 'guide-hero__title', experience.hero?.title || experience.welcome_title || 'How can we help?'), element('p', 'guide-hero__message', experience.hero?.message || experience.welcome_message || 'Choose a path or ask a question to get started.')); canvas.append(hero); const outlet = element('section', 'guide-module'); canvas.append(outlet);
  const navigation = element('nav', 'guide-navigation'); navigation.setAttribute('aria-label', 'Guide experiences'); for (const module of enabledModules()) { const button = element('button', 'guide-navigation__item'); button.type = 'button'; button.dataset.guideModule = module; button.append(element('span', 'guide-navigation__icon', moduleIcon(module)), element('span', 'guide-navigation__label', moduleLabel(module))); button.addEventListener('click', () => { guideState.active_module = module; persistState(); renderActiveModule(); }); navigation.append(button); } canvas.append(navigation); shell.append(canvas); root.replaceChildren(shell); guideInitialized = true; window.clearTimeout(initializationTimeout); renderActiveModule(); resumeGuideSession();
}

fetch(`/guide/bootstrap${previewToken ? `?preview=${encodeURIComponent(previewToken)}` : ''}`, { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error('unavailable'); return response.json(); }).then((payload) => applyExperience(payload?.experience)).catch(showGuideError);
