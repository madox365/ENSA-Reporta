'use strict';
// Pruebas automatizadas de ENSA Reporta (node --test). Cubren los casos de la demostración del PETI:
// corte de luz, cable caído, alumbrado público y reporte duplicado, además de seguridad y flujo de estados.
const os = require('node:os');
const path = require('node:path');
process.env.FOTOS_PATH = path.join(os.tmpdir(), `ensa-fotos-${process.pid}`);
process.env.RATE_LIMIT_REPORTES = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { sembrarCatalogo, sembrarDemo, CLAVE_DEMO } = require('../src/seed');
const { crearApp } = require('../src/app');

let servidor, base;
const zona = (nombre) => db.uno('SELECT id FROM zona WHERE nombre = ?', nombre).id;
const tipo = (codigo) => db.uno('SELECT id FROM tipo_incidencia WHERE codigo = ?', codigo).id;

async function pedir(ruta, { metodo = 'GET', datos, cookie, csrf, token } = {}) {
  const cab = { 'Content-Type': 'application/json' };
  if (cookie) cab.Cookie = cookie;
  if (csrf) cab['X-CSRF-Token'] = csrf;
  if (token) cab.Authorization = `Bearer ${token}`;
  const r = await fetch(base + ruta, { method: metodo, headers: cab, body: datos ? JSON.stringify(datos) : undefined });
  const tipoC = r.headers.get('content-type') || '';
  return { estado: r.status, cuerpo: tipoC.includes('json') ? await r.json() : await r.text(), cab: r.headers };
}
async function login(usuario) {
  const r = await pedir('/api/auth/login', { metodo: 'POST', datos: { usuario, clave: CLAVE_DEMO } });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  return { cookie: r.cab.get('set-cookie').split(';')[0], csrf: r.cuerpo.csrf };
}
const reporte = (extra) => ({
  nombre: 'Cliente de Prueba', telefono: '987111222', consentimiento: true, ...extra,
});

before(async () => {
  db.abrir(':memory:');
  sembrarCatalogo();
  sembrarDemo();
  // Las pruebas trabajan sobre incidencias propias: se cierran las abiertas de los datos de demostración
  db.ejecutar("UPDATE incidencia SET estado = 'SOLUCIONADA', fecha_solucion = fecha_limite WHERE estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION')");
  await new Promise((ok) => { servidor = crearApp().listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.close(); db.cerrar(); });

// ----------------------------------------------------------------- casos de la demostración
test('CP-01 Corte de luz: el cliente reporta y recibe número de seguimiento', async () => {
  const r = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('La Victoria'), direccion: 'Av. Sáenz Peña 1450', lat: -6.7905, lng: -79.8372 }) });
  assert.equal(r.estado, 201);
  assert.match(r.cuerpo.numero_seguimiento, /^RP-\d{4}-\d{6}$/);
  assert.match(r.cuerpo.incidencia, /^INC-\d{4}-\d{6}$/);
  assert.equal(r.cuerpo.agrupado, false);
  assert.equal(r.cuerpo.estado, 'REGISTRADA');
  const inc = db.uno('SELECT * FROM incidencia WHERE codigo = ?', r.cuerpo.incidencia);
  assert.equal(inc.prioridad, 'ALTA');
  const notif = db.todos('SELECT n.* FROM notificacion n JOIN reporte r ON r.id = n.reporte_id WHERE r.codigo = ?', r.cuerpo.numero_seguimiento);
  assert.ok(notif.some((n) => n.canal === 'SMS' && n.destino === '987111222'), 'se envía SMS de confirmación');
});

test('CP-02 Cable caído: prioridad crítica, plazo de 3 h y área de Operaciones', async () => {
  const r = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CABLE'), zona_id: zona('José Leonardo Ortiz'), direccion: 'Calle Los Pinos 220', referencia: 'frente al colegio' }) });
  assert.equal(r.estado, 201);
  const inc = db.uno('SELECT i.*, a.codigo AS area FROM incidencia i JOIN area a ON a.id = i.area_id WHERE i.codigo = ?', r.cuerpo.incidencia);
  assert.equal(inc.prioridad, 'CRITICA');
  assert.equal(inc.area, 'OPE');
  assert.equal(Math.round((new Date(inc.fecha_limite) - new Date(inc.fecha_registro)) / 3600e3), 3);
});

