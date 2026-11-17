// Menerima pemberitahuan pembayaran dari DOKU (Notification URL). Tanda tangannya diperiksa
// dengan Secret Key; pemberitahuan yang tidak cocok ditolak.
import { handleNotify, readEnv } from '../_shared/handlers.ts';
import { json } from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  try {
    const reply = await handleNotify(request.headers, await request.text(), readEnv((name) => Deno.env.get(name)));
    return json(reply.status, reply.body);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    // A failure here makes DOKU try again later.
    return json(500, { error: 'server' });
  }
});
