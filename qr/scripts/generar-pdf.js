#!/usr/bin/env node
// Arma un PDF A4 con los QRs de un lote en grilla, con sus códigos debajo, para imprimir en hojas de stickers.
// Lee lotes/NOMBRE/lote-NOMBRE.csv y los PNG que dejó generar-lote.js.
//
// Uso:  node scripts/generar-pdf.js --lote prueba-1
// Opciones: --columnas 4 · --tam 35 (lado del QR en mm) · --sin-activacion (no imprime el código de activación)
//           --sin-guias (sin recuadros de corte) · --salida lotes

import { parseArgs } from 'node:util';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const MM = 72 / 25.4; // pdfkit trabaja en puntos
const A4 = { w: 210, h: 297 };

export function leerCsv(texto) {
  const [, ...filas] = texto.trim().split(/\r?\n/);
  return filas.map((f) => {
    const [codigo, activacion, archivo] = f.replace(/^"|"$/g, '').split('","');
    return { codigo, activacion, archivo };
  });
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      lote: { type: 'string', short: 'l' },
      salida: { type: 'string', default: 'lotes' },
      columnas: { type: 'string', default: '4' },
      tam: { type: 'string', default: '35' },
      'sin-activacion': { type: 'boolean', default: false },
      'sin-guias': { type: 'boolean', default: false },
    },
  });
  const columnas = Number(values.columnas);
  const tam = Number(values.tam);
  const conActivacion = !values['sin-activacion'];
  const margen = 10;
  const altoTexto = conActivacion ? 12 : 7;

  if (!values.lote || !Number.isInteger(columnas) || columnas < 1 || !(tam >= 15)) {
    throw new Error('Uso: generar-pdf.js --lote NOMBRE [--columnas 4] [--tam 35 (mm, mínimo 15)]');
  }

  const dir = resolve(values.salida, values.lote);
  const registros = leerCsv(await readFile(join(dir, `lote-${values.lote}.csv`), 'utf8'));
  if (!registros.length) throw new Error('El CSV está vacío');
  if (registros[0].archivo.endsWith('.svg')) throw new Error('Este script usa los PNG: generá el lote con --formato png');

  const anchoCelda = (A4.w - 2 * margen) / columnas;
  const altoCelda = tam + altoTexto + 3;
  if (tam > anchoCelda - 2) throw new Error(`Con ${columnas} columnas el QR puede medir como máximo ${Math.floor(anchoCelda - 2)} mm`);
  const filas = Math.floor((A4.h - 2 * margen) / altoCelda);
  const porPagina = columnas * filas;

  const salidaPdf = join(dir, `lote-${values.lote}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(createWriteStream(salidaPdf));

  for (const [i, r] of registros.entries()) {
    if (i > 0 && i % porPagina === 0) doc.addPage();
    const pos = i % porPagina;
    const x = margen + (pos % columnas) * anchoCelda;
    const y = margen + Math.floor(pos / columnas) * altoCelda;

    if (!values['sin-guias']) {
      doc.save().lineWidth(0.3).dash(2, { space: 2 }).strokeColor('#999')
        .rect(x * MM, y * MM, anchoCelda * MM, altoCelda * MM).stroke().restore();
    }
    doc.image(join(dir, r.archivo), (x + (anchoCelda - tam) / 2) * MM, (y + 1) * MM, { width: tam * MM, height: tam * MM });

    doc.fillColor('#000').font('Courier-Bold').fontSize(9)
      .text(r.codigo, x * MM, (y + tam + 1.5) * MM, { width: anchoCelda * MM, align: 'center', lineBreak: false });
    if (conActivacion) {
      doc.font('Courier').fontSize(7)
        .text(`Activación: ${r.activacion}`, x * MM, (y + tam + 6) * MM, { width: anchoCelda * MM, align: 'center', lineBreak: false });
    }
  }
  doc.end();
  await new Promise((ok) => doc.on('end', ok));
  console.log(`✓ ${registros.length} QRs en ${Math.ceil(registros.length / porPagina)} página(s) (${columnas}×${filas} por hoja)`);
  console.log(`  ${salidaPdf}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
