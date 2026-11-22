'use strict';
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');

module.exports = {
  puerto: Number(process.env.PORT || 3000),
  rutaBD: process.env.DB_PATH || path.join(raiz, 'data', 'ensa-reporta.db'),
  rutaFotos: process.env.FOTOS_PATH || path.join(raiz, 'data', 'fotos'),
  horasSesion: Number(process.env.SESSION_HOURS || 8),
  // Datos de prueba: se cargan si la base está vacía y DEMO no es "0"
  demo: process.env.DEMO !== '0',
  // Contacto mostrado al cliente (configurable por ENSA)
  telefonoEmergencias: process.env.TEL_EMERGENCIAS || '0-801-71003',
  whatsapp: process.env.WHATSAPP || '982 096 595',
  // Proveedores de notificación. En el piloto quedan en bandeja (modo "registro").
  // En producción: SMS por el sistema Mensajes Ensa y correo por Office 365 (SMTP).
  modoNotificacion: process.env.NOTIF_MODE || 'registro',
  // Límite de reportes públicos por IP
  limiteReportesPorIp: Number(process.env.RATE_LIMIT_REPORTES || 10),
  ventanaLimiteMin: Number(process.env.RATE_LIMIT_MIN || 10),
  limiteIngresosPorIp: Number(process.env.RATE_LIMIT_LOGIN || 20),
  tamanoMaxFotoKB: Number(process.env.MAX_FOTO_KB || 3072),
  confiarProxy: process.env.TRUST_PROXY === '1',
};
