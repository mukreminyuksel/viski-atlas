// Netlify katmanı: çekirdek mantık api/sync.ts içinde.
import type { Context, Config } from "@netlify/functions";
import { isle } from "../../api/sync.ts";
import { depoAl } from "../lib/ortak.mts";

export default async (req: Request, _context: Context) => isle(req, depoAl("koleksiyonlar"));

export const config: Config = { path: "/api/sync" };
