let session = '';

const root = document.querySelector('#guide-root');
let guideInitialized = false;
let preservedRoadmapBoard = null;
let preservedAssistantChat = null;
let experience = null;
let guideState = null;
let messages = [];
let contextSyncState = 'idle';
let contextSyncTimer;
const previewToken = new URLSearchParams(window.location.search).get('preview') || '';
const resumeStorageKey = previewToken ? `samcheguide-preview-resume:${previewToken.slice(-16)}` : 'samcheguide-public-resume';
try { session = window.localStorage?.getItem(resumeStorageKey) || ''; } catch { session = ''; }

const MODULES = Object.freeze({ ROADMAP: 'ROADMAP', INTERACTIVE_TOOL: 'INTERACTIVE_TOOL', AI_ASSISTANT: 'AI_ASSISTANT' });
const PRESENTATION_TIMING = Object.freeze({ chunk_words: 5, base_delay_ms: 92, sentence_pause_ms: 260, section_pause_ms: 360, thinking_minimum_ms: 420 });
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
  const fallback = { active_module: firstAvailableModule(), roadmap: {}, tool: {}, roadmap_step: 0, roadmap_reviewed: false, roadmap_validation_error: '', assistant_draft: '', assistant_draft_origin: 'NONE', roadmap_category: '', roadmap_goal: '', roadmap_result: null, roadmap_messages: [], shared_context: {} };
  try {
    const saved = JSON.parse(window.sessionStorage?.getItem(stateStorageKey()) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback;
    return {
      active_module: Object.values(MODULES).includes(saved.active_module) ? saved.active_module : fallback.active_module,
      roadmap: saved.roadmap && typeof saved.roadmap === 'object' && !Array.isArray(saved.roadmap) ? saved.roadmap : {},
      tool: saved.tool && typeof saved.tool === 'object' && !Array.isArray(saved.tool) ? saved.tool : {},
      roadmap_step: Number.isInteger(saved.roadmap_step) && saved.roadmap_step >= 0 ? saved.roadmap_step : 0,
      roadmap_reviewed: saved.roadmap_reviewed === true,
      roadmap_validation_error: typeof saved.roadmap_validation_error === 'string' ? saved.roadmap_validation_error.slice(0, 180) : '',
      assistant_draft: typeof saved.assistant_draft === 'string' ? saved.assistant_draft.slice(0, 2000) : '',
      assistant_draft_origin: saved.assistant_draft_origin === 'HANDOFF' || saved.assistant_draft_origin === 'USER' ? saved.assistant_draft_origin : 'NONE',
      roadmap_category: typeof saved.roadmap_category === 'string' ? saved.roadmap_category : '',
      roadmap_goal: typeof saved.roadmap_goal === 'string' ? saved.roadmap_goal : '',
      roadmap_result: saved.roadmap_result || null,
      roadmap_messages: Array.isArray(saved.roadmap_messages) ? saved.roadmap_messages : [],
      shared_context: saved.shared_context && typeof saved.shared_context === 'object' ? saved.shared_context : {},
    };
  } catch { return fallback; }
}
function persistState() { try { window.sessionStorage?.setItem(stateStorageKey(), JSON.stringify(guideState)); } catch {} }
function guideContext() { return { active_module: guideState.active_module, roadmap: guideState.roadmap, tool: guideState.tool }; }
function guideSessionPayloadState() {
  return {
    active_module: guideState.active_module,
    sharedContext: guideState.shared_context || {},
    roadmapState: {
      category: guideState.roadmap_category || '',
      initialGoal: guideState.roadmap_goal || '',
      generatedAnalysis: guideState.roadmap_result || null,
      structuredInputs: guideState.roadmap || {},
    },
    planningState: guideState.tool || {},
  };
}
function saveSession(token) { if (!token) return; session = token; try { window.localStorage?.setItem(resumeStorageKey, session); } catch {} }
async function resumeGuideSession() {
  if (!session || !experience) return;
  const headers = { 'X-Samcheguide-Session': session, ...(previewToken ? { 'X-Samcheguide-Preview': previewToken } : {}) };
  try {
    const response = await fetch('/guide/session-context', { headers });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      if (payload.guide_session_state && typeof payload.guide_session_state === 'object') {
        const fullState = payload.guide_session_state;
        if (fullState.roadmapState && typeof fullState.roadmapState === 'object') {
          const rm = fullState.roadmapState;
          if (typeof rm.category === 'string' && rm.category) guideState.roadmap_category = rm.category;
          if (typeof rm.initialGoal === 'string' && rm.initialGoal) guideState.roadmap_goal = rm.initialGoal;
          if (rm.generatedAnalysis) guideState.roadmap_result = rm.generatedAnalysis;
          if (rm.structuredInputs && typeof rm.structuredInputs === 'object') guideState.roadmap = { ...guideState.roadmap, ...rm.structuredInputs };
          if (Array.isArray(rm.messages)) {
            guideState.roadmap_messages = rm.messages.map((m) => ({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: text(m.content || m.text || ''),
            }));
          }
        }
        if (fullState.sharedContext && typeof fullState.sharedContext === 'object') {
          guideState.shared_context = { ...guideState.shared_context, ...fullState.sharedContext };
        }
        if (fullState.planningState && typeof fullState.planningState === 'object') {
          guideState.tool = { ...guideState.tool, ...fullState.planningState };
        }
        if (Object.values(MODULES).includes(fullState.active_module)) {
          guideState.active_module = fullState.active_module;
        }
      }
      if (payload.guide_context) {
        const saved = payload.guide_context;
        if (saved.roadmap && typeof saved.roadmap === 'object') guideState.roadmap = { ...guideState.roadmap, ...saved.roadmap };
        if (saved.tool && typeof saved.tool === 'object') guideState.tool = { ...guideState.tool, ...saved.tool };
        if (Object.values(MODULES).includes(saved.active_module)) guideState.active_module = saved.active_module;
      }
    }
    const history = await fetch('/chat/history', { headers }).then((result) => result.ok ? result.json() : null).catch(() => null);
    if (Array.isArray(history?.messages)) {
      messages = history.messages
        .filter((message) => typeof message?.content === 'string')
        .map((message) => ({ value: message.content, kind: message.sender_type === 'CUSTOMER' ? 'user' : 'assistant' }));
    }
    preservedAssistantChat = null;
    preservedRoadmapBoard = null;
    persistState();
    renderActiveModule();
  } catch {}
}

