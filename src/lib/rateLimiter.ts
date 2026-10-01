/**
 * LEADVAULT CRM - Client & In-Memory Rate Limiter
 * Protects against credential stuffing, brute force, API scraping, and call spam.
 */

interface RateLimitRecord {
  timestamps: number[];
}

class InMemoryRateLimiter {
  private records: Map<string, RateLimitRecord> = new Map();

  /**
   * Check if an action is allowed within the given window
   * @param key Unique key (e.g. `login:${ipOrEmail}`, `call:${telecallerId}`)
   * @param maxRequests Maximum allowed requests within window
   * @param windowMs Time window in milliseconds
   */
  public check(
    key: string,
    maxRequests: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const record = this.records.get(key) || { timestamps: [] };

    // Clean up timestamps older than window
    const validTimestamps = record.timestamps.filter((ts) => now - ts < windowMs);

    if (validTimestamps.length >= maxRequests) {
      const oldest = validTimestamps[0];
      const resetMs = Math.max(0, windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    validTimestamps.push(now);
    this.records.set(key, { timestamps: validTimestamps });

    return {
      allowed: true,
      remaining: maxRequests - validTimestamps.length,
      resetMs: windowMs,
    };
  }

  /**
   * Reset limits for a specific key (e.g. after successful login)
   */
  public reset(key: string): void {
    this.records.delete(key);
  }

  /**
   * Clear all stored rate limit records
   */
  public clear(): void {
    this.records.clear();
  }
}

export const rateLimiter = new InMemoryRateLimiter();
