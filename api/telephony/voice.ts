import {
  getTwilioServerConfig,
  getTwilioWebhookSignatureUrl,
  verifyTwilioSignature,
} from '../_lib/twilioServer.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const config = getTwilioServerConfig();
  const signature = (req.headers?.['x-twilio-signature'] || '') as string;
  const signatureUrl = getTwilioWebhookSignatureUrl(config.voiceWebhookUrl, req.url || '/');
  const params: Record<string, string> = {};
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') params[key] = value;
    }
  }

  if (!signatureUrl || !verifyTwilioSignature(config.authToken, signature, signatureUrl, params)) {
    return res.status(401).send('Unauthorized');
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">ENCRIX secure calling is temporarily unavailable.</Say>
  <Hangup />
</Response>`.trim();

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml);
}
