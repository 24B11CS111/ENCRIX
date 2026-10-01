import { z } from 'zod';

/**
 * CSV / Spreadsheet Formula Injection Sanitizer (OWASP CWE-1236)
 * Neutralizes formulas starting with '=', '+', '-', '@', '\t', '\r'.
 * Prepends a single quote to force spreadsheet programs to parse as literal text.
 */
export function sanitizeFormulaInjection(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  if (dangerousPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return `'${trimmed}`;
  }
  return value;
}

/**
 * General HTML/Script sanitizer for user text inputs
 */
export function sanitizeText(value: string): string {
  if (!value) return value;
  return sanitizeFormulaInjection(
    value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim()
  );
}

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name is required').max(100).transform(sanitizeText),
  ownerName: z.string().min(2, 'Full name is required').max(100).transform(sanitizeText),
  email: z.string().email('Please enter a valid work email').max(150),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().min(10, 'Valid phone number is required').max(20),
  industry: z.string().default('Education Consultancy').transform(sanitizeText),
  companySize: z.string().default('1-10'),
});

export type RegisterFormData = z.infer<typeof registerSchema>;

export const leadSchema = z.object({
  name: z.string().min(2, 'Lead name is required').max(100).transform(sanitizeText),
  phone: z.string().refine(
    (val) => {
      const digits = val.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    },
    { message: 'Valid phone number with 7 to 15 digits is required' }
  ),
  email: z.string().email('Invalid email address').max(150).optional().or(z.literal('')),
  source: z.string().max(50).default('Website').transform(sanitizeText),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  notes: z.string().max(2000).optional().transform((val) => (val ? sanitizeText(val) : val)),
  assigned_to: z.string().optional().nullable(),
});

export type LeadFormData = z.infer<typeof leadSchema>;

export const positiveOutcomeSchema = z.object({
  outcome: z.literal('POSITIVE'),
  interestLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  requirement: z.string().min(2, 'Requirement summary is required').max(255).transform(sanitizeText),
  notes: z.string().min(3, 'Notes are required for positive interactions').max(2000).transform(sanitizeText),
  followUpDate: z.string().min(1, 'Follow-up date is required'),
  followUpTime: z.string().min(1, 'Follow-up time is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('HIGH'),
});

export const negativeOutcomeSchema = z.object({
  outcome: z.literal('NEGATIVE'),
  reason: z.enum([
    'Not Interested',
    'Price',
    'Competitor',
    'Already Purchased',
    'Not Eligible',
    'Wrong Requirement',
    'Other',
  ]),
  notes: z.string().min(2, 'Please specify call notes').max(2000).transform(sanitizeText),
});

export const quickOutcomeSchema = z.object({
  outcome: z.enum([
    'NO_ANSWER',
    'BUSY',
    'CALL_BACK',
    'WRONG_NUMBER',
    'DO_NOT_CONTACT',
    'CONVERTED',
    'FOLLOW_UP',
  ]),
  notes: z.string().max(2000).optional().transform((val) => (val ? sanitizeText(val) : val)),
  followUpDate: z.string().optional(),
  followUpTime: z.string().optional(),
});