test('CP-03 Alumbrado público: se asigna al área de Alumbrado Público', async () => {
  const r = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('ALUMBRADO'), zona_id: zona('Pimentel'), direccion: 'Malecón Seoane cuadra 3', lat: -6.8370, lng: -79.9345 }) });
  assert.equal(r.estado, 201);
  const inc = db.uno('SELECT a.codigo AS area, i.prioridad FROM incidencia i JOIN area a ON a.id = i.area_id WHERE i.codigo = ?', r.cuerpo.incidencia);
  assert.equal(inc.area, 'ALP');
  assert.equal(inc.prioridad, 'MEDIA');
});

test('CP-04 Reporte duplicado por GPS: se agrupa en la misma incidencia', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('ALUMBRADO'), zona_id: zona('Chiclayo (Cercado)'), direccion: 'Calle Torres Paz 500', lat: -6.7731, lng: -79.8452 }) });
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('ALUMBRADO'), zona_id: zona('Chiclayo (Cercado)'), direccion: 'Torres Paz cuadra 5', telefono: '955333444', lat: -6.7733, lng: -79.8453 }) });
  assert.equal(b.cuerpo.agrupado, true);
  assert.equal(b.cuerpo.incidencia, a.cuerpo.incidencia);
  assert.equal(b.cuerpo.cantidad_reportes, 2);
  assert.notEqual(b.cuerpo.numero_seguimiento, a.cuerpo.numero_seguimiento, 'cada cliente tiene su propio número');
  assert.match(b.cuerpo.criterio, /a \d+ m/);
});

test('CP-05 Reporte duplicado sin GPS: se agrupa por dirección parecida', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('POSTE'), zona_id: zona('Ferreñafe'), direccion: 'Av. Augusto B. Leguía 456' }) });
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('POSTE'), zona_id: zona('Ferreñafe'), direccion: 'Avenida Augusto B Leguia 456', telefono: '944555666' }) });
  assert.equal(b.cuerpo.agrupado, true);
  assert.equal(b.cuerpo.incidencia, a.cuerpo.incidencia);
  assert.match(b.cuerpo.criterio, /dirección similar/);
});

test('CP-06 No agrupa fallas de distinto tipo ni lejanas', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CABLE'), zona_id: zona('Lambayeque'), direccion: 'Calle Huáscar 100', lat: -6.7000, lng: -79.9050 }) });
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('POSTE'), zona_id: zona('Lambayeque'), direccion: 'Calle Huáscar 100', lat: -6.7000, lng: -79.9050 }) });
  const c = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CABLE'), zona_id: zona('Lambayeque'), direccion: 'Calle Tacna 900', lat: -6.7100, lng: -79.9150 }) });
  assert.notEqual(b.cuerpo.incidencia, a.cuerpo.incidencia);
  assert.notEqual(c.cuerpo.incidencia, a.cuerpo.incidencia);
});

// ----------------------------------------------------------------- ingreso con suministro
test('CP-07 Ingreso con suministro: datos correctos e incorrectos', async () => {
  const mal = await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234567', documento: '11111111' } });
  assert.equal(mal.estado, 401);
  const ok = await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234567', documento: '45678912' } });
  assert.equal(ok.estado, 200);
  assert.equal(ok.cuerpo.cliente.zona, 'Chiclayo (Cercado)');
  assert.equal(ok.cuerpo.cliente.titular, 'María C. L.', 'el nombre se muestra enmascarado');
});

