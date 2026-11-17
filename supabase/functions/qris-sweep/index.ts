// Menyelesaikan kode QRIS tablet yang tertinggal tanpa status akhir (dibayar belakangan atau habis waktu).
import { handleSweep, readEnv } from '../_shared/handlers.ts';
import { serveJson } from '../_shared/http.ts';

Deno.serve((request) => serveJson(request, (input) => handleSweep(input, readEnv((name) => Deno.env.get(name)))));
