// Netlify'a özgü depo: Netlify Blobs. Çekirdek kod api/ altında, platformdan bağımsız.
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Depo } from "../../api/ortak.ts";

// Canlı sitede kalıcı (global) depo, önizleme/branch yayınlarında yayına özel depo:
// test verisi gerçek kullanıcı verisine karışmasın.
export function depoAl(ad: string): Depo {
  const uretim = (globalThis as any).Netlify?.context?.deploy?.context === "production";
  return (uretim ? getStore({ name: ad, consistency: "strong" }) : getDeployStore({ name: ad, consistency: "strong" })) as unknown as Depo;
}
