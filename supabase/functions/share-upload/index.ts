// Memberi tablet alamat unggah sementara ke Cloudflare R2 untuk hasil foto, lalu mencatatnya.
import { serveJson } from '../_shared/http.ts';
import { handleShareUpload, readShareEnv } from '../_shared/share.ts';

Deno.serve((request) => serveJson(request, (input) => handleShareUpload(input, readShareEnv((name) => Deno.env.get(name)))));
