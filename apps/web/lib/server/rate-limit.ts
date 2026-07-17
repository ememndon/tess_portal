import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { getRedis, getLogger } from "./health";

/**
 * Login rate limiting per IP and per account. Redis-backed, with an
 * in-memory insurance limiter as a fallback. Limits are deliberately tight
 * because this platform has a handful of users.
 *
 * Redis is a SOFT dependency here. If it is unreachable, the limiters fall
 * back to a per-process in-memory counter (`insuranceLimiter`), and if even
 * that path errors, `allowAttempt` fails OPEN. A Redis blip (e.g. a routine
 * `docker compose up -d`) must never be able to lock every user out of login.
 */

const g = globalThis as unknown as {
  __tpRlIp?: RateLimiterRedis;
  __tpRlAccount?: RateLimiterRedis;
};

// Per-process fallbacks used automatically when Redis is not "ready".
const ipInsurance = new RateLimiterMemory({
  keyPrefix: "rl:ip:mem",
  points: 15,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});
const accountInsurance = new RateLimiterMemory({
  keyPrefix: "rl:acct:mem",
  points: 8,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

function ipLimiter() {
  g.__tpRlIp ??= new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: "rl:ip",
    points: 15,
    duration: 15 * 60,
    blockDuration: 15 * 60,
    insuranceLimiter: ipInsurance,
    // Route to the in-memory limiter immediately when Redis is down instead
    // of waiting for command retries to time out.
    rejectIfRedisNotReady: true,
  });
  return g.__tpRlIp;
}

function accountLimiter() {
  g.__tpRlAccount ??= new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: "rl:acct",
    points: 8,
    duration: 15 * 60,
    blockDuration: 15 * 60,
    insuranceLimiter: accountInsurance,
    rejectIfRedisNotReady: true,
  });
  return g.__tpRlAccount;
}

/** Returns true when the attempt may proceed. */
export async function allowAttempt(ip: string, account?: string): Promise<boolean> {
  try {
    await ipLimiter().consume(ip);
    if (account) await accountLimiter().consume(account.toLowerCase());
    return true;
  } catch (err) {
    // A RateLimiterRes rejection means the caller genuinely exceeded the
    // limit (via Redis or the in-memory fallback) — deny it. Anything else is
    // an infrastructure fault (Redis unreachable past the fallback); fail
    // OPEN so a Redis outage can never lock users out of login.
    if (err instanceof RateLimiterRes) return false;
    getLogger().error(
      { err: (err as Error)?.message },
      "rate limiter unavailable; allowing attempt",
    );
    return true;
  }
}

/** Clears the per-account counter after a successful login. */
export async function clearAccount(account: string) {
  try {
    await accountLimiter().delete(account.toLowerCase());
  } catch {
    // best effort
  }
}
