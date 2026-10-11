// Cloudflare Workers KV'yi çekirdeğin beklediği Depo arayüzüne uyarlar. Her depo bir önek altında
// ("koleksiyonlar/", "tadim-geceleri/", "kulupler/") tek KV ad alanını paylaşır.
import type { Depo } from "./ortak.ts";

export function kvDepo(kv: any, onek: string): Depo {
  return {
    async get(key: string, opt?: { type?: "json" | "text" }) {
      return kv.get(onek + key, opt?.type === "json" ? "json" : "text");
    },
    async setJSON(key: string, value: any, opt?: { ttl?: number; meta?: Record<string, unknown> }) {
      const ek: Record<string, unknown> = {};
      if (opt?.ttl) ek.expirationTtl = opt.ttl;
      if (opt?.meta) ek.metadata = opt.meta;
      await kv.put(onek + key, JSON.stringify(value), ek);
    },
    async delete(key: string) {
      await kv.delete(onek + key);
    },
    async list(opt?: { prefix?: string }) {
      const blobs: { key: string; meta?: any }[] = [];
      let cursor: string | undefined;
      do {
        const r: any = await kv.list({ prefix: onek + (opt?.prefix || ""), cursor });
        for (const k of r.keys) blobs.push({ key: k.name.slice(onek.length), ...(k.metadata ? { meta: k.metadata } : {}) });
        cursor = r.list_complete ? undefined : r.cursor;
      } while (cursor);
      return { blobs };
    },
  };
}
