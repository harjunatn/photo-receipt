// Halaman unduh tamu: mengubah satu foto sesi menjadi versi AI (kartun, anime, …) lewat Gemini.
import { handleShareAi, readAiEnv } from '../_shared/ai.ts';
import { serveJson } from '../_shared/http.ts';

Deno.serve((request) => serveJson(request, (input, bearer) => handleShareAi(input, bearer, readAiEnv((name) => Deno.env.get(name)))));
