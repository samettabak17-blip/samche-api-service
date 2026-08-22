import { createHmac, timingSafeEqual } from 'crypto';

export function verifyWhatsAppSignature(req, res, next, appSecret = process.env.WHATSAPP_APP_SECRET) {
  const signature = req.get('x-hub-signature-256');

  if (!appSecret) {
    console.error('WHATSAPP_APP_SECRET is not configured.');
    return res.sendStatus(500);
  }

  if (!signature || !req.rawBody) {
    return res.sendStatus(401);
  }

  const expectedSignature = `sha256=${createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return res.sendStatus(401);
  }

  return next();
}
