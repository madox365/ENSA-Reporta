'use strict';
const crypto = require('node:crypto');

// Reloj sustituible (las pruebas y los datos semilla fijan la hora)
let relojFijo = null;
const ahora = () => (relojFijo ? new Date(relojFijo) : new Date());
const fijarReloj = (d) => { relojFijo = d ? new Date(d).toISOString() : null; };
const iso = (d = ahora()) => new Date(d).toISOString();
const sumarHoras = (fechaIso, h) => new Date(new Date(fechaIso).getTime() + h * 3600e3).toISOString();
const horasEntre = (a, b) => (new Date(b) - new Date(a)) / 3600e3;

// Distancia en metros entre dos coordenadas (fórmula de Haversine)
function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Normaliza direcciones para comparar reportes sin coordenadas
const ABREV = { av: 'avenida', 'av.': 'avenida', ca: 'calle', 'ca.': 'calle', cl: 'calle', jr: 'jiron', 'jr.': 'jiron', psje: 'pasaje', 'psje.': 'pasaje', pje: 'pasaje', urb: 'urbanizacion', 'urb.': 'urbanizacion', mz: 'manzana', 'mz.': 'manzana', lt: 'lote', 'lt.': 'lote', aahh: 'asentamiento', 'pp.jj': 'pueblo joven', ppjj: 'pueblo joven', 'n°': '', nro: '', 'nro.': '', no: '' };
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'frente', 'a', 'al', 'en', 'cerca', 'altura', 'cuadra']);
function normalizarDireccion(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[\s,;#/-]+/)
    .map((p) => (p in ABREV ? ABREV[p] : p).replace(/[^a-z0-9]/g, ''))
    .filter((p) => p && !VACIAS.has(p));
}
function similitudDireccion(a, b) {
  const A = new Set(normalizarDireccion(a)), B = new Set(normalizarDireccion(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter); // índice de Jaccard
}

// Contraseñas: scrypt con sal aleatoria
function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(clave, sal, 64);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}
function verificarClave(clave, guardado) {
  const [alg, salHex, hHex] = String(guardado).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(clave, Buffer.from(salHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

class ErrorNegocio extends Error {
  constructor(mensaje, estado = 400) { super(mensaje); this.estado = estado; }
}

const texto = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const opcional = (v, max = 200) => { const t = texto(v, max); return t || null; };
const numero = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

function enmascararTelefono(t) {
  const s = String(t || '');
  return s.length >= 4 ? '*'.repeat(s.length - 3) + s.slice(-3) : s;
}

module.exports = {
  ahora, fijarReloj, iso, sumarHoras, horasEntre, distanciaM,
  normalizarDireccion, similitudDireccion, hashClave, verificarClave,
  ErrorNegocio, texto, opcional, numero, enmascararTelefono,
};
