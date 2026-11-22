'use strict';
// Ingreso del cliente con su número de suministro (el código del recibo de luz).
// Basta el número de suministro: con él se cargan del padrón (exportado de Optimus NGC) el titular,
// la dirección, la zona, la ubicación y el celular registrado. El número figura en el recibo de luz.
// Para frenar a quien pruebe números al azar: límite de intentos por IP (ruta) y por número.
const crypto = require('node:crypto');
const db = require('../db');
const auditoria = require('./auditoria');
const { ErrorNegocio, texto } = require('../util');

const sesiones = new Map(); // token → { numero, expira }
const fallos = new Map();   // suministro → { n, hasta }
const HORAS = 2, MAX_FALLOS = 5, BLOQUEO_MIN = 15;

function enmascararNombre(n) {
  return String(n).split(/\s+/).map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(' ');
}

function ingresar(numero, ip) {
  const num = texto(numero, 15).replace(/\D/g, '');
  if (!num) throw new ErrorNegocio('Ingresa tu número de suministro.');
  const f = fallos.get(num);
  if (f && f.hasta > Date.now()) throw new ErrorNegocio(`Demasiados intentos. Intenta nuevamente en ${BLOQUEO_MIN} minutos.`, 429);
  const s = db.uno('SELECT * FROM suministro WHERE numero = ?', num);
  if (!s) {
    const reg = !f || (f.hasta && f.hasta <= Date.now()) ? { n: 0, hasta: 0 } : f;
    reg.n++;
    if (reg.n >= MAX_FALLOS) { reg.hasta = Date.now() + BLOQUEO_MIN * 60e3; reg.n = 0; }
    fallos.set(num, reg);
    auditoria.registrar({ accion: 'CLIENTE_INGRESO_FALLIDO', detalle: num, ip });
    throw new ErrorNegocio('No encontramos ese número de suministro. Revísalo en tu recibo de luz.', 401);
  }
  fallos.delete(num);
  const token = crypto.randomBytes(24).toString('hex');
  sesiones.set(token, { numero: s.numero, expira: Date.now() + HORAS * 3600e3 });
  auditoria.registrar({ accion: 'CLIENTE_INGRESO', entidad: 'suministro', detalle: s.numero, ip });
  return { token, cliente: datosPublicos(s) };
}

function datosPublicos(s) {
  const zona = db.uno('SELECT z.nombre, u.nombre AS unidad FROM zona z JOIN unidad_negocio u ON u.id = z.unidad_negocio_id WHERE z.id = ?', s.zona_id);
  return {
    suministro: s.numero,
    titular: enmascararNombre(s.titular),
    direccion: s.direccion,
    zona_id: s.zona_id,
    zona: zona.nombre,
    unidad: zona.unidad,
    tiene_ubicacion: s.lat != null,
    telefono_registrado: s.telefono ? `*****${s.telefono.slice(-4)}` : null,
  };
}

// Devuelve el registro del padrón si el token es válido; null si no hay token
function desdeToken(req) {
  const m = /^Bearer ([a-f0-9]{48})$/.exec(req.get('Authorization') || '');
  if (!m) return null;
  const ses = sesiones.get(m[1]);
  if (!ses || ses.expira < Date.now()) {
    sesiones.delete(m[1]);
    throw new ErrorNegocio('Tu sesión expiró. Ingresa nuevamente con tu suministro.', 401);
  }
  return db.uno('SELECT * FROM suministro WHERE numero = ?', ses.numero);
}

function salir(req) {
  const m = /^Bearer ([a-f0-9]{48})$/.exec(req.get('Authorization') || '');
  if (m) sesiones.delete(m[1]);
}

function misReportes(cliente) {
  return db.todos(
    `SELECT r.codigo, r.fecha, r.canal, i.codigo AS incidencia, i.estado, t.nombre AS tipo, z.nombre AS zona,
            i.cantidad_reportes, i.fecha_solucion
       FROM reporte r JOIN incidencia i ON i.id = r.incidencia_id JOIN tipo_incidencia t ON t.id = i.tipo_id
       JOIN zona z ON z.id = i.zona_id
      WHERE r.suministro = ? ORDER BY r.fecha DESC LIMIT 50`, cliente.numero,
  );
}

module.exports = { ingresar, desdeToken, salir, misReportes, datosPublicos };
