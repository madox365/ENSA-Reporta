'use strict';
// Borra la base de datos de demostración y las fotos, para empezar la sustentación desde cero.
const fs = require('node:fs');
const config = require('../src/config');
for (const f of [config.rutaBD, `${config.rutaBD}-wal`, `${config.rutaBD}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(config.rutaFotos, { recursive: true, force: true });
console.log('Base de demostración eliminada. Ejecuta "npm start" para crearla de nuevo con datos de prueba.');
