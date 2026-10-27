import { defaultKeyHasher } from "@better-auth/api-key";
import type { SecondaryStorage } from "@better-auth/core/db";

import type { ApiKeyVerification } from "@codice/contracts";

/**
 * API keys live only in the `API_KEYS` KV namespace (Better Auth's api-key plugin with
 * `storage: "secondary-storage"`): the plugin writes them there, hashed, and `verifyApiKey` reads
 * them on every `codice-api` call without touching D1. The record layout is the plugin's
 * (`api-key:<sha256 base64url>`); `test/auth.test.ts` creates a key through the plugin and
 * verifies it here, so an upgrade that changes it fails the tests.
 */

/**
 * Better Auth's `SecondaryStorage` over KV, which refuses an expiry under 60 seconds. KV has no
 * atomic read-and-write, so `getAndDelete` and `increment` are not atomic; the api-key plugin,
 * the only user, calls neither.
 */
export function kvStorage(kv: KVNamespace): SecondaryStorage {
  const put = (key: string, value: string, ttl?: number) =>
    kv.put(key, value, ttl ? { expirationTtl: Math.max(ttl, 60) } : undefined);
  return {
    get: (key) => kv.get(key),
    set: put,
    delete: (key) => kv.delete(key),
    async getAndDelete(key) {
      const value = await kv.get(key);
      if (value !== null) await kv.delete(key);
      return value;
    },
    async increment(key, ttl) {
      const next = Number((await kv.get(key)) ?? 0) + 1;
      await put(key, String(next), ttl);
      return next;
    },
  };
}

/** Every Códice key starts with it; anything else is refused before a lookup. */
export const API_KEY_PREFIX = "cdc_";

/** The fields of the plugin's stored record that a verification reads. */
interface StoredApiKey {
  id: string;
  referenceId: string;
  enabled?: boolean;
  expiresAt?: string | null;
}

const INVALID: ApiKeyVerification = { valid: false };
const LAST_USED_PREFIX = "codice:last-used:";
/** How often one isolate refreshes a key's last use: KV takes one write a second per key. */
const LAST_USED_INTERVAL_MS = 60_000;
const lastUseWrites = new Map<string, number>();

export async function verifyApiKey(
  kv: KVNamespace,
  key: unknown,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<ApiKeyVerification> {
  if (typeof key !== "string" || !key.startsWith(API_KEY_PREFIX) || key.length > 256)
    return INVALID;
  const stored = await kv.get<StoredApiKey>(`api-key:${await defaultKeyHasher(key)}`, "json");
  if (!stored?.id || !stored.referenceId || stored.enabled === false) return INVALID;
  if (stored.expiresAt && Date.parse(stored.expiresAt) <= Date.now()) return INVALID;
  waitUntil(recordUse(kv, stored.id));
  return { valid: true, keyId: stored.id, organizationId: stored.referenceId };
}

// Its own KV entry, never the key record: a late write to the record could restore a revoked key.
async function recordUse(kv: KVNamespace, keyId: string) {
  const now = Date.now();
  if (now - (lastUseWrites.get(keyId) ?? 0) < LAST_USED_INTERVAL_MS) return;
  lastUseWrites.set(keyId, now);
  try {
    await kv.put(`${LAST_USED_PREFIX}${keyId}`, new Date(now).toISOString());
  } catch {
    // A refused write (KV's per-key rate) only leaves the last use a minute stale.
  }
}

/** When each key was last used, to the minute; `null` for a key never used. */
export async function lastUsed(kv: KVNamespace, keyIds: string[]) {
  const entries = await Promise.all(
    keyIds.map(async (id) => [id, await kv.get(`${LAST_USED_PREFIX}${id}`)] as const),
  );
  return Object.fromEntries(entries);
}

export function forgetLastUse(kv: KVNamespace, keyId: string) {
  return kv.delete(`${LAST_USED_PREFIX}${keyId}`);
}
