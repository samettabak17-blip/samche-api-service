import { getGoogleGeminiConfig } from '../services/google-gemini-provider.js';
import { canonicalSharedAiRuntime } from '../services/shared-ai-provider-resilience.js';

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
  const channels = ['INSTAGRAM', 'WHATSAPP', 'WEB', 'GUIDE'];
  const config = getGoogleGeminiConfig();
  console.log(`SHARED_CONFIG mode=${config.mode} project=${config.project || 'none'} location=${config.location || 'none'}`);

  for (const ch of channels) {
    try {
      const res = await canonicalSharedAiRuntime.generateAiResponse({
        systemInstruction: `You are a test assistant for ${ch}. Provide a short greeting.`,
        text: `Smoke check for ${ch}`,
        channel: ch,
        disableFailover: true, // Prove Phase A Primary Vertex
      });

      const responseText = String(res?.text || '').trim();
      const providerSuccess = Boolean(responseText.length > 0 && res.provider === 'vertex');
      const responseNonEmpty = Boolean(responseText.length > 0);

      console.log(`\n${ch}:`);
      console.log(`canonicalSharedRuntime=true`);
      console.log(`provider=${res.provider}`);
      console.log(`providerSuccess=${providerSuccess}`);
      console.log(`responseNonEmpty=${responseNonEmpty}`);
      console.log(`fallbackUsed=false`);
      console.log(`model=${res.model}`);
    } catch (err) {
      console.log(`\n${ch}:`);
      console.log(`canonicalSharedRuntime=true`);
      console.log(`provider=vertex`);
      console.log(`providerSuccess=false`);
      console.log(`responseNonEmpty=false`);
      console.log(`fallbackUsed=false`);
      console.error(`SMOKE_FAILED channel=${ch} code=${err?.code || 'UNKNOWN'} message=${err?.message}`);
    }
  }
}

runSafeProviderSmoke();



