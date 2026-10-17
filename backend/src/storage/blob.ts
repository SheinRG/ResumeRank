import { del, get, put } from "@vercel/blob";

import { env } from "../env";

/**
 * The few blob operations the app needs. Services take a store as an
 * argument, so tests run against memory and production against Vercel Blob.
 */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Null when no blob has that key. */
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: string[]): Promise<void>;
}

/** A private store: blobs are reachable only with the read-write token, never by URL. */
export function vercelBlobStore(token: string): BlobStore {
  return {
    async put(key, bytes, contentType) {
      await put(key, Buffer.from(bytes), {
        access: "private",
        contentType,
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    },
    async get(key) {
      const result = await get(key, { access: "private", token, useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async delete(keys) {
      if (keys.length > 0) await del(keys, { token });
    },
  };
}

/** The deployment's store, or null when uploads are off (no token configured). */
export function configuredBlobStore(): BlobStore | null {
  const token = env().BLOB_READ_WRITE_TOKEN;
  return token ? vercelBlobStore(token) : null;
}
