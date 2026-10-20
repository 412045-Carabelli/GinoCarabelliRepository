#!/usr/bin/env node
// Exporta la tabla qrs a backups/qrs-FECHA.csv (el plan gratis no trae backups descargables).
// Incluye activacion_hash, así que guardalo en un lugar privado (no en git).
// Uso: node scripts/backup.js

import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile?.();
} catch {
  /* sin .env */
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✗ Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ver .env.example)');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await db.from('qrs').select('*').order('creado_en').order('id').range(desde, desde + 999);
  if (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  filas.push(...data);
  if (data.length < 1000) break;
}

const columnas = filas.length ? Object.keys(filas[0]) : ['id'];
const celda = (v) => (v == null ? '' : `"${String(v).replaceAll('"', '""')}"`);
const csv = [columnas.join(','), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(','))].join('\n') + '\n';

await mkdir('backups', { recursive: true });
const archivo = `backups/qrs-${new Date().toISOString().slice(0, 10)}.csv`;
await writeFile(archivo, csv, { mode: 0o600 });
console.log(`✓ ${filas.length} filas -> ${archivo}`);