function setAsset(image, value, alt) { if (!value) return; image.src = value; image.alt = alt; image.hidden = false; image.addEventListener('error', () => { image.remove(); }, { once: true }); }
function moduleLabel(type) { if (type === MODULES.ROADMAP) return text(experience.roadmap?.navigation_label, 'Roadmap'); if (type === MODULES.INTERACTIVE_TOOL) return text(experience.interactive_tool?.navigation_label, 'Planning'); return text(experience.assistant_copy?.navigation_label, 'Assistant'); }
function moduleIcon(type) { return type === MODULES.ROADMAP ? '◫' : type === MODULES.INTERACTIVE_TOOL ? '◈' : '✦'; }
function enabledModules() { return [experience.modules?.guide && MODULES.ROADMAP, experience.modules?.calculator && MODULES.INTERACTIVE_TOOL, experience.modules?.chat && MODULES.AI_ASSISTANT].filter(Boolean); }

function inputForField(field, values, onChange) {
  const wrapper = element('label', 'guide-field'); wrapper.append(element('span', 'guide-field__label', field.label)); if (field.description) wrapper.append(element('span', 'guide-field__hint', field.description));
  let control;
  if (field.input_type === 'SELECT') { control = document.createElement('select'); control.append(new Option(`Select ${field.label}`, '')); for (const option of field.options || []) control.append(new Option(option.label, option.value)); control.value = text(values[field.id]); }
  else if (field.input_type === 'BOOLEAN') { control = document.createElement('input'); control.type = 'checkbox'; control.checked = values[field.id] === true; wrapper.classList.add('guide-field--boolean'); }
  else { control = document.createElement('input'); control.type = field.input_type === 'NUMBER' ? 'number' : 'text'; if (field.input_type === 'NUMBER') { if (field.min !== null) control.min = String(field.min); if (field.max !== null) control.max = String(field.max); control.step = 'any'; } control.maxLength = field.input_type === 'TEXT' ? 240 : 40; control.value = values[field.id] ?? ''; control.placeholder = field.unit ? `${field.label} (${field.unit})` : field.label; }
  control.required = field.required === true; control.dataset.guideFieldId = field.id;
  control.addEventListener('change', () => { const value = field.input_type === 'BOOLEAN' ? control.checked : field.input_type === 'NUMBER' ? (control.value === '' ? undefined : Number(control.value)) : control.value; if (value === undefined || value === '') delete values[field.id]; else values[field.id] = value; onChange(); });
  wrapper.append(control); return wrapper;
}
function bindEnterToSubmit(input, form) { input.addEventListener('keydown', (event) => { if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return; event.preventDefault(); if (!form.dataset.submitting) form.requestSubmit(); }); }
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
function addThinking(board) { const thinking = element('p', 'guide-thinking', document.documentElement.lang?.startsWith('tr') ? 'Düşünüyorum' : 'Thinking'); thinking.setAttribute('role', 'status'); board.append(thinking); thinking.scrollIntoView({ block: 'end' }); return thinking; }
const responseDelay = (value = PRESENTATION_TIMING.base_delay_ms) => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : value;
async function progressiveText(node, value) { const words = text(value).split(/(\s+)/); for (let index = 0; index < words.length; index += PRESENTATION_TIMING.chunk_words) { const chunk = words.slice(index, index + PRESENTATION_TIMING.chunk_words).join(''); node.textContent += chunk; const terminal = /[.!?]\s*$/.test(chunk) ? PRESENTATION_TIMING.sentence_pause_ms : PRESENTATION_TIMING.base_delay_ms; if (responseDelay(terminal)) await new Promise((resolve) => window.setTimeout(resolve, responseDelay(terminal))); } }
async function playGuideResponseEvents(board, events) {
  for (const event of Array.isArray(events) ? events : []) {
    if (event.type === 'THINKING' || event.type === 'MESSAGE_START' || event.type === 'MESSAGE_COMPLETE') continue;
    if (event.type === 'SECTION') { const heading = element('h3', 'guide-response__section'); board.append(heading); if (responseDelay(PRESENTATION_TIMING.section_pause_ms)) await new Promise((resolve) => window.setTimeout(resolve, responseDelay(PRESENTATION_TIMING.section_pause_ms))); await progressiveText(heading, event.text || event.title); continue; }
    if (event.type === 'LIST') { const list = element('ul', 'guide-response__list'); for (const item of event.items || []) list.append(element('li', '', item)); board.append(list); continue; }
    if (event.type === 'ACTION') { for (const label of event.actions || [event.label]) { const action = element('button', 'guide-response__action', label); action.type = 'button'; action.addEventListener('click', () => { if (/refine|roadmap|plan/i.test(label) && !/build|assistant/i.test(label)) { root.querySelector('.guide-roadmap-composer')?.focus(); return; } guideState.active_module = /assistant/i.test(label) ? MODULES.AI_ASSISTANT : MODULES.INTERACTIVE_TOOL; persistState(); renderActiveModule(); }); board.append(action); } continue; }
    if (event.type === 'TEXT_DELTA') { const paragraph = element('p', 'guide-response__text'); board.append(paragraph); await progressiveText(paragraph, event.text); }
  }
}
async function submitGuideRequest({ value, module, board, input, submit, onResponse }) {
  const thinking = addThinking(board); const startedAt = Date.now(); submit.disabled = true;
  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session ? { "X-Samcheguide-Session": session } : {}), ...(previewToken ? { "X-Samcheguide-Preview": previewToken } : {}) },
      body: JSON.stringify({
        text: value,
        guide_module: module,
        guide_context: guideContext(),
        guide_session_state: guideSessionPayloadState(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    saveSession(payload.conversation_session);
    const remainingThinking = PRESENTATION_TIMING.thinking_minimum_ms - (Date.now() - startedAt);
    if (responseDelay(remainingThinking) > 0) await new Promise((resolve) => window.setTimeout(resolve, responseDelay(remainingThinking)));
    thinking.remove();
    if (!response.ok || !Array.isArray(payload.guide_events)) throw new Error("unavailable");
    await playGuideResponseEvents(board, payload.guide_events);
    if (typeof onResponse === "function") onResponse(payload);
  } catch {
    thinking.remove();
    board.append(element("p", "guide-validation", "The guide is temporarily unavailable. Please try again."));
  } finally {
    submit.disabled = false;
    input?.focus();
  }
}
function renderConversationalRoadmap(container) {
  const roadmap = experience.roadmap || { steps: [] };
  container.append(element("p", "guide-module__eyebrow", "ROADMAP"), element("h2", "guide-module__title", roadmap.title || "Your roadmap"));
  if (roadmap.description) container.append(element("p", "guide-module__description", roadmap.description));

  const categoryContainer = element("div", "guide-intent-list");
  categoryContainer.setAttribute("aria-label", "Roadmap categories");
  for (const intent of suggestedRoadmapIntents(roadmap)) {
    const chip = element("button", "guide-intent" + (guideState.roadmap_category === intent ? " is-selected" : ""), intent);
    chip.type = "button";
    chip.dataset.intentValue = intent;
    chip.addEventListener("click", () => {
      guideState.roadmap_category = intent;
      guideState.shared_context = { ...(guideState.shared_context || {}), category: intent };
      persistState();
      queueGuideContextSync();
      const allChips = categoryContainer.querySelectorAll(".guide-intent");
      allChips.forEach((c) => c.classList.toggle("is-selected", c.dataset.intentValue === intent));
      const input = container.querySelector(".guide-roadmap-composer");
      if (input && !input.value) {
        input.value = intent;
        input.focus();
      }
    });
    categoryContainer.append(chip);
  }
  container.append(categoryContainer);

  const details = element("details", "guide-structured-details");
  details.append(element("summary", "", "Add or review planning details"));
  const formFields = element("div", "guide-step-card");
  for (const field of visibleFields(roadmap.steps, guideState.roadmap)) {
    formFields.append(inputForField(field, guideState.roadmap, () => {
      guideState.roadmap_validation_error = "";
      persistState();
      queueGuideContextSync();
    }));
  }
  const review = element("button", "guide-button guide-button--secondary", "Review roadmap");
  review.type = "button";
  review.addEventListener("click", () => {
    const invalid = validateRoadmapForReview(visibleFields(roadmap.steps, guideState.roadmap));
    if (invalid) {
      guideState.roadmap_validation_error = "Please complete " + invalid.label + ".";
      const existing = formFields.querySelector(".guide-validation");
      existing?.remove();
      formFields.append(element("p", "guide-validation", guideState.roadmap_validation_error));
      details.open = true;
      const missingControl = formFields.querySelector(`[data-guide-field-id="${invalid.id}"]`);
      missingControl?.focus({ preventScroll: true });
      missingControl?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    guideState.roadmap_reviewed = true;
    persistState();
    queueGuideContextSync();
    renderActiveModule();
  });
  formFields.append(review);
  details.append(formFields);
  container.append(details);

  const resultBoard = element("section", "guide-conversation-board guide-roadmap-board");
  resultBoard.setAttribute("aria-live", "polite");

  if (guideState.roadmap_result) {
    const resultCard = element("section", "guide-roadmap-result");
    resultCard.append(element("h3", "guide-roadmap-result__title", "Generated Roadmap Strategy"));
    const analysisText = typeof guideState.roadmap_result === "string"
      ? guideState.roadmap_result
      : (guideState.roadmap_result.content || guideState.roadmap_result.strategy || JSON.stringify(guideState.roadmap_result));
    resultCard.append(element("p", "guide-response__text", analysisText));
    resultBoard.append(resultCard);
  } else if (!guideState.roadmap_messages.length) {
    resultBoard.append(element("p", "guide-empty-state", "Tell us what you want to plan. We will shape a clear next-step roadmap with you."));
  }

  for (const msg of guideState.roadmap_messages) {
    const kind = msg.role === "user" ? "user" : "assistant";
    resultBoard.append(element("p", "guide-message guide-message--" + kind, msg.content));
  }
  container.append(resultBoard);

  const form = element("form", "guide-chat-form guide-roadmap-form");
  const input = document.createElement("textarea");
  input.className = "guide-roadmap-composer";
  input.rows = 2;
  input.maxLength = 2000;
  input.placeholder = guideState.roadmap_result
    ? "Ask a follow-up about this roadmap..."
    : "Describe your goal or choose a suggestion";
  input.setAttribute("aria-label", guideState.roadmap_result ? "Ask a roadmap follow-up" : "Describe your planning goal");
  if (!guideState.roadmap_result && guideState.roadmap_goal) {
    input.value = guideState.roadmap_goal;
  }
  const submit = element("button", "guide-button guide-chat-form__send", guideState.roadmap_result ? "Send" : "Analyze");
  submit.type = "submit";
  form.append(input, submit);
  bindEnterToSubmit(input, form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.submitting) return;
    const value = input.value.trim();
    if (!value) return;
    form.dataset.submitting = "true";

    const isInitialAnalyze = !guideState.roadmap_result;
    if (isInitialAnalyze) {
      guideState.roadmap_goal = value;
      guideState.shared_context = { ...(guideState.shared_context || {}), goal: value };
    }

    const empty = resultBoard.querySelector(".guide-empty-state");
    empty?.remove();
    resultBoard.append(element("p", "guide-message guide-message--user", value));
    input.value = "";

    try {
      await submitGuideRequest({
        value,
        module: "ROADMAP",
        board: resultBoard,
        input,
        submit,
        onResponse: (payload) => {
          const aiResponseText = payload.candidates?.[0]?.content?.parts?.[0]?.text
            || (payload.guide_events || []).filter((e) => e.type === "TEXT_DELTA").map((e) => e.text).join(" ")
            || "Analysis generated.";
          guideState.roadmap_messages.push({ role: "user", content: value });
          if (isInitialAnalyze) {
            guideState.roadmap_result = aiResponseText;
          }
          guideState.roadmap_messages.push({ role: "assistant", content: aiResponseText });
          persistState();
          queueGuideContextSync();
        },
      });
    } finally {
      delete form.dataset.submitting;
    }
  });

  container.append(form);
}
function renderRoadmap(container) { const roadmap = experience.roadmap || { steps: [] }; if (guideState.roadmap_reviewed) { container.append(element('p', 'guide-module__eyebrow', 'ROADMAP'), element('h2', 'guide-module__title', roadmap.title || 'Your roadmap')); renderRoadmapReview(container, roadmap, visibleFields(roadmap.steps, guideState.roadmap)); return; } renderConversationalRoadmap(container); }

