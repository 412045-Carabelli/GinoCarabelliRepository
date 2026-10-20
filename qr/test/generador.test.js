import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { ALFABETO, generarLote, hashActivacion } from '../scripts/generar-lote.js';

test('alfabeto sin caracteres ambiguos', () => {
  assert.doesNotMatch(ALFABETO, /[01OIL]/);
});

test('lote: códigos únicos, formato y hash consistente', () => {
  const lote = generarLote(2000);
  assert.equal(new Set(lote.map((r) => r.codigo)).size, 2000);
  for (const r of lote) {
    assert.match(r.codigo, /^[A-Z0-9]{8}$/);
    assert.match(r.activacion, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(r.activacion_hash, hashActivacion(r.activacion.toLowerCase().replaceAll('-', ' ')));
  }
});

test('hash = sha256 hex del código normalizado (igual que schema.sql)', () => {
  const esperado = '3f63d25fcb898ecfd6c2e2322bfdb11f44fe17dd0dc359e70b7246224bb223e9'; // sha256('ABCDEFGHJKLM')
  assert.equal(hashActivacion('abcd-efgh-jklm'), esperado);
});

test('CLI --dry-run genera PNGs escaneables y CSV', () => {
  const salida = mkdtempSync(join(tmpdir(), 'qr-'));
  execFileSync('node', ['scripts/generar-lote.js', '-n', '5', '-l', 'prueba', '-d', 'qr.ejemplo.com', '--salida', salida, '--dry-run'], { stdio: 'pipe' });
  const dir = join(salida, 'prueba');
  const csv = readFileSync(join(dir, 'lote-prueba.csv'), 'utf8').trim().split('\n');
  assert.equal(csv.length, 6);
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.png')).length, 5);

  const [codigo] = csv[1].replaceAll('"', '').split(',');
  const png = PNG.sync.read(readFileSync(join(dir, `${codigo}.png`)));
  const leido = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(leido?.data, `https://qr.ejemplo.com/r/${codigo}`);
});

test('CLI rechaza parámetros inválidos', () => {
  assert.throws(() => execFileSync('node', ['scripts/generar-lote.js', '-n', '0', '--dry-run'], { stdio: 'pipe' }));
});
