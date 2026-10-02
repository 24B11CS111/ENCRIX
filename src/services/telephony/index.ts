import { TelephonyProvider } from '@/types';
import { MockTelephonyProvider } from './mockProvider';
import { TwilioTelephonyProvider } from './twilioProvider';
import { callService, CallService } from './callService';
import { webhookHandler, TelephonyWebhookHandler } from './webhookHandler';

export * from './provider';
export { MockTelephonyProvider } from './mockProvider';
export { TwilioTelephonyProvider } from './twilioProvider';
export { callService, CallService } from './callService';
export { webhookHandler, TelephonyWebhookHandler } from './webhookHandler';

// Export default singleton telephonyService maintaining backwards-compatibility
export const telephonyService: TelephonyProvider = callService.getProvider() as unknown as TelephonyProvider;
