const STANDALONE_MEDIA_ACKNOWLEDGEMENTS = {
  tr: {
    DOCUMENT: 'Belgeniz alındı. Bu belgeyle ilgili hangi konuda yardımcı olmamı istersiniz? Örneğin içeriğini özetleyebilir, belirli bilgileri çıkarabilir veya sorularınızı belgeye göre yanıtlayabilirim.',
    IMAGE: 'Görseliniz alındı. Bu görselle ilgili neyi incelememi istersiniz? Görseldeki yazıları okuyabilir, belirli detayları inceleyebilir veya sorularınızı görsele göre yanıtlayabilirim.',
    AUDIO: 'Sesli mesajınız alındı.',
  },
  en: {
    DOCUMENT: 'Your document has been received. How would you like me to help with it? For example, I can summarize it, extract specific information, or answer questions based on the document.',
    IMAGE: 'Your image has been received. What would you like me to examine? I can read visible text, inspect specific details, or answer questions based on the image.',
    AUDIO: 'Your voice message has been received.',
  },
  ar: {
    DOCUMENT: 'تم استلام المستند. كيف تود أن أساعدك بشأنه؟ يمكنني تلخيصه أو استخراج معلومات محددة أو الإجابة عن أسئلتك استنادًا إلى المستند.',
    IMAGE: 'تم استلام الصورة. ما الذي تود أن أفحصه فيها؟ يمكنني قراءة النص الظاهر أو فحص تفاصيل محددة أو الإجابة عن أسئلتك بناءً على الصورة.',
    AUDIO: 'تم استلام رسالتك الصوتية.',
  },
};

function mediaCategory(descriptor) {
  const mimeType = String(descriptor?.declaredMimeType ?? '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

function acknowledgementLanguage(language) {
  return Object.hasOwn(STANDALONE_MEDIA_ACKNOWLEDGEMENTS, language) ? language : 'tr';
}

/**
 * This returns a deterministic transport action only. It deliberately does not
 * inspect media bytes, extracted content, model state, or tenant data.
 */
export function planStandaloneWhatsAppMediaResponse({
  customerText,
  descriptor,
  shouldInvokeAi,
  duplicate,
  language,
}) {
  if (duplicate || !shouldInvokeAi || !descriptor || String(customerText ?? '').trim()) {
    return { action: 'CONTINUE' };
  }

  const category = mediaCategory(descriptor);
  return {
    action: 'ACKNOWLEDGE',
    invokesModel: false,
    message: STANDALONE_MEDIA_ACKNOWLEDGEMENTS[acknowledgementLanguage(language)][category],
  };
}

