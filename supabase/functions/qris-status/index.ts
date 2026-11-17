// Memberi tahu tablet apakah kode QRIS-nya sudah dibayar.
import { handleStatus, readEnv } from '../_shared/handlers.ts';
import { serveJson } from '../_shared/http.ts';

Deno.serve((request) => serveJson(request, (input) => handleStatus(input, readEnv((name) => Deno.env.get(name)))));
