/**
 * Bounded, adaptive response pacing for WhatsApp AI conversations.
 * Ensures natural human-like cadence for fast responses without adding
 * unnecessary delay to legitimately slow responses.
 */

export const MIN_COMPOSE_WINDOW_MS = 1500;
export const MAX_ARTIFICIAL_DELAY_MS = 2500;

/**
 * Calculates adaptive compose delay based on actual elapsed generation time and response size.
 * If processing time already met or exceeded the target window, delay is 0.
 * Delay is strictly capped at maxArtificialDelayMs.
 */
export function calculateWhatsAppAdaptivePacingDelay({
  generationStartedAt,
  content,
  now = Date.now(),
  minComposeWindowMs = MIN_COMPOSE_WINDOW_MS,
  maxArtificialDelayMs = MAX_ARTIFICIAL_DELAY_MS,
}) {
  if (!generationStartedAt || typeof generationStartedAt !== 'number') {
    return 0;
  }

  const elapsed = Math.max(0, now - generationStartedAt);
  const text = String(content ?? '');
  // Natural compose time scales smoothly with content length up to 1 second extra
  const lengthBonus = Math.min(Math.floor(text.length / 40) * 100, 1000);
  const targetComposeWindow = minComposeWindowMs + lengthBonus;

  // If the AI took long enough naturally, add ZERO artificial delay
  if (elapsed >= targetComposeWindow) {
    return 0;
  }

  const neededDelay = targetComposeWindow - elapsed;
  return Math.max(0, Math.min(maxArtificialDelayMs, neededDelay));
}

/**
 * Applies bounded natural response pacing when generation completes unrealistically quickly.
 * Does not mutate message content or invoke LLM calls.
 */
export async function applyWhatsAppAdaptivePacing({
  generationStartedAt,
  content,
  minComposeWindowMs = MIN_COMPOSE_WINDOW_MS,
  maxArtificialDelayMs = MAX_ARTIFICIAL_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const delay = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt,
    content,
    minComposeWindowMs,
    maxArtificialDelayMs,
  });

  if (delay > 0) {
    await sleep(delay);
  }

  return { delayedMs: delay };
}
