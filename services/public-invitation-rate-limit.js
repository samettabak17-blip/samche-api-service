import crypto from 'node:crypto';

const attempts = new Map();

function keyFor({ kind, ip, token }) {
  const tokenHash = crypto.createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
  return `${kind}:${ip ?? 'unknown'}:${tokenHash}`;
}

export function allowPublicInvitationAttempt({ kind, ip, token, now = Date.now() }) {
  const limit = kind === 'accept' ? 5 : 20;
  const windowMs = 15 * 60 * 1000;
  const key = keyFor({ kind, ip, token });
  const state = attempts.get(key) ?? { startedAt: now, count: 0 };
  if (now - state.startedAt >= windowMs) { state.startedAt = now; state.count = 0; }
  state.count += 1;
  attempts.set(key, state);
  return state.count <= limit;
}
