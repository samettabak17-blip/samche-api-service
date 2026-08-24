const EXPLICIT_RESOURCE_REFERENCE = /(az önce(?:ki)?\s+(?:pdf|dosya|belge|görsel)|(?:bu|gönderdiğim|yukarıdaki)\s*(?:pdf|dosya|belge|cv|görsel)|this\s+(?:pdf|file|document|cv|image)|the\s+(?:previous|above)\s+(?:pdf|file|document|cv|image)|(?:هذا|هذه)\s+(?:الوثيقة|الملف|السيرة الذاتية|الصورة))/i;

export function planWhatsAppResourceFollowUp({ customerText, readyResourceCount = 0, processingResourceCount = 0 }) {
  if (!EXPLICIT_RESOURCE_REFERENCE.test(String(customerText ?? ''))) return { action: 'CONTINUE' };
  if (readyResourceCount > 0) return { action: 'DOCUMENT_GROUNDED' };
  if (processingResourceCount > 0) return { action: 'RESOURCE_PROCESSING', invokesModel: false };
  return { action: 'CONTINUE' };
}

export function resourceProcessingAcknowledgement(language) {
  const messages = {
    tr: 'Belgenizi işlemeye devam ediyorum. Birkaç saniye sonra sorunuzu belgeye göre yanıtlayabilirim.',
    en: 'I am still processing your document. Please try your question again in a few seconds and I can answer it from the document.',
    ar: 'ما زلت أعالج المستند. يمكنك إعادة إرسال سؤالك بعد بضع ثوانٍ وسأجيب عليه استنادًا إلى المستند.',
  };
  return messages[language] ?? messages.tr;
}

