// Helper compartido (no exporta handlers onRequest*, así que Pages no lo publica como ruta).

export async function rpc(env, nombre, args) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY');
  }
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}`);
  return res.json();
}

export const CODIGO_RE = /^[A-Za-z0-9]{6,16}$/;

export function esUrlHttp(valor) {
  try {
    const u = new URL(valor);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function paginaHtml(status, titulo, mensaje) {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${titulo}</title>
<style>
  body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f5f5f4;color:#1c1917}
  main{max-width:24rem;text-align:center}
  h1{font-size:1.4rem;margin:0 0 .5rem}p{margin:0;color:#57534e}
  @media (prefers-color-scheme:dark){body{background:#1c1917;color:#f5f5f4}p{color:#a8a29e}}
</style></head>
<body><main><h1>${titulo}</h1><p>${mensaje}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
