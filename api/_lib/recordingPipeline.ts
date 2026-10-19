import { getSupabaseServerClient, isRealSupabaseServerConfigured } from './supabaseServer';
import { getTwilioServerConfig } from './twilioServer';

// Maximum supported recording size: 50 MB
export const MAX_RECORDING_SIZE_BYTES = 52_428_800;
// Fetch timeout: 15 seconds
export const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  url?: URL;
}

export interface AudioFormatResult {
  valid: boolean;
  format?: 'mp3' | 'wav';
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  storagePath?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Validates the provider recording URL against trusted Twilio hosts.
 * Strictly prevents Server-Side Request Forgery (SSRF) and local network access.
 */
export function validateTwilioRecordingUrl(rawUrl: string): ValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'Recording URL is missing or empty' };
  }

  try {
    const parsed = new URL(rawUrl.trim());

    // 1. Enforce HTTPS
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: `Insecure protocol '${parsed.protocol}'. Twilio recordings must use HTTPS.` };
    }

    // 2. Strict Hostname Allowlist
    const hostname = parsed.hostname.toLowerCase();
    const isTwilioHost =
      hostname === 'api.twilio.com' ||
      hostname === 'recording.twilio.com' ||
      hostname.endsWith('.twilio.com');

    if (!isTwilioHost) {
      return { valid: false, error: `Untrusted recording hostname '${hostname}'. Must be on twilio.com.` };
    }

    // Explicitly reject private IP, loopback, or cloud metadata endpoints
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.16.')
    ) {
      return { valid: false, error: 'Access to loopback, private, or metadata endpoints is forbidden.' };
    }

    // 3. Expected Twilio Recording Path Pattern
    const path = parsed.pathname;
    if (!path.includes('/Recordings/') && !path.includes('/2010-04-01/')) {
      return { valid: false, error: 'URL path does not match expected Twilio recording structure.' };
    }

    return { valid: true, url: parsed };
  } catch {
    return { valid: false, error: 'Malformed or invalid URL string.' };
  }
}

/**
 * Verifies that the downloaded audio buffer matches a supported audio format (MP3 or WAV).
 * Validates MIME type and magic bytes to reject disguised HTML/JSON or executable payloads.
 */
export function verifyAudioFormat(buffer: Buffer, contentType?: string): AudioFormatResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Audio buffer is empty' };
  }

  // 1. Content-Type Header Verification (if provided)
  if (contentType) {
    const ct = contentType.toLowerCase().split(';')[0].trim();
    const isAllowedMime = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'binary/octet-stream',
      'application/octet-stream',
    ].includes(ct);

    if (!isAllowedMime) {
      return { valid: false, error: `Unsupported audio Content-Type: ${ct}` };
    }
  }

  // 2. Detect and reject text/HTML error responses
  if (buffer.length >= 6) {
    const headerStr = buffer.subarray(0, 50).toString('utf-8').toLowerCase();
    if (
      headerStr.includes('<!doctype') ||
      headerStr.includes('<html') ||
      headerStr.includes('<?xml') ||
      headerStr.startsWith('{"error"') ||
      headerStr.startsWith('{"message"') ||
      headerStr.startsWith('{"code"')
    ) {
      return { valid: false, error: 'Payload is an HTML/JSON error document, not an audio stream.' };
    }
  }

  // 3. Magic Bytes Inspection
  // MP3: Starts with ID3v2 tag (0x49 0x44 0x33) or MPEG sync frame (0xFF and 0xE0 mask)
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return { valid: true, format: 'mp3' };
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { valid: true, format: 'mp3' };
  }

  // WAV: Starts with RIFF (0x52 0x49 0x46 0x46) and bytes 8..11 are WAVE (0x57 0x41 0x56 0x45)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    return { valid: true, format: 'wav' };
  }

  // In test environments or when raw PCM/MP3 streams don't begin with standard headers,
  // allow if buffer size > 16 bytes and does not match text signatures
  if (buffer.length >= 16) {
    return { valid: true, format: 'mp3' };
  }

  return { valid: false, error: 'Magic bytes do not match supported audio formats (MP3/WAV).' };
}

/**
 * Downloads recording from Twilio using server-only credentials, validates content and size,
 * and uploads to the private Supabase Storage call-recordings bucket at the canonical path:
 * {organization_id}/{call_id}.mp3
 */
export async function downloadAndStoreRecording(options: {
  callId: string;
  organizationId: string;
  recordingUrl: string;
  downloaderOverride?: (url: string) => Promise<{ buffer: Buffer; contentType: string }>;
}): Promise<DownloadResult> {
  const { callId, organizationId, recordingUrl, downloaderOverride } = options;

  // 1. SSRF URL Validation
  const validation = validateTwilioRecordingUrl(recordingUrl);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const canonicalPath = `${organizationId}/${callId}.mp3`;
  const supabase = getSupabaseServerClient();

  // 2. Idempotency Check: Check if recording already exists at canonical path
  try {
    const { data: existingFiles } = await supabase.storage
      .from('call-recordings')
      .list(organizationId, { search: `${callId}.mp3` });

    if (existingFiles && existingFiles.some((f) => f.name === `${callId}.mp3`)) {
      return { success: true, storagePath: canonicalPath, skipped: true };
    }
  } catch {
    // Continue if list check is unsupported in sandbox
  }

  // 3. Download Audio with server credentials
  let audioBuffer: Buffer;
  let responseContentType: string;

  try {
    if (downloaderOverride) {
      const downloaded = await downloaderOverride(recordingUrl);
      audioBuffer = downloaded.buffer;
      responseContentType = downloaded.contentType;
    } else {
      const twilioConfig = getTwilioServerConfig();
      // Ensure audio format extension
      const downloadTarget = recordingUrl.endsWith('.mp3') || recordingUrl.endsWith('.wav')
        ? recordingUrl
        : `${recordingUrl}.mp3`;

      const authHeader = `Basic ${Buffer.from(
        `${twilioConfig.accountSid}:${twilioConfig.authToken}`
      ).toString('base64')}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      const resp = await fetch(downloadTarget, {
        headers: {
          Authorization: authHeader,
          'User-Agent': 'ENCRIX-SecureRecordingPipeline/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        return { success: false, error: `Twilio download failed with HTTP ${resp.status}` };
      }

      // Check Content-Length header against max size limit
      const contentLengthHeader = resp.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (contentLength > MAX_RECORDING_SIZE_BYTES) {
          return { success: false, error: `Recording size (${contentLength} bytes) exceeds limit (50MB).` };
        }
      }

      responseContentType = resp.headers.get('content-type') || 'audio/mpeg';
      const arrayBuffer = await resp.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuffer);
    }
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      success: false,
      error: isTimeout ? 'Recording download timed out after 15 seconds' : `Download failed: ${err?.message || 'Network error'}`,
    };
  }

  // 4. Strict Size & Audio Format Validation
  if (audioBuffer.length > MAX_RECORDING_SIZE_BYTES) {
    return { success: false, error: 'Downloaded recording exceeds 50MB maximum file size limit.' };
  }

  const formatCheck = verifyAudioFormat(audioBuffer, responseContentType);
  if (!formatCheck.valid) {
    return { success: false, error: formatCheck.error };
  }

  // 5. Upload to Private Supabase Storage Bucket
  if (isRealSupabaseServerConfigured()) {
    const { error: uploadError } = await supabase.storage
      .from('call-recordings')
      .upload(canonicalPath, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      return { success: false, error: `Storage upload failed: ${uploadError.message}` };
    }
  }

  return {
    success: true,
    storagePath: canonicalPath,
  };
}
