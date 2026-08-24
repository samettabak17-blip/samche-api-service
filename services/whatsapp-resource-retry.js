export const WHATSAPP_RESOURCE_RETRY_ATTEMPTS = 3;
export const WHATSAPP_RESOURCE_RETRY_DELAY_MS = 400;

export async function waitForReadyResource({
  read,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = WHATSAPP_RESOURCE_RETRY_ATTEMPTS,
  delayMs = WHATSAPP_RESOURCE_RETRY_DELAY_MS,
}) {
  let resource = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    resource = await read();
    if (!resource || resource.processing_status !== 'PROCESSING') {
      return { status: resource?.processing_status ?? 'MISSING', resource, attempts: attempt };
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return { status: 'PROCESSING', resource, attempts };
}