function calculateTool() { const tool = experience.interactive_tool; let amount = safeNumber(tool.calculation?.base_amount); const rows = []; for (const term of tool.calculation?.terms || []) { const value = guideState.tool[term.field_id]; let valueAmount = 0; if (term.kind === 'NUMBER_MULTIPLIER' && typeof value === 'number') valueAmount = value * safeNumber(term.multiplier); else if (term.kind === 'BOOLEAN_AMOUNT' && value === true) valueAmount = safeNumber(term.amount); else if (term.kind === 'SELECT_AMOUNT' && typeof value === 'string') valueAmount = safeNumber(term.amounts?.[value]); amount += valueAmount; if (valueAmount || value !== undefined) rows.push({ label: term.label || term.field_id, amount: Number(valueAmount.toFixed(2)) }); } return { total: Number(amount.toFixed(2)), rows }; }
function renderToolBreakdown(tool) {
  const pricingAvailable = tool.pricing_mode === 'APPROVED_PRICING';
  if (!pricingAvailable) {
    return element('p', 'guide-tool-result__notice', 'Your planning scope is ready for commercial review. Final pricing and quotation require confirmation.');
  }
  const table = document.createElement('table');
  table.className = 'guide-tool-breakdown';
  return table;
}
function renderInteractiveTool(container) {
  const tool = experience.interactive_tool || { fields: [], calculation: { terms: [] } };
  container.append(
    element('p', 'guide-module__eyebrow', 'PLANNING'),
    element('h2', 'guide-module__title', tool.title || 'Event Planning')
  );
  if (tool.description) {
    container.append(element('p', 'guide-module__description', tool.description));
  }

  const form = element('form', 'guide-tool-form');
  form.noValidate = true;

  const fieldsGrid = element('div', 'guide-tool-grid');
  for (const field of visibleFields(tool.fields, guideState.tool)) {
    fieldsGrid.append(inputForField(field, guideState.tool, () => {
      persistState();
      queueGuideContextSync();
    }));
  }
  form.append(fieldsGrid);

  const actions = element('div', 'guide-tool-actions');
  const askButton = element('button', 'guide-button guide-button--primary guide-tool-ask-button', 'Ask the Assistant');
  askButton.type = 'button';
  askButton.addEventListener('click', handoffToAssistant);
  actions.append(askButton);
  form.append(actions);

  container.append(form);
}

