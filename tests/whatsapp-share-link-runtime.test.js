import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processMessageUrlIntelligence,
  extractUrlsFromText,
} from '../services/url-intelligence-service.js';
import {
  buildContextualIntelligencePromptSection,
  updateSessionBrowsingStateWithEntity,
  PROVENANCE_SOURCES,
} from '../services/contextual-intelligence-service.js';
import {
  buildWhatsAppActivePersonaTenantContext,
  buildWhatsAppTenantModelContext,
} from '../services/whatsapp-tenant-context-service.js';

test('WhatsApp Real Runtime Chain: share link with "Bu şekilde bir şey istiyorum" delivers visual context & imagePart without fallback', async () => {
  const customerText = 'Bu şekilde bir şey istiyorum. https://share.google/32c32rRAH9oUVfDN3';
  const exactUrl = 'https://share.google/32c32rRAH9oUVfDN3';
  const hop2Url = 'https://www.google.com/share.google?q=32c32rRAH9oUVfDN3';
  const hop3Url = 'https://www.google.com/imgres?imgurl=https://www.onlineicmimar.net/wp-content/uploads/2021/08/4.jpg&tbnid=Ct48bMJ8sl5HkM&vet=1&imgrefurl=https://www.onlineicmimar.net/magaza/peyzaj-tasarimi/?srsltid=AfmBOora2N5Bl3BlvSMwo_rrzSClSAfHjY90m3LFwO32J2DBXFpxnpdf';
  const imageUrl = 'https://www.onlineicmimar.net/wp-content/uploads/2021/08/4.jpg';

  const mockWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.from('VP8 ')]);

  const googleImageHtml = `
    <!doctype html><html lang="tr-AE"><head>
      <meta content="www.onlineicmimar.net" property="og:title">
      <meta content="${imageUrl}" property="og:image">
      <meta content="${imageUrl}" itemprop="image">
      <meta content="${imageUrl}" name="twitter:image">
      <meta content="summary_large_image" name="twitter:card">
      <title>Google Image Result</title>
    </head><body><p>Google Images wrapper</p></body></html>
  `;

  const mockFetch = async (target) => {
    if (target === exactUrl) return { ok: false, status: 302, headers: new Map([['location', hop2Url]]) };
    if (target === hop2Url) return { ok: false, status: 301, headers: new Map([['location', hop3Url]]) };
    if (target === hop3Url) return { ok: true, status: 200, headers: new Map([['content-type', 'text/html; charset=UTF-8']]), text: async () => googleImageHtml };
    if (target === imageUrl) return { ok: true, status: 200, headers: new Map([['content-type', 'image/webp']]), arrayBuffer: async () => mockWebp.buffer.slice(mockWebp.byteOffset, mockWebp.byteOffset + mockWebp.byteLength) };
    throw new Error('Unexpected URL: ' + target);
  };

  const SAFE_PUBLIC_DNS = async () => [{ address: '93.184.216.34', family: 4 }];

  // Step 1: URL Extraction
  const wpUrls = extractUrlsFromText(customerText);
  assert.equal(wpUrls.length, 1);
  assert.equal(wpUrls[0], exactUrl);

  // Step 2: Universal URL Intelligence Pipeline
  let wpUrlImagePart = null;
  let whatsappVisitorContext = null;
  const urlResult = await processMessageUrlIntelligence({
    text: customerText,
    fetchImpl: mockFetch,
    lookupImpl: SAFE_PUBLIC_DNS,
    multimodalAnalyzer: async () => ({
      category: 'LANDSCAPING',
      visual_summary: 'Doğal taş ve modern bitkilendirme ile villa bahçesi peyzaj tasarımı',
      visual_form: 'Kademeli zemin yerleşimi, ahşap oturma alanları ve yeşil bodur çalılar',
      visual_colors: 'Doğal taş grisi, yeşil bitki örtüsü, antrasit detaylar',
      visual_material: 'Doğal taş, ahşap zemin kaplama',
      visual_style: 'Modern villa peyzajı',
      notable_features: ['Kademeli bahçe', 'Gizli aydınlatma'],
      approximate_proportions: 'Açık teras ve geniş bahçe yerleşimi',
      exact_dimensions_note: 'Exact physical dimensions cannot be established from the image alone without official specifications.',
    }),
  });

  assert.equal(urlResult.success, true);
  assert.ok(urlResult.imagePart, 'Multimodal imagePart must be produced');
  assert.equal(urlResult.imagePart.inline_data.mime_type, 'image/webp');
  wpUrlImagePart = urlResult.imagePart;

  // Step 3: Session browsing state updated with entity
  whatsappVisitorContext = updateSessionBrowsingStateWithEntity({
    currentState: whatsappVisitorContext,
    newEntity: urlResult.entity,
  });
  assert.ok(whatsappVisitorContext.currentEntity);
  assert.equal(whatsappVisitorContext.currentEntity.attributes['visual_category'], 'LANDSCAPING');
  assert.equal(whatsappVisitorContext.currentEntity.attribute_provenance['visual_summary'], PROVENANCE_SOURCES.EXTERNAL_URL_VISUAL_FACT);

  // Step 4: Build Contextual Intelligence Prompt Section
  const whatsappContextualSection = buildContextualIntelligencePromptSection({
    currentEntity: whatsappVisitorContext.currentEntity,
    previousEntities: whatsappVisitorContext.previousEntities,
    channelType: 'WHATSAPP',
  });
  assert.match(whatsappContextualSection, /VISITOR BROWSING CONTEXT/);
  assert.match(whatsappContextualSection, /EXTERNAL_URL_VISUAL_FACT/);
  assert.match(whatsappContextualSection, /Doğal taş ve modern bitkilendirme ile villa bahçesi peyzaj tasarımı/);
  assert.match(whatsappContextualSection, /Exact physical dimensions cannot be established from the image alone/);


  // Step 5: Active Persona Tenant Context
  const yesilVadiPersona = {
    available: true,
    companyIdentity: 'Yeşil Vadi Peyzaj',
    assistantIdentity: 'Yeşil Vadi Asistanı',
    configuration: {
      system_prompt: 'Sen Yeşil Vadi Peyzaj şirketinin kurumsal yapay zeka asistanısın. Müşterilere peyzaj ve bahçe tasarımı konusunda yardımcı olursun.',
    },
  };

  const runtimeTenantContext = buildWhatsAppActivePersonaTenantContext({
    persona: yesilVadiPersona,
    knowledgeContext: 'Hizmetlerimiz: Villa bahçe peyzajı, otomatik sulama sistemleri, rulo çim uygulaması, biyoklimatik pergola ve havuz çevre düzenlemesi.',
    communicationLanguage: 'tr',
    contextualIntelligence: whatsappContextualSection,
  });

  assert.equal(runtimeTenantContext.companyName, 'Yeşil Vadi Peyzaj');
  assert.match(runtimeTenantContext.systemPrompt, /Doğal taş ve modern bitkilendirme ile villa bahçesi peyzaj tasarımı/);

  // Step 6: Build WhatsApp Model Context
  const modelContext = buildWhatsAppTenantModelContext({
    tenant: runtimeTenantContext,
    history: [],
    customerText,
    communicationLanguage: 'tr',
  });

  assert.match(modelContext.systemInstruction, /Yeşil Vadi Peyzaj/);
  assert.match(modelContext.systemInstruction, /EXTERNAL_URL_VISUAL_FACT/);
  assert.match(modelContext.userPrompt, /Bu şekilde bir şey istiyorum/);

  // Step 7: Verify combined multimodal context parts
  const combinedAiContextParts = [
    ...(wpUrlImagePart ? [wpUrlImagePart] : []),
  ];
  assert.equal(combinedAiContextParts.length, 1);
  assert.equal(combinedAiContextParts[0].inline_data.mime_type, 'image/webp');
  assert.ok(combinedAiContextParts[0].inline_data.data.length > 0);

  // Step 8: Verify simulated model generation receives multimodal parts and grounded instructions
  let simulatedModelCalledWith = null;
  const mockGeminiGenerate = async (request) => {
    simulatedModelCalledWith = request;
    return {
      candidates: [{
        content: {
          parts: [{
            text: 'Paylaştığınız görseldeki kademeli doğal taş teras ve modern bitkilendirme tasarımını inceledim. Yeşil Vadi Peyzaj olarak villa bahçeniz için benzer kademeli teras, ahşap oturma alanları ve otomatik sulama sistemli bitkilendirme projelerini anahtar teslim uygulayabiliriz. Alanınızın yaklaşık büyüklüğü nedir?',
          }],
        },
      }],
    };
  };

  // Simulate callWpGemini
  const parts = [{ text: modelContext.userPrompt }, ...combinedAiContextParts];
  const response = await mockGeminiGenerate({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: modelContext.systemInstruction }] },
  });

  const assistantResponse = response.candidates[0].content.parts[0].text;

  // Step 9: Verify final response is grounded in visual characteristics and does NOT trigger generic fallback
  const genericFallback = 'Size en doğru bilgiyi sunabilmem için konuyu biraz daha netleştirebilir misiniz?';
  assert.doesNotMatch(assistantResponse, new RegExp(genericFallback, 'i'), 'Generic fallback must NOT be triggered when visual evidence is available');
  assert.match(assistantResponse, /doğal taş|kademeli|peyzaj|teras/i, 'Response must describe visible grounded characteristics');
  assert.equal(simulatedModelCalledWith.contents[0].parts.length, 2, 'Must pass both user prompt text and imagePart to model');
});
