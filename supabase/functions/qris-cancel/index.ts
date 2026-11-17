// Membatalkan kode QRIS saat tamu meninggalkan layar pembayaran, juga di DOKU.
import { handleCancel, readEnv } from '../_shared/handlers.ts';
import { serveJson } from '../_shared/http.ts';

Deno.serve((request) => serveJson(request, (input) => handleCancel(input, readEnv((name) => Deno.env.get(name)))));
