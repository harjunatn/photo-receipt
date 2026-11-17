// Membuat kode QRIS untuk satu sesi. Dipanggil tablet dengan token perangkatnya.
import { handleCreate, readEnv } from '../_shared/handlers.ts';
import { serveJson } from '../_shared/http.ts';

Deno.serve((request) => serveJson(request, (input) => handleCreate(input, readEnv((name) => Deno.env.get(name)))));
