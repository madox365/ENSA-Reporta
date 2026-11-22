'use strict';
// Capa de acceso a datos. Todo el SQL del sistema pasa por este módulo y por los servicios,
// de modo que el cambio a SQL Server (producción) se concentra en un solo lugar.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let bd = null;

function abrir(ruta) {
  if (bd) return bd;
  if (ruta !== ':memory:') fs.mkdirSync(path.dirname(ruta), { recursive: true });
  bd = new DatabaseSync(ruta);
  bd.exec('PRAGMA foreign_keys = ON;');
  if (ruta !== ':memory:') bd.exec('PRAGMA journal_mode = WAL;');
  // Una base creada con la versión anterior (sin órdenes de trabajo) no es compatible
  const existe = bd.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'incidencia'").get();
  const nueva = bd.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orden_trabajo'").get();
  if (existe && !nueva) {
    bd.close(); bd = null;
    throw Object.assign(new Error('La base de datos es de una versión anterior del sistema.'), { code: 'ESQUEMA_ANTIGUO' });
  }
  // La primera versión de la encuesta tenía más preguntas: se rehace la tabla conservando las respuestas
  const colsEncuesta = bd.prepare('PRAGMA table_info(encuesta)').all().map((c) => c.name);
  if (colsEncuesta.includes('trato')) {
    bd.exec(`ALTER TABLE encuesta RENAME TO encuesta_v1;
             DROP INDEX IF EXISTS ix_encuesta_incidencia; DROP INDEX IF EXISTS ix_encuesta_cuadrilla;`);
  }
  bd.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  if (colsEncuesta.includes('trato')) {
    bd.exec(`INSERT INTO encuesta (id, reporte_id, incidencia_id, orden_trabajo_id, cuadrilla_id, general, rapidez, fecha)
               SELECT id, reporte_id, incidencia_id, orden_trabajo_id, cuadrilla_id, general, rapidez, fecha FROM encuesta_v1;
             DROP TABLE encuesta_v1;`);
  }
  return bd;
}

function cerrar() {
  if (bd) { bd.close(); bd = null; }
}

function obtener() {
  if (!bd) throw new Error('Base de datos no inicializada');
  return bd;
}

const todos = (sql, ...p) => obtener().prepare(sql).all(...p);
const uno = (sql, ...p) => obtener().prepare(sql).get(...p);
const ejecutar = (sql, ...p) => obtener().prepare(sql).run(...p);

function transaccion(fn) {
  const b = obtener();
  b.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    b.exec('COMMIT');
    return r;
  } catch (e) {
    b.exec('ROLLBACK');
    throw e;
  }
}

// Correlativos por año: INC-2027-000001, RP-2027-000001
function siguiente(nombre) {
  const fila = uno('SELECT valor FROM secuencia WHERE nombre = ?', nombre);
  if (!fila) { ejecutar('INSERT INTO secuencia (nombre, valor) VALUES (?, 1)', nombre); return 1; }
  ejecutar('UPDATE secuencia SET valor = valor + 1 WHERE nombre = ?', nombre);
  return fila.valor + 1;
}

module.exports = { abrir, cerrar, obtener, todos, uno, ejecutar, transaccion, siguiente };
