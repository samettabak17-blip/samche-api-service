let session = '';
try { session = window.sessionStorage?.getItem('samcheguide-session') || ''; } catch { session = ''; }

const root = document.querySelector('#guide-root');
let guideInitialized = false;
const showGuideError = () => {
  if (guideInitialized || !root) return;
  guideInitialized = true;
  root.innerHTML = '<p class="guide-error">Guide experience is temporarily unavailable.</p>';
};
const initializationTimeout = window.setTimeout(showGuideError, 10000);
const text = (value) => String(value ?? '');
const html = (strings, ...values) => strings.reduce((result, part, index) => result + part + (index < values.length ? values[index] : ''), '');

function setAsset(element, value, alt) {
  if (!value) { element.hidden = true; return; }
  element.src = value; element.alt = alt; element.hidden = false;
}

export function applyExperience(experience) {
  if (!root || !experience || typeof experience !== 'object') throw new Error('invalid guide experience');
  const theme = experience.theme || {};
  const styles = document.documentElement.style;
  styles.setProperty('--guide-primary', theme.primary_color || '#1F4B99');
  styles.setProperty('--guide-accent', theme.accent_color || '#4F7FD8');
  styles.setProperty('--guide-background', theme.background_color || '#F7F8FA');
  styles.setProperty('--guide-foreground', theme.foreground_color || '#18212F');
  styles.setProperty('--guide-surface', theme.surface_color || '#FFFFFF');
  styles.setProperty('--guide-border', theme.border_color || '#D9E0EA');
  styles.setProperty('--guide-radius', theme.corner_radius === 'LARGE' ? '1.25rem' : theme.corner_radius === 'SMALL' ? '.5rem' : '.85rem');
  document.title = text(experience.brand_name || 'AI Guide');
  root.innerHTML = html`<section class="guide-shell"><section class="guide-panel" aria-label="${text(experience.brand_name || 'AI Guide')}"><header class="guide-header"><img class="guide-logo" hidden /><img class="guide-avatar" hidden /><div><p class="guide-name"></p><p class="guide-status"></p></div></header><section class="guide-copy"><h1></h1><p></p></section><section class="guide-messages" aria-live="polite"><p class="guide-empty"></p></section><form class="guide-form"><input aria-label="Message" required maxlength="2000" /><button type="submit"></button></form></section></section>`;
  const logo = root.querySelector('.guide-logo'); const avatar = root.querySelector('.guide-avatar');
  setAsset(logo, experience.logo_url, `${text(experience.brand_name)} logo`); setAsset(avatar, experience.avatar_url, `${text(experience.assistant_display_name)} avatar`);
  root.querySelector('.guide-name').textContent = text(experience.assistant_display_name || experience.brand_name || 'AI Guide');
  root.querySelector('.guide-status').textContent = text(experience.assistant_status_label || 'Online');
  root.querySelector('.guide-copy h1').textContent = text(experience.welcome_title || 'How can we help?');
  root.querySelector('.guide-copy p').textContent = text(experience.welcome_message || 'Ask a question to get started.');
  root.querySelector('.guide-empty').textContent = text(experience.empty_state_copy || 'Start a conversation when you are ready.');
  root.querySelector('.guide-form input').placeholder = text(experience.input_placeholder || 'Type your message');
  root.querySelector('.guide-form button').textContent = text(experience.launcher_label || 'Send');
  root.querySelector('.guide-form').addEventListener('submit', submitMessage);
  guideInitialized = true;
  window.clearTimeout(initializationTimeout);
}

function addMessage(value, kind) { const item = document.createElement('p'); item.className = `guide-message guide-message--${kind}`; item.textContent = value; root.querySelector('.guide-messages').append(item); item.scrollIntoView({ block: 'end' }); }
async function submitMessage(event) { event.preventDefault(); const input = event.currentTarget.querySelector('input'); const value = input.value.trim(); if (!value) return; input.value = ''; addMessage(value, 'user'); const response = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Samcheguide-Session': session } : {}) }, body: JSON.stringify({ text: value }) }); const payload = await response.json(); if (payload.conversation_session) { session = payload.conversation_session; try { window.sessionStorage?.setItem('samcheguide-session', session); } catch {} } const reply = payload?.candidates?.[0]?.content?.parts?.[0]?.text; addMessage(response.ok && reply ? reply.replace(/<[^>]+>/g, '') : 'The guide is temporarily unavailable. Please try again.', 'assistant'); }

fetch('/guide/bootstrap', { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error('unavailable'); return response.json(); }).then((payload) => applyExperience(payload?.experience)).catch(showGuideError);
