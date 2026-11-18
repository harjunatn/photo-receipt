// Halaman unduh tamu dan dashboard: tautan sementara ke hasil foto di Cloudflare R2.
import { serveJson } from '../_shared/http.ts';
import { handleShareGet, readShareEnv } from '../_shared/share.ts';

Deno.serve((request) => serveJson(request, (input) => handleShareGet(input, readShareEnv((name) => Deno.env.get(name)))));
