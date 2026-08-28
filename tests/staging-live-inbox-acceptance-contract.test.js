import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptPath = new URL('../scripts/acceptance_live_inbox.js', import.meta.url);

test('live inbox acceptance follows the signed Samcheguide session contract', async () => {
  const script = await readFile(scriptPath, 'utf8');

  assert.doesNotMatch(script, /'x-user-id'/);
  assert.match(script, /initial\.data\?\.conversation_session/);
  assert.match(script, /'X-Samcheguide-Session': publicSessionToken/);
  assert.match(script, /publicSessionId = JSON\.parse\(Buffer\.from\(publicSessionToken\.split\('\.'\)\[0\], 'base64url'\)\.toString\('utf8'\)\)\.sid/);
  assert.match(script, /conversationKey\(publicSessionId\)/);
  assert.match(script, /publicHistory\.data\?\.messages/);
});
