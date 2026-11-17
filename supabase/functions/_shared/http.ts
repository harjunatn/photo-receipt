/** The tablets call these functions from a browser, so every answer carries CORS headers. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** Runs a JSON-in, JSON-out handler; anything unexpected becomes a plain 500 without leaking details. */
export async function serveJson(
  request: Request,
  handler: (input: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method' });
  try {
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reply = await handler(input ?? {});
    return json(reply.status, reply.body);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    return json(500, { error: 'server' });
  }
}
