// Sunucu fonksiyonlarının ortak yardımcıları
import { getStore, getDeployStore } from "@netlify/blobs";

export type Depo = {
  get(key: string, opt?: { type?: "json" | "text" }): Promise<any>;
  setJSON(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(opt?: { prefix?: string }): Promise<{ blobs: { key: string }[] }>;
};

// Canlı sitede kalıcı (global) depo, önizleme/branch yayınlarında yayına özel depo:
// test verisi gerçek kullanıcı verisine karışmasın.
export function depoAl(ad: string): Depo {
  const uretim = (globalThis as any).Netlify?.context?.deploy?.context === "production";
  return (uretim ? getStore({ name: ad, consistency: "strong" }) : getDeployStore({ name: ad, consistency: "strong" })) as unknown as Depo;
}

export function json(veri: unknown, durum = 200): Response {
  return new Response(JSON.stringify(veri), {
    status: durum,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const hata = (mesaj: string, durum = 400) => json({ hata: mesaj }, durum);

export function rastgele(uzunluk: number, alfabe = "abcdefghjkmnpqrstuvwxyz23456789"): string {
  const b = new Uint8Array(uzunluk);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => alfabe[x % alfabe.length]).join("");
}

export async function ozet(metin: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(metin));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function govdeOku(req: Request, sinir = 300_000): Promise<any> {
  const metin = await req.text();
  if (metin.length > sinir) throw new Error("çok büyük");
  return metin ? JSON.parse(metin) : {};
}

export const kirp = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
