import { createGoogleGeminiProvider, getGoogleGeminiConfig } from '../services/google-gemini-provider.js';

if (!process.env.GOOGLE_GENAI_MODE && (process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS || true)) {
  process.env.GOOGLE_GENAI_MODE = 'vertex';
}
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  process.env.GOOGLE_CLOUD_PROJECT = 'samche-ai-development-2';
}
if (!process.env.GOOGLE_CLOUD_LOCATION) {
  process.env.GOOGLE_CLOUD_LOCATION = 'global';
}
if (!process.env.GOOGLE_GEMINI_RUNTIME_MODEL) {
  process.env.GOOGLE_GEMINI_RUNTIME_MODEL = 'gemini-3.7-flash';
}

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


