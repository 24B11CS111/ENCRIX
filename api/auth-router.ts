import invitationsHandler from './_lib/authHandlers/invitations.js';
import inviteHandler from './_lib/authHandlers/invite.js';
import phoneEnrollmentHandler from './_lib/authHandlers/phone-enrollment.js';
import sendOtpHandler from './_lib/authHandlers/send-otp.js';
import sessionHandler from './_lib/authHandlers/session.js';
import teamHandler from './_lib/authHandlers/team.js';
import verifyOtpHandler from './_lib/authHandlers/verify-otp.js';

const AUTH_ACTIONS = {
  invitations: invitationsHandler,
  invite: inviteHandler,
  'phone-enrollment': phoneEnrollmentHandler,
  'send-otp': sendOtpHandler,
  session: sessionHandler,
  team: teamHandler,
  'verify-otp': verifyOtpHandler,
} as const;

type AuthAction = keyof typeof AUTH_ACTIONS;

function resolveAuthAction(value: unknown): AuthAction | null {
  if (typeof value !== 'string') return null;

  return Object.prototype.hasOwnProperty.call(AUTH_ACTIONS, value)
    ? value as AuthAction
    : null;
}

export default async function handler(req: any, res: any) {
  const action = resolveAuthAction(req.query?._route);

  if (!action) {
    return res.status(404).json({ error: 'Not Found' });
  }

  return AUTH_ACTIONS[action](req, res);
}
