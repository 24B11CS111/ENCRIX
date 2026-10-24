export const LEAD_ACTIONS = [
  'detail',
  'distribute',
  'distribution-config',
  'telecaller-list',
  'telecaller-update',
] as const;
export type LeadAction = (typeof LEAD_ACTIONS)[number];

export function resolveLeadAction(value: unknown): LeadAction | null {
  return typeof value === 'string' && LEAD_ACTIONS.includes(value as LeadAction)
    ? value as LeadAction
    : null;
}
