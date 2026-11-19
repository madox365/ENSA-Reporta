'use strict';
const db = require('../db');
const { iso } = require('../util');

function registrar({ usuarioId = null, accion, entidad = null, entidadId = null, detalle = null, ip = null }) {
  db.ejecutar(
    'INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip, fecha) VALUES (?,?,?,?,?,?,?)',
    usuarioId, accion, entidad, entidadId, detalle ? String(detalle).slice(0, 500) : null, ip, iso(),
  );
}

function listar({ limite = 200 } = {}) {
  return db.todos(
    `SELECT a.*, u.usuario, u.nombre AS usuario_nombre
       FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
      ORDER BY a.id DESC LIMIT ?`, Math.min(Number(limite) || 200, 1000),
  );
}

module.exports = { registrar, listar };
