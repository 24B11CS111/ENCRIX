const MAX_BILLING_BODY_BYTES = 1024 * 1024;

function enforceBillingBodyLimit(body: Buffer): Buffer {
  if (body.length > MAX_BILLING_BODY_BYTES) throw new Error('billing_payload_too_large');
  return body;
}

export async function readRawBillingBody(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req.rawBody)) return enforceBillingBodyLimit(req.rawBody);
  if (typeof req.rawBody === 'string') return enforceBillingBodyLimit(Buffer.from(req.rawBody, 'utf8'));
  if (Buffer.isBuffer(req.body)) return enforceBillingBodyLimit(req.body);
  if (typeof req.body === 'string') return enforceBillingBodyLimit(Buffer.from(req.body, 'utf8'));

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BILLING_BODY_BYTES) throw new Error('billing_payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function parseBillingJsonObject(req: any): Promise<Record<string, unknown> | null> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Array.isArray(req.body) ? null : req.body;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBillingBody(req);
  } catch {
    return null;
  }
  if (rawBody.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