test('CP-08 Cortes de clientes de la misma subestación se agrupan aunque vivan en calles distintas', async () => {
  const s1 = (await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234567', documento: '45678912' } })).cuerpo.token;
  const s2 = (await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234568', documento: '41234567' } })).cuerpo.token;
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', token: s1, datos: { tipo_id: tipo('CORTE'), usar_direccion_suministro: true, consentimiento: true } });
  assert.equal(a.estado, 201, JSON.stringify(a.cuerpo));
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', token: s2, datos: { tipo_id: tipo('CORTE'), usar_direccion_suministro: true, consentimiento: true } });
  assert.equal(b.cuerpo.agrupado, true);
  assert.equal(b.cuerpo.incidencia, a.cuerpo.incidencia);
  assert.match(b.cuerpo.criterio, /misma subestación SED-CHI-1101/);
  // Datos tomados del padrón
  const rep = db.uno('SELECT * FROM reporte WHERE codigo = ?', a.cuerpo.numero_seguimiento);
  assert.equal(rep.nombre, 'María Chapoñán Llontop');
  assert.equal(rep.telefono, '987654321');
  assert.equal(rep.autenticado, 1);
  // Mis reportes y consulta sin dígitos del celular
  const mis = await pedir('/api/publico/mis-reportes', { token: s1 });
  assert.ok(mis.cuerpo.some((x) => x.codigo === a.cuerpo.numero_seguimiento));
  const c = await pedir('/api/publico/consulta', { metodo: 'POST', token: s1, datos: { codigo: a.cuerpo.numero_seguimiento } });
  assert.equal(c.estado, 200);
});

// ----------------------------------------------------------------- consulta pública
test('CP-09 Consulta del cliente: exige los 4 últimos dígitos del celular', async () => {
  const r = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('TENSION'), zona_id: zona('Motupe'), direccion: 'Calle Arica 77', telefono: '912345678' }) });
  const mal = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: r.cuerpo.numero_seguimiento, ultimos: '0000' } });
  assert.equal(mal.estado, 404);
  const ok = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: r.cuerpo.numero_seguimiento, ultimos: '5678' } });
  assert.equal(ok.estado, 200);
  assert.equal(ok.cuerpo.estado, 'REGISTRADA');
  assert.equal(ok.cuerpo.nombre, undefined, 'no expone datos personales');
});

test('CP-10 Validaciones: celular, consentimiento y foto falsa', async () => {
  const sinTel = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Reque'), direccion: 'Calle Real 1', telefono: '12' }) });
  assert.equal(sinTel.estado, 400);
  const sinConsent = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Reque'), direccion: 'Calle Real 1', consentimiento: false }) });
  assert.equal(sinConsent.estado, 400);
  const foto = `data:image/jpeg;base64,${Buffer.from('<?php echo 1; ?>').toString('base64')}`;
  const fotoFalsa = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Reque'), direccion: 'Calle Real 1', foto }) });
  assert.equal(fotoFalsa.estado, 400);
});

// ----------------------------------------------------------------- flujo de atención
test('CP-11 Flujo completo: asignar, en atención, solucionar y avisar a todos los que reportaron', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Tumán'), direccion: 'Calle Principal 10', lat: -6.7470, lng: -79.7030, telefono: '911000001' }) });
  await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Tumán'), direccion: 'Calle Principal 30', lat: -6.7473, lng: -79.7032, telefono: '911000002' }) });
  const id = db.uno('SELECT id FROM incidencia WHERE codigo = ?', a.cuerpo.incidencia).id;
  const op = await login('operador.atc');
  const sup = await login('supervisor.ope');
  const alp = await login('supervisor.alp');

  let r = await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...op, datos: { area_id: 1, cuadrilla: 'Cuadrilla Emergencias 01' } });
  assert.equal(r.estado, 200); assert.equal(r.cuerpo.estado, 'ASIGNADA');
  r = await pedir(`/api/incidencias/${id}/iniciar`, { metodo: 'POST', ...op, datos: {} });
  assert.equal(r.estado, 403, 'el operador no inicia la atención');
  r = await pedir(`/api/incidencias/${id}/iniciar`, { metodo: 'POST', ...alp, datos: {} });
  assert.equal(r.estado, 403, 'un supervisor de otra área no puede operar');
  r = await pedir(`/api/incidencias/${id}/iniciar`, { metodo: 'POST', ...sup, datos: {} });
  assert.equal(r.cuerpo.estado, 'EN_ATENCION');
  r = await pedir(`/api/incidencias/${id}/solucionar`, { metodo: 'POST', ...sup, datos: {} });
  assert.equal(r.estado, 400, 'exige describir la solución');
  r = await pedir(`/api/incidencias/${id}/solucionar`, { metodo: 'POST', ...sup, datos: { detalle_solucion: 'Se cambió el fusible de la SED' } });
  assert.equal(r.cuerpo.estado, 'SOLUCIONADA');
  r = await pedir(`/api/incidencias/${id}/anular`, { metodo: 'POST', ...sup, datos: { comentario: 'x' } });
  assert.equal(r.estado, 409, 'no se anula una incidencia solucionada');
  const avisos = db.todos(`SELECT n.destino FROM notificacion n JOIN reporte r ON r.id = n.reporte_id
                           WHERE r.incidencia_id = ? AND n.mensaje LIKE '%solucionada%'`, id).map((x) => x.destino);
  assert.deepEqual(avisos.sort(), ['911000001', '911000002']);
  const hist = db.todos('SELECT estado_nuevo FROM historial WHERE incidencia_id = ? ORDER BY id', id).map((x) => x.estado_nuevo);
  assert.deepEqual(hist.filter((e, i) => e !== hist[i - 1]), ['REGISTRADA', 'ASIGNADA', 'EN_ATENCION', 'SOLUCIONADA']);
});

