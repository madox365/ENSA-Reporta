'use strict';
const config = require('./config');
const db = require('./db');
const { crearApp } = require('./app');
const { sembrarCatalogo, sembrarDemo } = require('./seed');

const fs = require('node:fs');
try {
  db.abrir(config.rutaBD);
} catch (e) {
  if (e.code !== 'ESQUEMA_ANTIGUO') throw e;
  if (!config.demo) {
    console.error('La base de datos es de una versión anterior. Migre los datos (ver manual de instalación) o use otra ruta en DB_PATH.');
    process.exit(1);
  }
  // En demostración se guarda la base anterior y se crea una nueva con datos de prueba
  const respaldo = `${config.rutaBD}.anterior-${Date.now()}`;
  fs.renameSync(config.rutaBD, respaldo);
  for (const ext of ['-wal', '-shm']) fs.rmSync(config.rutaBD + ext, { force: true });
  console.log(`Base de demostración anterior guardada como ${respaldo}. Se crea una nueva.`);
  db.abrir(config.rutaBD);
}
sembrarCatalogo();
if (config.demo) sembrarDemo();

const app = crearApp();
app.listen(config.puerto, () => {
  console.log('');
  console.log('  ENSA Reporta · Sistema de gestión de incidencias del servicio');
  console.log(`  Clientes:  http://localhost:${config.puerto}/`);
  console.log(`  Personal:  http://localhost:${config.puerto}/personal`);
  if (config.demo) console.log('  Modo demostración: usuarios de prueba con contraseña Ensa2027demo');
  console.log('');
});
