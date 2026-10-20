import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import redirigir from '../netlify/functions/r.js';
import api from '../netlify/functions/api.js';

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
let llamadas;
const mockRpc = (respuesta, status = 200) => {
  llamadas = [];
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(respuesta), { status });
  };
};
beforeEach(() => mockRpc({}));

const get = (codigo) =>
  redirigir(new Request(`https://qr.ejemplo.com/r/${codigo}`), { params: { codigo } });

test('ok -> 302 al destino, sin cache', async () => {
  mockRpc({ estado: 'ok', url_destino: 'https://destino.com/a' });
  const r = await get('ABCD2345');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), 'https://destino.com/a');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(llamadas[0].url, 'https://x.supabase.co/rest/v1/rpc/resolver_qr');
});

test('ok con esquema peligroso -> no redirige', async () => {
  mockRpc({ estado: 'ok', url_destino: 'javascript:alert(1)' });
  assert.equal((await get('ABCD2345')).status, 404);
});

test('sin_activar -> 302 a /activar?c=', async () => {
  mockRpc({ estado: 'sin_activar', url_destino: null });
  const r = await get('abcd2345');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), 'https://qr.ejemplo.com/activar?c=ABCD2345');
});

test('deshabilitado / no_existe / código inválido -> página no disponible', async () => {
  mockRpc({ estado: 'deshabilitado' });
  assert.equal((await get('ABCD2345')).status, 404);
  mockRpc({ estado: 'no_existe' });
  assert.equal((await get('ABCD2345')).status, 404);
  mockRpc({});
  assert.equal((await get('../x')).status, 404);
  assert.equal(llamadas.length, 0); // ni siquiera consulta la base
});

test('error de Supabase -> 503 (no confundir con "no existe")', async () => {
  mockRpc({ message: 'boom' }, 500);
  assert.equal((await get('ABCD2345')).status, 503);
});

const post = (accion, cuerpo, headers = {}) =>
  api(
    new Request(`https://qr.ejemplo.com/api/${accion}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    }),
    { params: { accion } }
  );

test('api activar -> llama activar_qr y devuelve solo {ok}', async () => {
  mockRpc({ ok: true });
  const r = await post('activar', { codigo: 'ABCD2345', activacion: 'AAAA-BBBB-CCCC', url: 'https://a.com' });
  assert.deepEqual(await r.json(), { ok: true });
  assert.match(llamadas[0].url, /activar_qr$/);
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { p_codigo: 'ABCD2345', p_activacion: 'AAAA-BBBB-CCCC', p_url: 'https://a.com' });
});

test('api editar -> editar_qr; ok:false se propaga', async () => {
  mockRpc({ ok: false });
  const r = await post('editar', { codigo: 'ABCD2345', activacion: 'x', url: 'https://a.com' });
  assert.deepEqual(await r.json(), { ok: false });
  assert.match(llamadas[0].url, /editar_qr$/);
});

test('api rechaza acción desconocida, otro origen, body inválido', async () => {
  mockRpc({ ok: true });
  assert.equal((await post('borrar', {})).status, 404);
  assert.equal((await post('activar', {}, { Origin: 'https://malo.com' })).status, 403);
  assert.equal((await post('activar', 'no-json')).status, 400);
  const r = await post('activar', { codigo: 'ABCD2345', activacion: 1, url: 'https://a.com' });
  assert.deepEqual(await r.json(), { ok: false });
  assert.equal(llamadas.length, 0);
});
