'use strict';
// Carga o actualiza el padrón de suministros desde un CSV exportado de Optimus NGC.
// Uso: npm run importar-suministros -- ruta/al/archivo.csv
// Columnas (separador ;): numero;titular;documento;direccion;zona;lat;lng;sed;telefono
// "zona" es el nombre del distrito tal como está en el catálogo del sistema.
const fs = require('node:fs');
const config = require('../src/config');
const db = require('../src/db');
const { sembrarCatalogo } = require('../src/seed');
const { iso } = require('../src/util');

const ruta = process.argv[2];
if (!ruta) { console.error('Indica el archivo CSV. Ej.: npm run importar-suministros -- padron.csv'); process.exit(1); }
db.abrir(config.rutaBD);
sembrarCatalogo();
const zonas = new Map(db.todos('SELECT id, nombre FROM zona').map((z) => [z.nombre.toLowerCase(), z.id]));
const lineas = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
const cab = lineas.shift().split(';').map((c) => c.trim().toLowerCase());
const req = ['numero', 'titular', 'documento', 'direccion', 'zona'];
for (const c of req) if (!cab.includes(c)) { console.error(`Falta la columna "${c}".`); process.exit(1); }
let ok = 0; const errores = [];
const ahora = iso();
db.transaccion(() => {
  lineas.forEach((l, i) => {
    const v = Object.fromEntries(l.split(';').map((x, k) => [cab[k], x.trim()]));
    const zonaId = zonas.get(String(v.zona || '').toLowerCase());
    if (!/^\d{5,12}$/.test(v.numero || '') || !v.titular || !v.documento || !v.direccion || !zonaId) { errores.push(`Línea ${i + 2}: datos incompletos o zona desconocida (${v.zona})`); return; }
    db.ejecutar(`INSERT INTO suministro (numero, titular, documento, direccion, zona_id, lat, lng, sed, telefono, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(numero) DO UPDATE SET titular=excluded.titular, documento=excluded.documento, direccion=excluded.direccion, zona_id=excluded.zona_id,
      lat=excluded.lat, lng=excluded.lng, sed=excluded.sed, telefono=excluded.telefono, actualizado=excluded.actualizado`,
    v.numero, v.titular, v.documento, v.direccion, zonaId, v.lat ? Number(v.lat) : null, v.lng ? Number(v.lng) : null, v.sed || null, v.telefono || null, ahora);
    ok++;
  });
});
console.log(`Suministros cargados o actualizados: ${ok}. Con error: ${errores.length}.`);
for (const e of errores.slice(0, 20)) console.log(`  ${e}`);
db.cerrar();
