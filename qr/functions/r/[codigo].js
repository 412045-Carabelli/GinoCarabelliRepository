import { rpc, CODIGO_RE, esUrlHttp, paginaHtml } from '../_supabase.js';

// 302 (no 301) para que los navegadores no cacheen el destino: si el cliente
// edita el link, el próximo escaneo ya va al nuevo.
const redirigir = (location) =>
  new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });

export async function onRequestGet({ request, env, params }) {
  const codigo = String(params.codigo ?? '');
  if (!CODIGO_RE.test(codigo)) {
    return paginaHtml(404, 'QR no disponible', 'Este QR no existe o ya no está disponible.');
  }

  let resultado;
  try {
    resultado = await rpc(env, 'resolver_qr', { p_codigo: codigo });
  } catch (err) {
    console.error('resolver_qr falló:', err.message);
    return paginaHtml(503, 'Servicio no disponible', 'Probá de nuevo en unos minutos.');
  }

  switch (resultado?.estado) {
    case 'ok':
      // Defensa en profundidad: la base ya valida, pero nunca redirigimos a otro esquema.
      if (esUrlHttp(resultado.url_destino)) return redirigir(resultado.url_destino);
      return paginaHtml(404, 'QR no disponible', 'Este QR no existe o ya no está disponible.');
    case 'sin_activar':
      return redirigir(new URL(`/activar?c=${encodeURIComponent(codigo.toUpperCase())}`, request.url).toString());
    default:
      return paginaHtml(404, 'QR no disponible', 'Este QR no existe o ya no está disponible.');
  }
}
