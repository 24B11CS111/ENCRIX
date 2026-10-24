import type { TelephonyProvider } from '@/types';
import { callService, CallService } from './callService';

export * from './provider';
export { MockTelephonyProvider } from './mockProvider';
export { callService, CallService } from './callService';
export { recordingService, RecordingService } from './recordingService';

// Export default singleton telephonyService maintaining backwards-compatibility
export const telephonyService: TelephonyProvider = callService.getProvider() as unknown as TelephonyProvider;
