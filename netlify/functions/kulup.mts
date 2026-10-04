// Netlify katmanı: çekirdek mantık api/kulup.ts içinde.
import type { Context, Config } from "@netlify/functions";
import { isle } from "../../api/kulup.ts";
import { depoAl } from "../lib/ortak.mts";

export default async (req: Request, _context: Context) => isle(req, depoAl("kulupler"), depoAl("tadim-geceleri"));

export const config: Config = { path: "/api/kulup" };
