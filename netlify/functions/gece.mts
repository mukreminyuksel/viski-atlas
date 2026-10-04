// Netlify katmanı: çekirdek mantık api/gece.ts içinde.
import type { Context, Config } from "@netlify/functions";
import { isle } from "../../api/gece.ts";
import { depoAl } from "../lib/ortak.mts";

export default async (req: Request, _context: Context) => isle(req, depoAl("tadim-geceleri"));

export const config: Config = { path: "/api/gece" };
