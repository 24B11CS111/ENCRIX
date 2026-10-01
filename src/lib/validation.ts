import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  ownerName: z.string().min(2, 'Full name is required'),
  email: z.string().email('Please enter a valid work email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().min(10, 'Valid phone number is required'),
  industry: z.string().default('Education Consultancy'),
  companySize: z.string().default('1-10'),
});

export type RegisterFormData = z.infer<typeof registerSchema>;

export const leadSchema = z.object({
  name: z.string().min(2, 'Lead name is required'),
  phone: z.string().refine(
    (val) => {
      const digits = val.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15;
    },
    { message: 'Valid phone number with 7 to 15 digits is required' }
  ),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  source: z.string().default('Website'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  notes: z.string().optional(),
  assigned_to: z.string().optional().nullable(),
});

export type LeadFormData = z.infer<typeof leadSchema>;

export const positiveOutcomeSchema = z.object({
  outcome: z.literal('POSITIVE'),
  interestLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  requirement: z.string().min(2, 'Requirement summary is required'),
  notes: z.string().min(3, 'Notes are required for positive interactions'),
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
  notes: z.string().min(2, 'Please specify call notes'),
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
  notes: z.string().optional(),
  followUpDate: z.string().optional(),
  followUpTime: z.string().optional(),
});