function contextEntries(fields, values) { return visibleFields(fields, values).filter((field) => values[field.id] !== undefined && values[field.id] !== '').map((field) => ({ label: field.label, value: displayFieldValue(field, values[field.id]) })); }
function buildPlanningNaturalDraft(fields, values) {
  const activeEntries = visibleFields(fields, values)
    .filter((f) => values[f.id] !== undefined && values[f.id] !== '' && values[f.id] !== false && values[f.id] !== 'None' && values[f.id] !== 'Not selected');

  if (!activeEntries.length) {
    return 'I’m planning an event. Please help me refine the plan and recommend the next steps.';
  }

  const findVal = (idPatterns) => {
    const entry = activeEntries.find((f) => idPatterns.some((p) => f.id.toLowerCase().includes(p) || f.label.toLowerCase().includes(p)));
    return entry ? { field: entry, value: values[entry.id], display: displayFieldValue(entry, values[entry.id]) } : null;
  };

  const guestEntry = findVal(['guest', 'attendee', 'count']);
  const venueEntry = findVal(['venue', 'location']);
  const durationEntry = findVal(['duration', 'day', 'hour', 'length']);

  const handledIds = new Set();
  if (guestEntry) handledIds.add(guestEntry.field.id);
  if (venueEntry) handledIds.add(venueEntry.field.id);
  if (durationEntry) handledIds.add(durationEntry.field.id);

  let intro = 'I’m planning an event';
  if (guestEntry && venueEntry) {
    const venueLower = venueEntry.display.toLowerCase();
    const venuePrefix = venueLower.startsWith('hotel') || venueLower.startsWith('dedicated') || venueLower.startsWith('outdoor') ? 'in a ' : 'at ';
    intro += ` for ${guestEntry.value} guests ${venuePrefix}${venueLower}`;
  } else if (guestEntry) {
    intro += ` for ${guestEntry.value} guests`;
  } else if (venueEntry) {
    intro += ` at ${venueEntry.display}`;
  }
  intro += '.';

  const remaining = activeEntries.filter((f) => !handledIds.has(f.id));
  const detailPhrases = [];

  const requiredBooleans = [];
  for (const item of remaining) {
    const val = values[item.id];
    if (item.input_type === 'BOOLEAN' && val === true) {
      let label = item.label.toLowerCase().replace(/\s+required$/i, '');
      requiredBooleans.push(label);
    } else if (item.input_type === 'SELECT' || item.input_type === 'TEXT') {
      const display = displayFieldValue(item, val);
      if (display && display.toLowerCase() !== 'none' && display.toLowerCase() !== 'not selected') {
        let label = item.label;
        if (/stage.*av.*production/i.test(label)) label = 'AV/production';
        else if (/decoration/i.test(label)) label = 'decoration';
        detailPhrases.push(`${label} is ${display.toLowerCase()}`);
      }
    } else if (item.input_type === 'NUMBER') {
      detailPhrases.push(`${item.label.toLowerCase()} is ${val}${item.unit ? ' ' + item.unit : ''}`);
    }
  }

  if (requiredBooleans.length > 0) {
    const boolText = requiredBooleans.length === 1
      ? `${requiredBooleans[0]} is required`
      : `${requiredBooleans.slice(0, -1).join(', ')} and ${requiredBooleans[requiredBooleans.length - 1]} are required`;
    detailPhrases.push(boolText);
  }

  if (durationEntry) {
    const unit = durationEntry.field.unit || (Number(durationEntry.value) === 1 ? 'hour' : 'hours');
    detailPhrases.push(`the event duration is ${durationEntry.value} ${unit}`);
  }

  let detailsSentence = '';
  if (detailPhrases.length === 1) {
    detailsSentence = `${detailPhrases[0].charAt(0).toUpperCase() + detailPhrases[0].slice(1)}.`;
  } else if (detailPhrases.length > 1) {
    const joined = detailPhrases.slice(0, -1).join(', ') + ', and ' + detailPhrases[detailPhrases.length - 1];
    detailsSentence = `${joined.charAt(0).toUpperCase() + joined.slice(1)}.`;
  }

  const parts = [intro];
  if (detailsSentence) parts.push(detailsSentence);
  parts.push('Please help me refine the plan and recommend the next steps.');

  return parts.join(' ').slice(0, 2000);
}

