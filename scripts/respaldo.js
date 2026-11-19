'use strict';
// Copia de respaldo en caliente de la base de datos (VACUUM INTO) y de las fotos.
// Uso: npm run respaldo [-- carpeta_destino]   (por defecto: respaldos/AAAA-MM-DD_HHMM)
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const db = require('../src/db');

const marca = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const destino = path.resolve(process.argv[2] || path.join(__dirname, '..', 'respaldos', marca));
fs.mkdirSync(destino, { recursive: true });
db.abrir(config.rutaBD);
const archivo = path.join(destino, 'ensa-reporta.db');
db.obtener().exec(`VACUUM INTO '${archivo.replace(/'/g, "''")}'`);
db.cerrar();
if (fs.existsSync(config.rutaFotos)) fs.cpSync(config.rutaFotos, path.join(destino, 'fotos'), { recursive: true });
console.log(`Respaldo creado en ${destino}`);
