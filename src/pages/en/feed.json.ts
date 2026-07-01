import type { APIRoute } from 'astro';
import { buildJsonFeed } from '../feed.json';

export const GET: APIRoute = (ctx) => buildJsonFeed('en', ctx);
