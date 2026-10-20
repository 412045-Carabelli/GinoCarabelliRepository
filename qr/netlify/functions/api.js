import { rpc, CODIGO_RE } from '../lib/supabase.js';

// POST /api/activar  y  POST /api/editar
// Body JSON: { codigo, activacion, url }  ->  { ok: boolean }
// Hace de proxy hacia las RPC de Supabase: la página de activación no necesita
// conocer la URL ni la clave de Supabase, y se puede poner rate limiting sobre /api/*.

const RPC_POR_ACCION = { activar: 'activar_qr', editar: 'editar_qr' };
const MAX_BODY = 4096;

const json = (status, cuerpo) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const config = { path: '/api/:accion' };

export default async function handler(request, context) {
  const env = process.env;
  const nombreRpc = RPC_POR_ACCION[context.params?.accion];
  if (!nombreRpc) return json(404, { ok: false });
  if (request.method !== 'POST') return json(405, { ok: false });

  // Solo desde nuestra propia página.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json(403, { ok: false });
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    return json(415, { ok: false });
  }

  let datos;
  try {
    const texto = await request.text();
    if (texto.length > MAX_BODY) return json(413, { ok: false });
    datos = JSON.parse(texto);
  } catch {
    return json(400, { ok: false });
  }

  const { codigo, activacion, url } = datos ?? {};
  if (![codigo, activacion, url].every((v) => typeof v === 'string') || !CODIGO_RE.test(codigo)) {
    return json(200, { ok: false });
  }

  try {
    const r = await rpc(env, nombreRpc, {
      p_codigo: codigo,
      p_activacion: activacion,
      p_url: url,
    });
    return json(200, { ok: r?.ok === true });
  } catch (err) {
    console.error(`${nombreRpc} falló:`, err.message);
    return json(502, { ok: false, error: 'servicio' });
  }
}
