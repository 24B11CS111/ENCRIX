import { escapeHtml } from './emailHtml.js';

export interface InvitationEmailInput {
  recipient: string;
  inviteUrl: string;
  recipientName: string;
  organizationName: string;
  expiresAt: string;
}

export interface FollowUpReminderEmailInput {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

export async function sendFollowUpReminderEmail(input: FollowUpReminderEmailInput): Promise<{ id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || /placeholder|your-|test/i.test(apiKey) || !sender || !sender.includes('@')) {
    const error = new Error('Reminder email delivery is not configured.') as Error & { code: string };
    error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `encrix-reminder-${input.idempotencyKey}`,
      },
      body: JSON.stringify({
        from: sender.includes('<') ? sender : `ENCRIX <${sender}>`,
        to: [input.recipient],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
  } catch {
    const error = new Error('Reminder email provider request failed.') as Error & { code: string };
    error.code = 'EMAIL_PROVIDER_UNAVAILABLE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error('Reminder email provider rejected the request.') as Error & { code: string };
    error.code = response.status === 429 ? 'EMAIL_PROVIDER_RATE_LIMITED' : 'EMAIL_PROVIDER_REJECTED';
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  return { id: typeof result?.id === 'string' ? result.id : undefined };
}

/** Send an invitation only through the configured Resend account. Errors are
 * deliberately sanitized: provider response text can contain recipient data. */
export async function sendInvitationEmail(input: InvitationEmailInput): Promise<{ id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || /placeholder|your-/i.test(apiKey)) {
    const error = new Error('Email delivery is not configured.') as Error & { code: string };
    error.code = 'EMAIL_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const sender = process.env.RESEND_FROM_EMAIL;
  if (!sender || !sender.includes('@')) {
    const error = new Error('Email sender is not configured.') as Error & { code: string };
    error.code = 'EMAIL_SENDER_NOT_CONFIGURED';
    throw error;
  }

  const recipientName = escapeHtml(input.recipientName);
  const organizationName = escapeHtml(input.organizationName);
  const inviteUrl = escapeHtml(input.inviteUrl);
  const expiry = escapeHtml(new Date(input.expiresAt).toUTCString());
  const from = sender.includes('<') ? sender : `ENCRIX <${sender}>`;
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [input.recipient],
        subject: `Invitation to join ${input.organizationName} on ENCRIX`,
        text: `Hello ${input.recipientName},\n\nYou have been invited to join ${input.organizationName} as a telecaller. Accept the invitation using this secure link: ${input.inviteUrl}\n\nThis link expires ${new Date(input.expiresAt).toUTCString()} and can be used once. If you were not expecting this invitation, ignore this email.`,
        html: `<p>Hello ${recipientName},</p><p>You have been invited to join <strong>${organizationName}</strong> as a telecaller.</p><p><a href="${inviteUrl}">Accept your invitation</a></p><p>This link expires ${expiry} and can be used once. If you were not expecting this invitation, ignore this email.</p>`,
      }),
    });
  } catch {
    const error = new Error('Email provider request failed.') as Error & { code: string };
    error.code = 'EMAIL_PROVIDER_UNAVAILABLE';
    throw error;
  }

  if (!response.ok) {
    const error = new Error('Email provider rejected the invitation.') as Error & { code: string; status?: number };
    error.code = response.status === 429 ? 'EMAIL_PROVIDER_RATE_LIMITED' : 'EMAIL_PROVIDER_REJECTED';
    error.status = response.status;
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  return { id: typeof result?.id === 'string' ? result.id : undefined };
}
