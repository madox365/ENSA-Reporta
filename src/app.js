'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const inc = require('./servicios/incidencias');
const ind = require('./servicios/indicadores');
const adm = require('./servicios/administracion');
const auditoria = require('./servicios/auditoria');
const clientes = require('./servicios/clientes');
const despacho = require('./servicios/despacho');
const { ErrorNegocio } = require('./util');

function limitador(max, minutos) {
  const reg = new Map();
  return (req, res, next) => {
    const ahora = Date.now(), clave = req.ip;
    const lista = (reg.get(clave) || []).filter((t) => ahora - t < minutos * 60e3);
    if (lista.length >= max) return res.status(429).json({ error: 'Demasiados reportes desde esta conexión. Intenta en unos minutos o llama a la central.' });
    lista.push(ahora); reg.set(clave, lista);
    next();
  };
}

// Envuelve controladores para enviar errores de negocio como JSON
const h = (fn) => (req, res) => {
  try {
    const r = fn(req, res);
    if (r !== undefined && !res.headersSent) res.json(r);
  } catch (e) {
    if (e instanceof ErrorNegocio) return res.status(e.estado).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Ocurrió un error interno. Intenta nuevamente.' });
  }
};

function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.confiarProxy) app.set('trust proxy', 1);

  // Cabeceras de seguridad
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({ limit: `${Math.ceil(config.tamanoMaxFotoKB * 1.4) + 64}kb` }));

  // ------------------------------------------------------------ API pública (clientes)
  app.get('/api/publico/config', h(() => ({ telefono_emergencias: config.telefonoEmergencias, whatsapp: config.whatsapp, demo: config.demo })));
  app.get('/api/publico/catalogo', h(() => {
    const c = inc.catalogo();
    return {
      unidades: c.unidades,
      zonas: c.zonas.map(({ id, nombre, unidad, unidad_negocio_id, lat, lng }) => ({ id, nombre, unidad, unidad_negocio_id, lat, lng })),
      tipos: c.tipos.map(({ id, codigo, nombre, descripcion, plazo_horas, prioridad }) => ({ id, codigo, nombre, descripcion, plazo_horas, prioridad })),
      franjas: c.franjas,
    };
  }));
  app.post('/api/publico/ingresar', limitador(config.limiteIngresosPorIp, 10), h((req) => clientes.ingresar(req.body.suministro, req.ip)));
  app.post('/api/publico/salir', h((req) => { clientes.salir(req); return { ok: true }; }));
  app.get('/api/publico/yo', h((req) => { const c = clientes.desdeToken(req); return c ? clientes.datosPublicos(c) : { suministro: null }; }));
  app.get('/api/publico/mis-reportes', h((req) => {
    const c = clientes.desdeToken(req);
    if (!c) throw new ErrorNegocio('Ingresa con tu número de suministro.', 401);
    return clientes.misReportes(c);
  }));
  app.post('/api/publico/reportes', limitador(config.limiteReportesPorIp, config.ventanaLimiteMin), h((req, res) => {
    const canal = req.body.canal === 'APP' ? 'APP' : 'WEB';
    const cliente = clientes.desdeToken(req);
    res.status(201);
    return inc.registrarReporte(req.body, { canal, ip: req.ip, cliente });
  }));
  app.post('/api/publico/consulta', limitador(30, 10), h((req) => inc.consultaPublica(req.body.codigo, req.body.ultimos, clientes.desdeToken(req))));
  app.post('/api/publico/confirmar', limitador(30, 10), h((req) => inc.confirmar(req.body.codigo, req.body.ultimos, clientes.desdeToken(req), req.body.respuesta, req.ip)));
  app.post('/api/publico/encuesta', limitador(30, 10), h((req) => inc.responderEncuesta(req.body.codigo, req.body.ultimos, clientes.desdeToken(req), req.body, req.ip)));
  app.get('/api/suministros/:numero', auth.requerir('ADMIN', 'OPERADOR', 'DESPACHADOR'), h((req) => {
    const s = require('./db').uno('SELECT * FROM suministro WHERE numero = ?', String(req.params.numero).replace(/\D/g, ''));
    if (!s) throw new ErrorNegocio('El suministro no está en el padrón.', 404);
    return { ...s, zona: require('./db').uno('SELECT nombre FROM zona WHERE id = ?', s.zona_id).nombre };
  }));

  // Verificación de funcionamiento para el monitoreo
  app.get('/api/salud', h(() => { require('./db').uno('SELECT 1 AS ok'); return { estado: 'ok', hora: new Date().toISOString() }; }));

  // ------------------------------------------------------------ Sesión del personal
  app.post('/api/auth/login', limitador(config.limiteIngresosPorIp, 10), h((req, res) => auth.iniciarSesion(req, res, req.body.usuario, req.body.clave)));
  app.post('/api/auth/logout', h((req, res) => { auth.cerrarSesion(req, res); return { ok: true }; }));
  app.get('/api/auth/sesion', h((req) => auth.sesionActual(req) || { usuario: null }));

  // ------------------------------------------------------------ API interna
  const todos = auth.requerir();
  const operativos = auth.requerir('ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR');
  const jefe = auth.requerir('JEFE_CUADRILLA', 'ADMIN');
  const admin = auth.requerir('ADMIN');

  app.get('/api/catalogo', todos, h(() => inc.catalogo()));
  app.get('/api/incidencias', operativos, h((req) => inc.listar(req.query)));
  app.get('/api/incidencias/buscar/:codigo', operativos, h((req) => ({ id: inc.porCodigo(req.params.codigo) })));
  app.get('/api/incidencias/:id', operativos, h((req) => inc.detalle(req.params.id)));
  app.post('/api/incidencias/:id/anular', operativos, h((req) => inc.anular(req.params.id, req.body.comentario, req.usuario, req.ip)));
  // Despacho: orden de trabajo a una cuadrilla elegida de la lista
  app.get('/api/incidencias/:id/candidatos', operativos, h((req) => despacho.candidatos(req.params.id)));
  app.post('/api/incidencias/:id/asignar', operativos, h((req) => despacho.asignar(req.params.id, req.body, req.usuario, req.ip)));
  app.post('/api/incidencias/:id/validar', operativos, h((req) => despacho.validar(req.params.id, req.body, req.usuario, req.ip)));
  // Cuadrillas y contratistas
  app.get('/api/cuadrillas', auth.requerir('ADMIN', 'DESPACHADOR', 'SUPERVISOR', 'OPERADOR', 'GERENCIA'), h((req) => despacho.listarCuadrillas(req.query)));
  app.post('/api/admin/cuadrillas', admin, h((req, res) => { res.status(201); return despacho.guardarCuadrilla(req.body, req.usuario, req.ip); }));
  app.post('/api/admin/contratistas', admin, h((req, res) => { res.status(201); return despacho.guardarEmpresa(req.body, req.usuario, req.ip); }));
  // App del jefe de cuadrilla
  app.get('/api/cuadrilla/ordenes', jefe, h((req) => despacho.misOrdenes(req.usuario)));
  app.post('/api/cuadrilla/turno', jefe, h((req) => despacho.cambiarTurno(req.usuario, !!req.body.en_turno, req.ip)));
  app.post('/api/cuadrilla/ubicacion', jefe, h((req) => despacho.registrarUbicacion(req.usuario, req.body.lat, req.body.lng)));
  app.post('/api/ordenes/:id/:paso(en_camino|en_lugar|reparando|restablecer|eta)', jefe,
    h((req) => despacho.avanzar(req.params.id, req.params.paso, req.body, req.usuario, req.ip)));
  app.post('/api/incidencias/:id/fusionar', operativos, h((req) => inc.fusionar(req.params.id, req.body.destino, req.usuario, req.ip)));
  app.post('/api/reportes', auth.requerir('ADMIN', 'OPERADOR', 'DESPACHADOR'), h((req, res) => {
    const canal = ['TELEFONO', 'OFICINA', 'WHATSAPP'].includes(req.body.canal) ? req.body.canal : 'TELEFONO';
    res.status(201);
    return inc.registrarReporte({ ...req.body, consentimiento: true }, { canal, usuarioId: req.usuario.id, ip: req.ip });
  }));
  app.get('/api/fotos/:archivo', auth.requerir('ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR', 'JEFE_CUADRILLA'), (req, res) => {
    const archivo = path.basename(req.params.archivo);
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(archivo)) return res.status(404).end();
    res.sendFile(path.join(config.rutaFotos, archivo), (e) => { if (e && !res.headersSent) res.status(404).end(); });
  });

  app.get('/api/indicadores', todos, h((req) => ind.calcular(req.query)));
  app.get('/api/indicadores/csv', todos, (req, res) => {
    auditoria.registrar({ usuarioId: req.usuario.id, accion: 'EXPORTAR_CSV', detalle: JSON.stringify(req.query), ip: req.ip });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="incidencias_ensa.csv"');
    res.send(ind.csv(req.query));
  });

  app.get('/api/admin/usuarios', admin, h(() => adm.listarUsuarios()));
  app.post('/api/admin/usuarios', admin, h((req, res) => { res.status(201); return adm.crearUsuario(req.body, req.usuario, req.ip); }));
  app.put('/api/admin/usuarios/:id', admin, h((req) => adm.actualizarUsuario(req.params.id, req.body, req.usuario, req.ip)));
  app.put('/api/admin/tipos/:id', admin, h((req) => adm.actualizarTipo(req.params.id, req.body, req.usuario, req.ip)));
  app.get('/api/admin/notificaciones', auth.requerir('ADMIN', 'OPERADOR', 'DESPACHADOR'), h((req) => adm.listarNotificaciones(req.query)));
  app.get('/api/admin/auditoria', admin, h((req) => auditoria.listar(req.query)));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));

  // ------------------------------------------------------------ Archivos estáticos (PWA)
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, ruta) => { if (ruta.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get('/personal', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'personal.html')));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'La foto es muy pesada.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos no válidos.' });
    next(err);
  });
  return app;
}

module.exports = { crearApp };
