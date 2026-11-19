// Halaman setup pembayaran: menyimpan dan mencoba kunci DOKU milik satu franchise.
import { readEnv } from '../_shared/handlers.ts';
import { serveJson } from '../_shared/http.ts';
import { handleDokuSetup } from '../_shared/setup.ts';

Deno.serve((request) => serveJson(request, (input, bearer) => handleDokuSetup(input, bearer, readEnv((name) => Deno.env.get(name)))));
