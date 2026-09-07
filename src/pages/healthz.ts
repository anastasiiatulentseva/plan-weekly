import type { APIRoute } from 'astro';
export const GET: APIRoute = () => new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
