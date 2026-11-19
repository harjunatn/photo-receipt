// Akun admin franchise: dibuat, diberi password baru, dan dihapus oleh superadmin dari dashboard.
import { handleAdmin } from '../_shared/accounts.ts';
import { readEnv } from '../_shared/handlers.ts';
import { serveJson } from '../_shared/http.ts';

Deno.serve((request) => serveJson(request, (input, bearer) => handleAdmin(input, bearer, readEnv((name) => Deno.env.get(name)))));
