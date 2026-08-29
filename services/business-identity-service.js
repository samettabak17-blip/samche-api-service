const CORPORATE_SUFFIXES = new Set(['llc', 'ltd', 'limited', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'co']);

export function normalizeBusinessIdentity(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\bl\s*\.\s*l\s*\.\s*c\s*\.?\b/g, ' llc ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part && !CORPORATE_SUFFIXES.has(part))
    .join(' ');
}

function redactSafeEvidence(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[REDACTED_PHONE]')
    .replace(/\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+/gi, '[REDACTED_CREDENTIAL]')
    .trim()
    .slice(0, 1000);
}

export function summarizeBusinessIdentityEvidence(evidenceItems) {
  const evidence = evidenceItems.map((item) => {
    const detectedIdentity = String(item.detected_identity ?? '').trim().slice(0, 255);
    const normalizedIdentity = item.normalized_identity ?? normalizeBusinessIdentity(detectedIdentity);
    const confidence = Number(item.confidence);
    return {
      source_id: item.source_id,
      source_title: item.source_title,
      content_hash: item.content_hash ?? null,
      detected_identity: detectedIdentity || 'unknown',
      normalized_identity: normalizedIdentity || null,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      safe_evidence: redactSafeEvidence(item.safe_evidence ?? item.evidence),
    };
  });
  const identities = [];
  for (const item of evidence.filter((entry) => entry.normalized_identity && entry.confidence >= 0.7)) {
    let identity = identities.find((entry) => entry.normalized_identity === item.normalized_identity);
    if (!identity) {
      identity = { detected_identity: item.detected_identity, normalized_identity: item.normalized_identity, source_ids: [] };
      identities.push(identity);
    }
    identity.source_ids.push(item.source_id);
  }
  const everySourceResolved = evidence.length > 0 && evidence.every((entry) => entry.normalized_identity && entry.confidence >= 0.7);
  return { status: everySourceResolved && identities.length === 1 ? 'RESOLVED' : 'IDENTITY_RESOLUTION_REQUIRED', identities, evidence };
}

export async function analyzeBusinessIdentityScope({ provider, sources }) {
  const evidence = [];
  for (const source of sources) {
    const analysis = await provider.generateBusinessIdentityAnalysis({ source });
    evidence.push({
      source_id: source.id,
      source_title: source.title,
      content_hash: source.content_hash ?? null,
      detected_identity: analysis.detected_identity,
      confidence: analysis.confidence,
      evidence: analysis.evidence,
    });
  }
  return summarizeBusinessIdentityEvidence(evidence);
}
