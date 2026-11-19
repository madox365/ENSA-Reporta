'use strict';
const config = require('./config');
const db = require('./db');
const { crearApp } = require('./app');
const { sembrarCatalogo, sembrarDemo } = require('./seed');

db.abrir(config.rutaBD);
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