test('CP-12 Fusión manual de un duplicado que el sistema no detectó', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('ALUMBRADO'), zona_id: zona('Monsefú'), direccion: 'Plaza de Armas de Monsefú' }) });
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('ALUMBRADO'), zona_id: zona('Monsefú'), direccion: 'Frente a la iglesia', telefono: '922000111' }) });
  assert.notEqual(a.cuerpo.incidencia, b.cuerpo.incidencia);
  const op = await login('operador.atc');
  const idB = db.uno('SELECT id FROM incidencia WHERE codigo = ?', b.cuerpo.incidencia).id;
  const r = await pedir(`/api/incidencias/${idB}/fusionar`, { metodo: 'POST', ...op, datos: { destino: a.cuerpo.incidencia } });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.cantidad_reportes, 2);
  const rep = db.uno('SELECT * FROM reporte WHERE codigo = ?', b.cuerpo.numero_seguimiento);
  assert.equal(rep.tipo_agrupacion, 'MANUAL');
  const c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: b.cuerpo.numero_seguimiento, ultimos: '0111' } });
  assert.equal(c.cuerpo.incidencia, a.cuerpo.incidencia, 'el cliente sigue su reporte en la incidencia destino');
});

test('CP-13 Registro telefónico por Atención al Cliente', async () => {
  const op = await login('operador.atc');
  const r = await pedir('/api/reportes', { metodo: 'POST', ...op, datos: { canal: 'TELEFONO', tipo_id: tipo('CABLE'), zona_id: zona('Olmos'), direccion: 'Carretera a Jaén km 2', nombre: 'Segundo Távara', telefono: '966777888' } });
  assert.equal(r.estado, 201);
  const rep = db.uno('SELECT * FROM reporte WHERE codigo = ?', r.cuerpo.numero_seguimiento);
  assert.equal(rep.canal, 'TELEFONO');
  assert.ok(rep.registrado_por);
  const ger = await login('gerencia');
  const g = await pedir('/api/reportes', { metodo: 'POST', ...ger, datos: { canal: 'TELEFONO' } });
  assert.equal(g.estado, 403, 'gerencia no registra reportes');
});

// ----------------------------------------------------------------- seguridad
test('CP-14 Seguridad: sin sesión, sin CSRF, bloqueo por intentos y cabeceras', async () => {
  assert.equal((await pedir('/api/incidencias')).estado, 401);
  const op = await login('operador.atc');
  const sinCsrf = await pedir('/api/reportes', { metodo: 'POST', cookie: op.cookie, datos: {} });
  assert.equal(sinCsrf.estado, 403);
  for (let k = 0; k < 5; k++) await pedir('/api/auth/login', { metodo: 'POST', datos: { usuario: 'supervisor.man', clave: 'incorrecta' } });
  const bloqueado = await pedir('/api/auth/login', { metodo: 'POST', datos: { usuario: 'supervisor.man', clave: CLAVE_DEMO } });
  assert.equal(bloqueado.estado, 429);
  const r = await pedir('/');
  assert.equal(r.cab.get('x-frame-options'), 'DENY');
  assert.ok(r.cab.get('content-security-policy').includes("default-src 'self'"));
  const admin = db.todos("SELECT accion FROM auditoria WHERE accion = 'LOGIN_FALLIDO'");
  assert.ok(admin.length >= 5, 'los intentos fallidos quedan en auditoría');
});

// ----------------------------------------------------------------- indicadores
test('CP-15 Tablero: calcula los tres KPI del PETI y exporta CSV', async () => {
  const ger = await login('gerencia');
  const r = await pedir('/api/indicadores', ger);
  assert.equal(r.estado, 200);
  const k = r.cuerpo.kpi;
  for (const c of ['tiempo_medio_atencion_h', 'pct_en_plazo', 'pct_duplicados_agrupados_auto']) assert.equal(typeof k[c], 'number', c);
  assert.ok(k.pct_en_plazo >= 0 && k.pct_en_plazo <= 100);
  assert.equal(k.meta_en_plazo, 90);
  const csv = await pedir('/api/indicadores/csv', ger);
  assert.equal(csv.estado, 200);
  assert.ok(csv.cuerpo.split('\n')[0].includes('codigo;tipo;unidad'));
});