function buildAssistantPrefill() {
  if (guideState.active_module === MODULES.INTERACTIVE_TOOL || Object.keys(guideState.tool || {}).length > 0) {
    return buildPlanningNaturalDraft(experience.interactive_tool?.fields || [], guideState.tool);
  }
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
  guideState.assistant_draft = buildPlanningNaturalDraft(experience.interactive_tool?.fields || [], guideState.tool);
  guideState.assistant_draft_origin = 'HANDOFF';
  guideState.active_module = MODULES.AI_ASSISTANT;
  persistState();
  renderActiveModule();
  queueGuideContextSync();
  window.requestAnimationFrame(() => {
    const textarea = root.querySelector('.guide-chat-form textarea');
    if (textarea) {
      textarea.value = guideState.assistant_draft;
      textarea.focus();
    }
  });
}
function addMessage(value, kind) { messages.push({ value: text(value), kind }); const board = preservedAssistantChat || root.querySelector('.guide-chat-messages'); if (!board) return; const item = element('p', `guide-message guide-message--${kind}`, value); board.append(item); item.scrollIntoView({ block: 'end' }); }
async function submitMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form?.dataset?.submitting) return;
  const input = form.querySelector('textarea');
  const value = text(input?.value).trim();
  if (!value) return;
  form.dataset.submitting = 'true';
  guideState.assistant_draft = '';
  guideState.assistant_draft_origin = 'NONE';
  persistState();
  input.value = '';
  const board = preservedAssistantChat || root.querySelector('.guide-chat-messages');
  const empty = board?.querySelector('.guide-empty-state');
  empty?.remove();
  board.append(element('p', 'guide-message guide-message--user', value));
  try {
    await submitGuideRequest({
      value,
      module: MODULES.AI_ASSISTANT,
      board,
      input,
      submit: form.querySelector('button[type="submit"]'),
      onResponse: (payload) => {
        const aiResponseText = payload.candidates?.[0]?.content?.parts?.[0]?.text
          || (payload.guide_events || []).filter((e) => e.type === "TEXT_DELTA").map((e) => e.text).join(" ");
        messages.push({ value, kind: 'user' });
        if (aiResponseText) {
          messages.push({ value: aiResponseText, kind: 'assistant' });
        }
        syncAssistantReminder();
      }
    });
  } finally {
    delete form.dataset.submitting;
  }
}
function renderAssistant(container) {
  const intro = experience.assistant_copy?.intro || experience.empty_state_copy || 'Ask a question or describe what you need.';
  container.append(
    element('p', 'guide-module__eyebrow', 'AI ASSISTANT'),
    element('h2', 'guide-module__title', experience.assistant_display_name || 'AI Assistant'),
    element('p', 'guide-module__description', intro)
  );
  const chat = element('section', 'guide-chat');
  if (!preservedAssistantChat) {
    preservedAssistantChat = element('section', 'guide-chat-messages');
    preservedAssistantChat.setAttribute('aria-live', 'polite');
    if (!messages.length) {
      const empty = element('section', 'guide-empty-state');
      empty.append(
        element('strong', '', 'How can we help?'),
        element('p', '', intro || experience.welcome_message || 'Start a conversation with our AI assistant.')
      );
      preservedAssistantChat.append(empty);
    }
    for (const message of messages) {
      preservedAssistantChat.append(element('p', `guide-message guide-message--${message.kind}`, message.value));
    }
  }
  const board = preservedAssistantChat;
  chat.append(board);
  const form = element('form', 'guide-chat-form');
  const input = document.createElement('textarea');
  input.rows = 2;
  input.maxLength = 2000;
  input.required = true;
  input.value = guideState.assistant_draft || '';
  input.placeholder = experience.input_placeholder || 'Type your message';
  input.setAttribute('aria-label', 'Message');
  input.addEventListener('input', () => {
    guideState.assistant_draft = input.value.slice(0, 2000);
    guideState.assistant_draft_origin = 'USER';
    persistState();
  });
  const button = element('button', 'guide-button guide-chat-form__send', experience.launcher_label || 'Send');
  button.type = 'submit';
  form.append(input, button);
  bindEnterToSubmit(input, form);
  form.addEventListener('submit', submitMessage);
  chat.append(form);
  container.append(chat);
}

