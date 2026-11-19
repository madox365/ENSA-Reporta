'use strict';
// Avisos al cliente. En el piloto los mensajes quedan registrados en la bandeja de envíos
// (modo "registro"). Para producción se implementan los adaptadores:
//   - SMS: servicio "Mensajes Ensa" (aplicación existente de envío de SMS a clientes).
//   - Correo: Office 365 por SMTP autenticado (smtp.office365.com:587).
const db = require('../db');
const config = require('../config');
const { iso } = require('../util');

const adaptadores = {
  registro: { sms: async () => true, email: async () => true },
};

function encolar(reporte, mensaje) {
  const fecha = iso();
  const filas = [];
  if (reporte.telefono) filas.push(['SMS', reporte.telefono]);
  if (reporte.email) filas.push(['EMAIL', reporte.email]);
  for (const [canal, destino] of filas) {
    const r = db.ejecutar(
      'INSERT INTO notificacion (reporte_id, canal, destino, mensaje, estado, fecha) VALUES (?,?,?,?,?,?)',
      reporte.id, canal, destino, mensaje, 'PENDIENTE', fecha,
    );
    despachar(Number(r.lastInsertRowid), canal, destino, mensaje);
  }
}

function despachar(id, canal, destino, mensaje) {
  const ad = adaptadores[config.modoNotificacion] || adaptadores.registro;
  const enviar = canal === 'SMS' ? ad.sms : ad.email;
  Promise.resolve()
    .then(() => enviar(destino, mensaje))
    .then((ok) => db.ejecutar('UPDATE notificacion SET estado = ? WHERE id = ?', ok ? 'ENVIADO' : 'ERROR', id))
    .catch(() => { try { db.ejecutar("UPDATE notificacion SET estado = 'ERROR' WHERE id = ?", id); } catch { /* bd cerrada */ } });
}

const mensajes = {
  registro: (rep, inc, agrupado) =>
    `ENSA: Recibimos tu reporte ${rep.codigo}.` +
    (agrupado ? ` Ya atendemos esta falla (${inc.codigo}); tu reporte se sumó a ella.` : '') +
    ' Consulta el estado en ensa-reporta con tu número de seguimiento.',
  solucion: (rep, inc) =>
    `ENSA: La falla de tu reporte ${rep.codigo} (${inc.codigo}) fue solucionada. Si el problema continúa, repórtalo de nuevo. Gracias.`,
  anulacion: (rep, motivo) =>
    `ENSA: Tu reporte ${rep.codigo} fue cerrado: ${motivo}. Para consultas llama al ${config.telefonoEmergencias}.`,
};

module.exports = { encolar, mensajes, adaptadores };
