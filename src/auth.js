'use strict';
// Sesiones del personal. Piloto: usuarios locales con contraseña (scrypt).
// Producción: inicio de sesión con la cuenta corporativa de Office 365 (Microsoft Entra ID, OpenID Connect);
// el rol y el área se siguen administrando en la tabla usuario.
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');
const auditoria = require('./servicios/auditoria');
const { verificarClave, ErrorNegocio } = require('./util');

const sesiones = new Map();          // token → { usuarioId, expira, csrf }
const intentos = new Map();          // usuario → { fallos, bloqueadoHasta }
const MAX_FALLOS = 5, BLOQUEO_MIN = 15;
const COOKIE = 'ensa_sid';

function leerCookie(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

function iniciarSesion(req, res, usuario, clave) {
  const nombre = String(usuario || '').trim().toLowerCase();
  const ip = req.ip;
  const reg = intentos.get(nombre) || { fallos: 0, bloqueadoHasta: 0 };
  if (reg.bloqueadoHasta > Date.now()) {
    throw new ErrorNegocio(`Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${BLOQUEO_MIN} minutos.`, 429);
  }
  const u = db.uno('SELECT * FROM usuario WHERE usuario = ?', nombre);
  const ok = u && u.activo && verificarClave(String(clave || ''), u.clave_hash);
  if (!ok) {
    reg.fallos++;
    if (reg.fallos >= MAX_FALLOS) { reg.bloqueadoHasta = Date.now() + BLOQUEO_MIN * 60e3; reg.fallos = 0; }
    intentos.set(nombre, reg);
    auditoria.registrar({ usuarioId: u ? u.id : null, accion: 'LOGIN_FALLIDO', detalle: nombre, ip });
    throw new ErrorNegocio('Usuario o contraseña incorrectos.', 401);
  }
  intentos.delete(nombre);
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(16).toString('hex');
  sesiones.set(token, { usuarioId: u.id, expira: Date.now() + config.horasSesion * 3600e3, csrf });
  const seguro = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.horasSesion * 3600}${seguro}`);
  auditoria.registrar({ usuarioId: u.id, accion: 'LOGIN', ip });
  return { usuario: publico(u), csrf };
}

function cerrarSesion(req, res) {
  const t = leerCookie(req, COOKIE);
  const s = t && sesiones.get(t);
  if (s) auditoria.registrar({ usuarioId: s.usuarioId, accion: 'LOGOUT', ip: req.ip });
  if (t) sesiones.delete(t);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

const publico = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, area_id: u.area_id });

// Middleware: exige sesión válida y, en métodos que modifican datos, el token CSRF
function requerir(...roles) {
  return (req, res, next) => {
    const t = leerCookie(req, COOKIE);
    const s = t && sesiones.get(t);
    if (!s || s.expira < Date.now()) {
      if (t) sesiones.delete(t);
      return res.status(401).json({ error: 'Tu sesión expiró. Ingresa nuevamente.' });
    }
    const u = db.uno('SELECT * FROM usuario WHERE id = ? AND activo = 1', s.usuarioId);
    if (!u) return res.status(401).json({ error: 'Usuario inactivo.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-CSRF-Token') !== s.csrf) {
      return res.status(403).json({ error: 'Solicitud no válida (CSRF).' });
    }
    if (roles.length && !roles.includes(u.rol)) return res.status(403).json({ error: 'No tienes permiso para esta opción.' });
    s.expira = Date.now() + config.horasSesion * 3600e3; // expiración deslizante
    req.usuario = publico(u);
    req.csrf = s.csrf;
    next();
  };
}

function sesionActual(req) {
  const t = leerCookie(req, COOKIE);
  const s = t && sesiones.get(t);
  if (!s || s.expira < Date.now()) return null;
  const u = db.uno('SELECT * FROM usuario WHERE id = ? AND activo = 1', s.usuarioId);
  return u ? { usuario: publico(u), csrf: s.csrf } : null;
}

module.exports = { iniciarSesion, cerrarSesion, requerir, sesionActual };
