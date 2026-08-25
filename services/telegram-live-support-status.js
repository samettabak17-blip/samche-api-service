function customerDigits(customerExternalId) {
  return String(customerExternalId ?? '').replace(/^whatsapp:/i, '').replace(/[^0-9]/g, '');
}

export function legacyTelegramSupportClosedStatus(customerExternalId) {
  const recipient = customerDigits(customerExternalId);
  return recipient ? `Canlı destek kapatıldı → +${recipient}` : null;
}

async function postTelegram(url, body) {
  if (typeof fetch !== 'function') return false;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.ok;
}

/**
 * Legacy Telegram status delivery is intentionally non-blocking: Dashboard
 * state, WhatsApp delivery and the transaction remain authoritative.
 */
export async function notifyLegacyTelegramSupportClosed({ customerExternalId, post = postTelegram, env = process.env }) {
  const text = legacyTelegramSupportClosedStatus(customerExternalId);
  const chatId = String(env.TELEGRAM_CHAT_ID ?? '').trim();
  const token = String(env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!text || !chatId || !token) return false;
  try {
    return await post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text });
  } catch {
    return false;
  }
}
