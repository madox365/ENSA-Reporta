'use strict';
const db = require('../db');
const auditoria = require('./auditoria');
const { iso, hashClave, ErrorNegocio, texto, numero } = require('../util');

const ROLES = ['ADMIN', 'OPERADOR', 'SUPERVISOR', 'GERENCIA'];
const PRIORIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];

function validarClave(clave) {
  if (String(clave || '').length < 10 || !/[A-Za-z]/.test(clave) || !/\d/.test(clave)) {
    throw new ErrorNegocio('La contraseña debe tener al menos 10 caracteres, con letras y números.');
  }
}

function listarUsuarios() {
  return db.todos(
    `SELECT u.id, u.usuario, u.nombre, u.rol, u.area_id, a.nombre AS area, u.activo, u.creado_en
       FROM usuario u LEFT JOIN area a ON a.id = u.area_id ORDER BY u.activo DESC, u.rol, u.nombre`,
  );
}

function crearUsuario(d, actor, ip) {
  const usuario = texto(d.usuario, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new ErrorNegocio('Usuario no válido (letras, números, punto o guion).');
  if (db.uno('SELECT 1 FROM usuario WHERE usuario = ?', usuario)) throw new ErrorNegocio('El usuario ya existe.');
  const nombre = texto(d.nombre, 120);
  if (nombre.length < 3) throw new ErrorNegocio('Escribe el nombre completo.');
  if (!ROLES.includes(d.rol)) throw new ErrorNegocio('Rol no válido.');
  validarClave(d.clave);
  const areaId = numero(d.area_id);
  const r = db.ejecutar(
    'INSERT INTO usuario (usuario, nombre, rol, area_id, clave_hash, activo, creado_en) VALUES (?,?,?,?,?,1,?)',
    usuario, nombre, d.rol, areaId, hashClave(d.clave), iso(),
  );
  auditoria.registrar({ usuarioId: actor.id, accion: 'USUARIO_CREAR', entidad: 'usuario', entidadId: Number(r.lastInsertRowid), detalle: `${usuario} (${d.rol})`, ip });
  return { id: Number(r.lastInsertRowid) };
}

function actualizarUsuario(id, d, actor, ip) {
  const u = db.uno('SELECT * FROM usuario WHERE id = ?', Number(id));
  if (!u) throw new ErrorNegocio('Usuario no encontrado.', 404);
  const rol = d.rol ?? u.rol;
  if (!ROLES.includes(rol)) throw new ErrorNegocio('Rol no válido.');
  const activo = d.activo == null ? u.activo : (d.activo ? 1 : 0);
  if (u.id === actor.id && (!activo || rol !== 'ADMIN')) throw new ErrorNegocio('No puedes desactivar ni quitarte el rol de administrador a ti mismo.');
  const areaId = d.area_id === undefined ? u.area_id : numero(d.area_id);
  db.ejecutar('UPDATE usuario SET nombre = ?, rol = ?, area_id = ?, activo = ? WHERE id = ?',
    texto(d.nombre ?? u.nombre, 120), rol, areaId, activo, u.id);
  if (d.clave) {
    validarClave(d.clave);
    db.ejecutar('UPDATE usuario SET clave_hash = ? WHERE id = ?', hashClave(d.clave), u.id);
  }
  auditoria.registrar({ usuarioId: actor.id, accion: 'USUARIO_ACTUALIZAR', entidad: 'usuario', entidadId: u.id, detalle: `${u.usuario}: rol ${rol}, activo ${activo}${d.clave ? ', cambio de contraseña' : ''}`, ip });
  return { ok: true };
}

function actualizarTipo(id, d, actor, ip) {
  const t = db.uno('SELECT * FROM tipo_incidencia WHERE id = ?', Number(id));
  if (!t) throw new ErrorNegocio('Tipo no encontrado.', 404);
  const prioridad = d.prioridad ?? t.prioridad;
  if (!PRIORIDADES.includes(prioridad)) throw new ErrorNegocio('Prioridad no válida.');
  const plazo = numero(d.plazo_horas) ?? t.plazo_horas;
  const ventana = numero(d.ventana_agrupacion_h) ?? t.ventana_agrupacion_h;
  const radio = d.radio_agrupacion_m === '' || d.radio_agrupacion_m === null ? null : (numero(d.radio_agrupacion_m) ?? t.radio_agrupacion_m);
  const area = numero(d.area_id) ?? t.area_id;
  if (plazo < 1 || plazo > 720) throw new ErrorNegocio('El plazo debe estar entre 1 y 720 horas.');
  if (ventana < 1 || ventana > 720) throw new ErrorNegocio('La ventana de agrupación debe estar entre 1 y 720 horas.');
  if (radio != null && (radio < 10 || radio > 20000)) throw new ErrorNegocio('El radio debe estar entre 10 y 20,000 metros, o vacío para toda la zona.');
  if (!db.uno('SELECT 1 FROM area WHERE id = ?', area)) throw new ErrorNegocio('Área no válida.');
  db.ejecutar(
    'UPDATE tipo_incidencia SET prioridad = ?, plazo_horas = ?, ventana_agrupacion_h = ?, radio_agrupacion_m = ?, area_id = ?, activo = ? WHERE id = ?',
    prioridad, plazo, ventana, radio, area, d.activo == null ? t.activo : (d.activo ? 1 : 0), t.id,
  );
  auditoria.registrar({ usuarioId: actor.id, accion: 'CATALOGO_TIPO', entidad: 'tipo_incidencia', entidadId: t.id, detalle: `${t.codigo}: ${prioridad}, ${plazo} h, radio ${radio ?? 'zona'}, ventana ${ventana} h`, ip });
  return { ok: true };
}

function listarNotificaciones({ limite = 200 } = {}) {
  return db.todos(
    `SELECT n.*, r.codigo AS reporte FROM notificacion n JOIN reporte r ON r.id = n.reporte_id ORDER BY n.id DESC LIMIT ?`,
    Math.min(Number(limite) || 200, 1000),
  );
}

module.exports = { listarUsuarios, crearUsuario, actualizarUsuario, actualizarTipo, listarNotificaciones, ROLES };
