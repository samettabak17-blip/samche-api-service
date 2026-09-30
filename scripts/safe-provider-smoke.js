import { createGoogleGeminiProvider, getGoogleGeminiConfig } from '../services/google-gemini-provider.js';

async function runSafeProviderSmoke() {
  try {
    const config = getGoogleGeminiConfig();
    const provider = createGoogleGeminiProvider();
    const metadata = provider.runtimeMetadata();

    const response = await provider.generateContent({
      model: metadata.model,
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    });

    const responseText = (
      response?.structured_text ||
      response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      response?.text ||
      ''
    ).trim();

    const providerSuccess = Boolean(responseText.length > 0);
    const responseNonEmpty = Boolean(responseText.length > 0);

    console.log(`mode=${metadata.mode}`);
    console.log(`project=${config.project || 'none'}`);
    console.log(`location=${config.location || 'none'}`);
    console.log(`model=${metadata.model}`);
    console.log(`providerSuccess=${providerSuccess}`);
    console.log(`responseNonEmpty=${responseNonEmpty}`);
    console.log(`fallbackUsed=false`);
  } catch (err) {
    console.error(`SMOKE_FAILED code=${err?.code || 'UNKNOWN'} message=${err?.message}`);
    console.log(`providerSuccess=false`);
    console.log(`responseNonEmpty=false`);
    console.log(`fallbackUsed=true`);
    process.exit(1);
  }
}

runSafeProviderSmoke();
