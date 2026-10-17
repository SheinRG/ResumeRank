import type { BlobStore } from "../src/storage/blob";

export function memoryBlobStore(): BlobStore & { readonly blobs: Map<string, Uint8Array> } {
  const blobs = new Map<string, Uint8Array>();
  return {
    blobs,
    async put(key, bytes) {
      if (blobs.has(key)) throw new Error(`Blob ${key} already exists`);
      blobs.set(key, bytes);
    },
    async get(key) {
      return blobs.get(key) ?? null;
    },
    async delete(keys) {
      for (const key of keys) blobs.delete(key);
    },
  };
}
