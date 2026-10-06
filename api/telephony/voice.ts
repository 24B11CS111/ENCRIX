import { getTwilioServerConfig } from '../_lib/twilioServer';

export default async function handler(req: any, res: any) {
  const config = getTwilioServerConfig();
  const callerId = req.query?.callerId || config.callerId;
  const destination = req.query?.destination || req.body?.destination || '';

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">This call is being placed via ENCRIX secure gateway and recorded for quality and compliance purposes.</Say>
  ${
    destination
      ? `<Dial callerId="${callerId}" record="record-from-answer-dual" recordingStatusCallback="${config.statusCallbackUrl}">
    <Number>${destination}</Number>
  </Dial>`
      : ''
  }
</Response>`.trim();

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml);
}
