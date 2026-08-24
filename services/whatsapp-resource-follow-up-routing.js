const EXPLICIT_RESOURCE_REFERENCE = /(az önce(?:ki)?\s+(?:pdf|dosya|belge|görsel)|(?:bu|gönderdiğim|yukarıdaki)\s*(?:pdf|dosya|belge|cv|görsel)|this\s+(?:pdf|file|document|cv|image)|the\s+(?:previous|above)\s+(?:pdf|file|document|cv|image)|(?:هذا|هذه)\s+(?:الوثيقة|الملف|السيرة الذاتية|الصورة))/i;

export function planWhatsAppResourceFollowUp({ customerText, readyResourceCount = 0, processingResourceCount = 0 }) {
  if (!EXPLICIT_RESOURCE_REFERENCE.test(String(customerText ?? ''))) return { action: 'CONTINUE' };
  if (readyResourceCount > 0) return { action: 'DOCUMENT_GROUNDED' };
  if (processingResourceCount > 0) return { action: 'RESOURCE_PROCESSING', invokesModel: false };
  return { action: 'CONTINUE' };
}

export function planLatestExplicitResource({ explicit, latestResource }) {
  if (!explicit || !latestResource) return { action: 'CONTINUE' };
  if (latestResource.processing_status === 'READY') return { action: 'RESOURCE_GROUNDED', invokesModel: true };
  if (latestResource.processing_status === 'PROCESSING') return { action: 'RESOURCE_PROCESSING', invokesModel: false };
  if (latestResource.processing_status === 'FAILED') return { action: 'RESOURCE_FAILED', invokesModel: false };
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

export function resourceFailureAcknowledgement(language, category = 'DOCUMENT') {
  const messages = {
    tr: category === 'IMAGE'
      ? 'Gönderdiğiniz son görsel şu anda işlenemedi. Lütfen görseli yeniden gönderin veya farklı bir dosya formatıyla tekrar deneyin.'
      : 'Gönderdiğiniz son belge şu anda işlenemedi. Lütfen belgeyi yeniden gönderin veya farklı bir dosya formatıyla tekrar deneyin.',
    en: category === 'IMAGE'
      ? 'Your most recent image could not be processed. Please send it again or try a different file format.'
      : 'Your most recent document could not be processed. Please send it again or try a different file format.',
    ar: category === 'IMAGE'
      ? 'تعذرت معالجة آخر صورة أرسلتها. يرجى إرسالها مرة أخرى أو تجربة صيغة ملف مختلفة.'
      : 'تعذرت معالجة آخر مستند أرسلته. يرجى إرساله مرة أخرى أو تجربة صيغة ملف مختلفة.',
  };
  return messages[language] ?? messages.tr;
}

