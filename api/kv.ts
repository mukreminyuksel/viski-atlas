// Cloudflare Workers KV'yi çekirdeğin beklediği Depo arayüzüne uyarlar. Her depo bir önek altında
// ("koleksiyonlar/", "tadim-geceleri/", "kulupler/") tek KV ad alanını paylaşır.
import type { Depo } from "./ortak.ts";

export function kvDepo(kv: any, onek: string): Depo {
  return {
    async get(key: string, opt?: { type?: "json" | "text" }) {
      return kv.get(onek + key, opt?.type === "json" ? "json" : "text");
    },
    async setJSON(key: string, value: any) {
      await kv.put(onek + key, JSON.stringify(value));
    },
    async delete(key: string) {
      await kv.delete(onek + key);
    },
    async list(opt?: { prefix?: string }) {
      const blobs: { key: string }[] = [];
      let cursor: string | undefined;
      do {
        const r: any = await kv.list({ prefix: onek + (opt?.prefix || ""), cursor });
        for (const k of r.keys) blobs.push({ key: k.name.slice(onek.length) });
        cursor = r.list_complete ? undefined : r.cursor;
      } while (cursor);
      return { blobs };
    },
  };
}