function renderConversationReminder(container) { if (!messages.some((message) => message.kind === 'assistant')) return; container.append(element('p', 'guide-conversation-reminder', 'Continue your conversation whenever you are ready.')); }
let assistantReminderTimeout = null;
let assistantReminderCycle = 'idle';

function reminderDismissalStorageKey() {
  return `samcheguide-reminder-dismissed:${previewToken ? 'preview:' + previewToken.slice(-16) : 'public'}:${experience?.version ?? 'unknown'}`;
}

function isAssistantReminderDismissed() {
  try { return window.sessionStorage?.getItem(reminderDismissalStorageKey()) === 'true'; } catch { return false; }
}

function dismissAssistantReminder() {
  try { window.sessionStorage?.setItem(reminderDismissalStorageKey(), 'true'); } catch {}
  clearAssistantReminderTimer();
  removeAssistantReminderBubble();
}

function clearAssistantReminderTimer() {
  if (assistantReminderTimeout) {
    window.clearTimeout(assistantReminderTimeout);
    assistantReminderTimeout = null;
  }
}

function hasAssistantConversationStarted() {
  return messages.some((message) => message.kind === 'user' && text(message.value).trim().length > 0);
}

function removeAssistantReminderBubble() {
  const existing = root ? root.querySelector('.guide-assistant-reminder') : document.querySelector('.guide-assistant-reminder');
  if (existing) existing.remove();
}

