#!/usr/bin/env node
// Genera un lote de QRs: inserta en Supabase (con el hash de la activación) y
// exporta un PNG/SVG por QR + lote-NOMBRE.csv (codigo, activacion, archivo).
//
// Uso:
//   node scripts/generar-lote.js --cantidad 50 --lote mayo-2026 --dominio qr.midominio.com
//   (--dominio y credenciales también pueden venir del .env)
// Opciones: --formato png|svg (png) · --nivel L|M|Q|H (Q) · --salida lotes · --dry-run

import { parseArgs } from 'node:util';
import { randomInt, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';

// Sin caracteres ambiguos (0/O, 1/I/L). 31 símbolos (~4.95 bits cada uno).
export const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LARGO_CODIGO = 8; // ~40 bits; identifica, no es secreto
const LARGO_ACTIVACION = 12; // ~59 bits; con bloqueo por intentos en la base

const aleatorio = (largo) =>
  Array.from({ length: largo }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

export const generarCodigo = () => aleatorio(LARGO_CODIGO);

/** XXXX-XXXX-XXXX */
export const generarActivacion = () => aleatorio(LARGO_ACTIVACION).match(/.{4}/g).join('-');

/** Debe coincidir con public._hash_activacion() en schema.sql. */
export const hashActivacion = (activacion) =>
  createHash('sha256')
    .update(activacion.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .digest('hex');

export function generarLote(cantidad) {
  const codigos = new Set();
  while (codigos.size < cantidad) codigos.add(generarCodigo());
  return [...codigos].map((codigo) => {
    const activacion = generarActivacion();
    return { codigo, activacion, activacion_hash: hashActivacion(activacion) };
  });
}

const csvCelda = (v) => `"${String(v).replaceAll('"', '""')}"`;

async function main() {
  try {
    process.loadEnvFile?.(); // .env en el directorio actual (Node >= 20.12)
  } catch {
    /* sin .env: se usan variables de entorno / argumentos */
  }

  const { values } = parseArgs({
    options: {
      cantidad: { type: 'string', short: 'n' },
      lote: { type: 'string', short: 'l' },
      dominio: { type: 'string', short: 'd' },
      formato: { type: 'string', default: 'png' },
      nivel: { type: 'string', default: 'Q' },
      salida: { type: 'string', default: 'lotes' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const cantidad = Number(values.cantidad);
  const lote = values.lote;
  const dominio = (values.dominio ?? process.env.DOMINIO_BASE ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const dryRun = values['dry-run'];

  const errores = [];
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) errores.push('--cantidad debe ser un entero entre 1 y 10000');
  if (!lote || !/^[\w.-]{1,60}$/.test(lote)) errores.push('--lote es obligatorio (letras, números, - _ .)');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(dominio)) errores.push('--dominio (o DOMINIO_BASE) inválido, ej: qr.midominio.com');
  if (!['png', 'svg'].includes(values.formato)) errores.push('--formato debe ser png o svg');
  if (!['L', 'M', 'Q', 'H'].includes(values.nivel)) errores.push('--nivel debe ser L, M, Q o H');
  if (!dryRun && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    errores.push('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ver .env.example)');
  }
  if (errores.length) {
    console.error(errores.map((e) => `✗ ${e}`).join('\n'));
    process.exit(1);
  }

  const registros = generarLote(cantidad);

  if (!dryRun) {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { count, error: errLote } = await db.from('qrs').select('id', { count: 'exact', head: true }).eq('lote', lote);
    if (errLote) throw new Error(`No se pudo consultar Supabase: ${errLote.message}`);
    if (count > 0) throw new Error(`El lote "${lote}" ya existe (${count} QRs). Elegí otro nombre.`);

    try {
      for (let i = 0; i < registros.length; i += 500) {
        const filas = registros.slice(i, i + 500).map(({ codigo, activacion_hash }) => ({ codigo, activacion_hash, lote }));
        const { error } = await db.from('qrs').insert(filas);
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      await db.from('qrs').delete().eq('lote', lote); // no dejar un lote a medias
      throw new Error(`Falló la inserción (se revirtió el lote): ${err.message}`);
    }
  }

  const dir = resolve(values.salida, lote);
  await mkdir(dir, { recursive: true });

  const filasCsv = ['codigo,activacion,archivo'];
  for (const { codigo, activacion } of registros) {
    const archivo = `${codigo}.${values.formato}`;
    const url = `https://${dominio}/r/${codigo}`;
    const opciones = { errorCorrectionLevel: values.nivel, margin: 4 }; // margin 4 = quiet zone estándar
    if (values.formato === 'svg') {
      await writeFile(join(dir, archivo), await QRCode.toString(url, { ...opciones, type: 'svg' }));
    } else {
      await QRCode.toFile(join(dir, archivo), url, { ...opciones, type: 'png', width: 1000 });
    }
    filasCsv.push([codigo, activacion, archivo].map(csvCelda).join(','));
  }
  const csv = join(dir, `lote-${lote}.csv`);
  await writeFile(csv, filasCsv.join('\n') + '\n', { mode: 0o600 });

  console.log(`✓ ${cantidad} QRs ${dryRun ? '(dry-run, NO insertados en Supabase)' : 'insertados en Supabase'}`);
  console.log(`  Imágenes: ${dir}`);
  console.log(`  CSV para imprimir: ${csv}  (contiene los códigos de activación en claro: no lo subas a git)`);
  console.log(`  Ejemplo: https://${dominio}/r/${registros[0].codigo}`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
