import type { APIRoute } from 'astro';
import { buildAtom } from '../atom.xml';

export const GET: APIRoute = (ctx) => buildAtom('en', ctx);