function createAssistantReminderBubble(messageText) {
  removeAssistantReminderBubble();
  const assistantSlot = root ? root.querySelector('.guide-navigation__slot[data-guide-slot="AI_ASSISTANT"]') : document.querySelector('.guide-navigation__slot[data-guide-slot="AI_ASSISTANT"]');
  const targetParent = assistantSlot || (root ? root.querySelector('.guide-navigation') : document.querySelector('.guide-navigation'));
  if (!targetParent) return null;

  const bubble = element('div', 'guide-assistant-reminder');
  bubble.setAttribute('role', 'status');

  const actionButton = element('button', 'guide-assistant-reminder__button');
  actionButton.type = 'button';
  actionButton.append(element('span', 'guide-assistant-reminder__text', messageText));
  actionButton.addEventListener('click', () => {
    guideState.active_module = MODULES.AI_ASSISTANT;
    persistState();
    renderActiveModule();
  });

  const closeButton = element('button', 'guide-assistant-reminder__close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Dismiss Assistant reminder');
  closeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    dismissAssistantReminder();
  });

  bubble.append(actionButton, closeButton);
  targetParent.prepend(bubble);
  return bubble;
}

function scheduleAssistantReminderCycle(step) {
  clearAssistantReminderTimer();
  if (isAssistantReminderDismissed() || guideState?.active_module === MODULES.AI_ASSISTANT) {
    assistantReminderCycle = 'idle';
    removeAssistantReminderBubble();
    return;
  }
  const hasAssistantNav = enabledModules().includes(MODULES.AI_ASSISTANT);
  if (!hasAssistantNav) {
    assistantReminderCycle = 'idle';
    removeAssistantReminderBubble();
    return;
  }

  const reminderText = hasAssistantConversationStarted()
    ? 'Continue your Assistant conversation'
    : 'Ask the Assistant';

  if (step === 'show') {
    assistantReminderCycle = 'visible';
    createAssistantReminderBubble(reminderText);
    assistantReminderTimeout = window.setTimeout(() => {
      scheduleAssistantReminderCycle('hide');
    }, 5000);
  } else {
    assistantReminderCycle = 'hidden';
    removeAssistantReminderBubble();
    assistantReminderTimeout = window.setTimeout(() => {
      scheduleAssistantReminderCycle('show');
    }, 5000);
  }
}

function syncAssistantReminder() {
  if (isAssistantReminderDismissed() || guideState?.active_module === MODULES.AI_ASSISTANT || !enabledModules().includes(MODULES.AI_ASSISTANT)) {
    clearAssistantReminderTimer();
    removeAssistantReminderBubble();
    assistantReminderCycle = 'idle';
    return;
  }
  if (assistantReminderCycle === 'idle') {
    scheduleAssistantReminderCycle('show');
  } else if (assistantReminderCycle === 'visible') {
    const reminderText = hasAssistantConversationStarted()
      ? 'Continue your Assistant conversation'
      : 'Ask the Assistant';
    const textNode = root ? root.querySelector('.guide-assistant-reminder__text') : document.querySelector('.guide-assistant-reminder__text');
    if (textNode) {
      textNode.textContent = reminderText;
    } else {
      createAssistantReminderBubble(reminderText);
    }
  }
}

let __moduleLayersCreated = false;
function renderActiveModule() { const outlet = root.querySelector('.guide-module'); if (!outlet) return; if (!__moduleLayersCreated) { outlet.append(element('div', 'guide-module-layer guide-module-layer--roadmap'), element('div', 'guide-module-layer guide-module-layer--tool'), element('div', 'guide-module-layer guide-module-layer--assistant')); __moduleLayersCreated = true; } const layerRoadmap = outlet.querySelector('.guide-module-layer--roadmap'); const layerTool = outlet.querySelector('.guide-module-layer--tool'); const layerAssistant = outlet.querySelector('.guide-module-layer--assistant'); layerRoadmap.hidden = guideState.active_module !== MODULES.ROADMAP; layerTool.hidden = guideState.active_module !== MODULES.INTERACTIVE_TOOL; layerAssistant.hidden = guideState.active_module !== MODULES.AI_ASSISTANT; if (guideState.active_module === MODULES.ROADMAP) { clear(layerRoadmap); renderRoadmap(layerRoadmap); } else if (guideState.active_module === MODULES.INTERACTIVE_TOOL) { clear(layerTool); renderInteractiveTool(layerTool); } else { clear(layerAssistant); renderAssistant(layerAssistant); renderConversationReminder(layerAssistant); } for (const button of root.querySelectorAll('[data-guide-module]')) { const active = button.dataset.guideModule === guideState.active_module; button.classList.toggle('is-active', active); button.setAttribute('aria-current', active ? 'page' : 'false'); } syncAssistantReminder(); }

export function applyExperience(value) {
  if (!root || !value || typeof value !== 'object') throw new Error('invalid guide experience');
  experience = value; guideState = loadState(); if (!enabledModules().includes(guideState.active_module)) guideState.active_module = firstAvailableModule();
  const theme = experience.theme || {}; const styles = document.documentElement.style; styles.setProperty('--guide-primary', theme.primary_color || '#1F4B99'); styles.setProperty('--guide-accent', theme.accent_color || '#4F7FD8'); styles.setProperty('--guide-background', theme.background_color || '#0E1522'); styles.setProperty('--guide-foreground', theme.foreground_color || '#F8FAFC'); styles.setProperty('--guide-surface', theme.surface_color || '#18212F'); styles.setProperty('--guide-border', theme.border_color || '#334155'); styles.setProperty('--guide-button-foreground', theme.button_foreground || '#FFFFFF'); styles.setProperty('--guide-radius', theme.corner_radius === 'LARGE' ? '1.4rem' : theme.corner_radius === 'SMALL' ? '.65rem' : '1rem'); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background_color || '#0E1522'); document.title = text(experience.brand_name, 'AI Guide');
  const shell = element('main', 'guide-shell'); const canvas = element('section', 'guide-canvas'); canvas.setAttribute('aria-label', text(experience.brand_name, 'AI Guide'));
  const header = element('header', 'guide-header'); const identity = element('div', 'guide-identity'); if (experience.logo_url) { const logo = document.createElement('img'); logo.className = 'guide-logo'; setAsset(logo, experience.logo_url, `${text(experience.brand_name)} logo`); identity.append(logo); } const names = element('div', 'guide-names'); names.append(element('p', 'guide-brand-name', experience.brand_name || 'AI Guide'), element('p', 'guide-status', experience.assistant_status_label || 'Online')); identity.append(names); header.append(identity); if (experience.avatar_url) { const avatar = document.createElement('img'); avatar.className = 'guide-avatar'; setAsset(avatar, experience.avatar_url, `${text(experience.assistant_display_name)} avatar`); header.append(avatar); } canvas.append(header);
  const hero = element('section', 'guide-hero'); hero.append(element('p', 'guide-hero__eyebrow', 'AI GUIDE'), element('h1', 'guide-hero__title', experience.hero?.title || experience.welcome_title || 'How can we help?'), element('p', 'guide-hero__message', experience.hero?.message || experience.welcome_message || 'Choose a path or ask a question to get started.')); canvas.append(hero); const outlet = element('section', 'guide-module'); canvas.append(outlet);
  const navigation = element('nav', 'guide-navigation');
  navigation.setAttribute('aria-label', 'Guide experiences');
  for (const module of enabledModules()) {
    const slot = element('div', 'guide-navigation__slot');
    slot.dataset.guideSlot = module;
    const button = element('button', 'guide-navigation__item');
    button.type = 'button';
    button.dataset.guideModule = module;
    button.append(element('span', 'guide-navigation__icon', moduleIcon(module)), element('span', 'guide-navigation__label', moduleLabel(module)));
    button.addEventListener('click', () => {
      guideState.active_module = module;
      persistState();
      renderActiveModule();
    });
    slot.append(button);
    navigation.append(slot);
  }
  canvas.append(navigation); shell.append(canvas); root.replaceChildren(shell); guideInitialized = true; window.clearTimeout(initializationTimeout); renderActiveModule(); resumeGuideSession();
}

fetch('/guide/bootstrap' + (previewToken ? `?preview=${encodeURIComponent(previewToken)}` : ''), { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error('unavailable'); return response.json(); }).then((payload) => applyExperience(payload?.experience)).catch(showGuideError);
