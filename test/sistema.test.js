'use strict';
// Pruebas automatizadas de ENSA Reporta (node --test). Cubren los casos de la demostración del PETI:
// corte de luz, cable caído, alumbrado público y reporte duplicado, además de seguridad y flujo de estados.
const os = require('node:os');
const path = require('node:path');
process.env.FOTOS_PATH = path.join(os.tmpdir(), `ensa-fotos-${process.pid}`);
process.env.RATE_LIMIT_REPORTES = '1000';
process.env.RATE_LIMIT_LOGIN = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { sembrarCatalogo, sembrarDemo, CLAVE_DEMO, FOTO_DEMO } = require('../src/seed');
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
  db.ejecutar("UPDATE incidencia SET estado = 'SOLUCIONADA', fecha_solucion = fecha_limite WHERE estado IN ('REGISTRADA','ASIGNADA','EN_CAMINO','EN_LUGAR','REPARANDO','RESTABLECIDA')");
  db.ejecutar("UPDATE orden_trabajo SET estado = 'CANCELADA' WHERE estado IN ('ASIGNADA','EN_CAMINO','EN_LUGAR','REPARANDO')");
  db.ejecutar('UPDATE cuadrilla SET en_turno = 1');
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
test('CP-07 Ingreso solo con el número de suministro: existente e inexistente', async () => {
  const mal = await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '99999999' } });
  assert.equal(mal.estado, 401);
  const vacio = await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '' } });
  assert.equal(vacio.estado, 400);
  const ok = await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234567' } });
  assert.equal(ok.estado, 200);
  assert.equal(ok.cuerpo.cliente.zona, 'Chiclayo (Cercado)');
  assert.equal(ok.cuerpo.cliente.titular, 'María C. L.', 'el nombre se muestra enmascarado');
  assert.equal(ok.cuerpo.cliente.tiene_ubicacion, true, 'la ubicación se carga del padrón');
  assert.match(ok.cuerpo.cliente.telefono_registrado, /^\*+4321$/, 'el celular se muestra enmascarado');
});

test('CP-08 Cortes de clientes de la misma subestación se agrupan aunque vivan en calles distintas', async () => {
  const s1 = (await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234567' } })).cuerpo.token;
  const s2 = (await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10234568' } })).cuerpo.token;
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
const cuadrillaId = (codigo) => db.uno('SELECT id FROM cuadrilla WHERE codigo = ?', codigo).id;
const incId = (codigo) => db.uno('SELECT id FROM incidencia WHERE codigo = ?', codigo).id;
const otVigente = (codigo) => db.uno('SELECT ot.* FROM orden_trabajo ot JOIN incidencia i ON i.orden_actual_id = ot.id WHERE i.codigo = ?', codigo);

test('CP-11 Flujo completo: orden de trabajo, en camino con hora estimada, en el lugar, restablecido, validación y avisos', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Tumán'), direccion: 'Calle Principal 10', lat: -6.7470, lng: -79.7030, telefono: '911000001', alcance: 'VARIAS_CASAS' }) });
  await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Tumán'), direccion: 'Calle Principal 30', lat: -6.7473, lng: -79.7032, telefono: '911000002', alcance: 'VARIAS_CASAS' }) });
  const id = incId(a.cuerpo.incidencia);
  const op = await login('operador.atc');
  const cco = await login('despacho.cco');
  const alp = await login('supervisor.alp');
  const sup = await login('supervisor.ope');

  // Lista de cuadrillas: solo de la especialidad, primero las disponibles de la misma unidad, con contratista y distancia
  const cand = await pedir(`/api/incidencias/${id}/candidatos`, cco);
  assert.equal(cand.estado, 200);
  assert.ok(cand.cuerpo.length >= 3);
  assert.ok(cand.cuerpo.every((c) => c.codigo.startsWith('EM-') || c.codigo.startsWith('LE-')), 'solo cuadrillas de emergencias');
  assert.equal(cand.cuerpo[0].misma_unidad, true);
  assert.equal(cand.cuerpo[0].estado, 'DISPONIBLE');
  assert.ok(cand.cuerpo.some((c) => c.tipo === 'CONTRATISTA' && /demo/.test(c.empresa)), 'muestra la empresa contratista');
  assert.equal(typeof cand.cuerpo[0].eta_min, 'number');

  const em = cuadrillaId('EM-CH01');
  let r = await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...op, datos: { cuadrilla_id: em } });
  assert.equal(r.estado, 403, 'Atención al Cliente no despacha');
  r = await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...alp, datos: { cuadrilla_id: em } });
  assert.equal(r.estado, 403, 'otro supervisor no despacha emergencias');
  r = await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('AP-CH01') } });
  assert.equal(r.estado, 400, 'una cuadrilla de alumbrado no atiende cortes');
  r = await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: em } });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.match(r.cuerpo.codigo, /^OT-\d{4}-\d{6}$/);
  const ot = r.cuerpo.id;

  const otro = await login('jefe.emch02');
  r = await pedir(`/api/ordenes/${ot}/en_camino`, { metodo: 'POST', ...otro, datos: {} });
  assert.equal(r.estado, 403, 'otra cuadrilla no puede avanzar la orden');
  const jefe = await login('jefe.emch01');
  const mis = await pedir('/api/cuadrilla/ordenes', jefe);
  assert.ok(mis.cuerpo.ordenes.some((o) => o.id === ot), 'la orden aparece en el celular del jefe');
  r = await pedir(`/api/ordenes/${ot}/en_camino`, { metodo: 'POST', ...jefe, datos: { lat: -6.7714, lng: -79.8409 } });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.ok(r.cuerpo.eta && r.cuerpo.distancia_km > 5, 'calcula la hora estimada con la distancia');

  // El cliente ve la cuadrilla, la contratista y la hora estimada, nunca la ubicación
  let c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '0001' } });
  assert.equal(c.cuerpo.estado, 'EN_CAMINO');
  assert.equal(c.cuerpo.cuadrilla.codigo, 'EM-CH01');
  assert.match(c.cuerpo.cuadrilla.responsable, /Contratista de ENSA: .*demo/);
  assert.ok(c.cuerpo.cuadrilla.hora_estimada_llegada);
  assert.ok(!JSON.stringify(c.cuerpo).match(/"lat"|"lng"/), 'no expone la ubicación de la cuadrilla');
  const sms = db.uno("SELECT n.mensaje FROM notificacion n JOIN reporte r ON r.id = n.reporte_id WHERE r.codigo = ? AND n.mensaje LIKE '%en camino%'", a.cuerpo.numero_seguimiento);
  assert.match(sms.mensaje, /Llegada estimada: \d{2}:\d{2}/);

  r = await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: {} });
  assert.equal(r.estado, 409, 'no se cierra sin llegar al lugar');
  assert.equal((await pedir(`/api/ordenes/${ot}/en_lugar`, { metodo: 'POST', ...jefe, datos: {} })).estado, 200);
  assert.equal((await pedir(`/api/ordenes/${ot}/reparando`, { metodo: 'POST', ...jefe, datos: {} })).estado, 200);
  r = await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 1, trabajo_realizado: 'Cambio de fusible' } });
  assert.equal(r.estado, 400, 'exige foto del trabajo');
  r = await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 1, trabajo_realizado: 'Cambio de fusible de la SED', foto: FOTO_DEMO } });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  let i = db.uno('SELECT * FROM incidencia WHERE id = ?', id);
  assert.equal(i.estado, 'RESTABLECIDA');
  assert.ok(i.fecha_solucion && i.fecha_atencion, 'registra hora de llegada y de restablecimiento');

  // Valida el supervisor del área, no el despachador
  r = await pedir(`/api/incidencias/${id}/validar`, { metodo: 'POST', ...cco, datos: { aprobar: true } });
  assert.equal(r.estado, 403);
  r = await pedir(`/api/incidencias/${id}/validar`, { metodo: 'POST', ...sup, datos: { aprobar: true } });
  assert.equal(r.cuerpo.estado, 'SOLUCIONADA');
  const avisos = db.todos(`SELECT n.destino FROM notificacion n JOIN reporte r ON r.id = n.reporte_id
                           WHERE r.incidencia_id = ? AND n.mensaje LIKE '%Restablecimos%'`, id).map((x) => x.destino);
  assert.deepEqual(avisos.sort(), ['911000001', '911000002']);
  const hist = db.todos('SELECT estado_nuevo FROM historial WHERE incidencia_id = ? ORDER BY id', id).map((x) => x.estado_nuevo);
  assert.deepEqual(hist.filter((e, k) => e !== hist[k - 1]), ['REGISTRADA', 'ASIGNADA', 'EN_CAMINO', 'EN_LUGAR', 'REPARANDO', 'RESTABLECIDA', 'SOLUCIONADA']);
});

test('CP-16 El supervisor devuelve un cierre: la orden vuelve a la cola de la misma cuadrilla', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('TENSION'), zona_id: zona('Reque'), direccion: 'Av. Reque 210', lat: -6.8650, lng: -79.8180, alcance: 'VARIAS_CASAS' }) });
  const id = incId(a.cuerpo.incidencia);
  const cco = await login('despacho.cco'); const sup = await login('supervisor.ope'); const jefe = await login('jefe.emch02');
  const ot = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('EM-CH02') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) assert.equal((await pedir(`/api/ordenes/${ot}/${p}`, { metodo: 'POST', ...jefe, datos: {} })).estado, 200);
  await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 4, trabajo_realizado: 'Ajuste de tap', foto: FOTO_DEMO } });
  let r = await pedir(`/api/incidencias/${id}/validar`, { metodo: 'POST', ...sup, datos: { aprobar: false } });
  assert.equal(r.estado, 400, 'exige el motivo de la devolución');
  r = await pedir(`/api/incidencias/${id}/validar`, { metodo: 'POST', ...sup, datos: { aprobar: false, observacion: 'Falta medir la tensión en el punto de entrega' } });
  assert.equal(r.cuerpo.estado, 'ASIGNADA');
  assert.equal(r.cuerpo.fecha_solucion, null, 'el tiempo de solución se recalcula con el nuevo cierre');
  const o = db.uno('SELECT * FROM orden_trabajo WHERE id = ?', ot);
  assert.equal(o.estado, 'ASIGNADA'); assert.equal(o.devoluciones, 1); assert.equal(o.cuadrilla_id, cuadrillaId('EM-CH02'));
});

test('CP-17 El cliente responde que no volvió la luz: la incidencia se reabre y vuelve al despacho', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Monsefú'), direccion: 'Calle Libertad 400', telefono: '933444555', alcance: 'VARIAS_CASAS' }) });
  const id = incId(a.cuerpo.incidencia);
  const cco = await login('despacho.cco'); const jefe = await login('jefe.lech01');
  const pre = await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '4555', respuesta: 'SI' } });
  assert.equal(pre.estado, 409, 'no se confirma antes de restablecer');
  const ot = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('LE-CH01') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) await pedir(`/api/ordenes/${ot}/${p}`, { metodo: 'POST', ...jefe, datos: {} });
  await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 2, trabajo_realizado: 'Empalme de conductor', foto: FOTO_DEMO } });
  let c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '4555' } });
  assert.equal(c.cuerpo.puede_confirmar, true);
  assert.equal(c.cuerpo.causa.nombre, 'Conductor roto, flojo o desconectado');
  const r = await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '4555', respuesta: 'NO' } });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.estado, 'REGISTRADA');
  const i = db.uno('SELECT * FROM incidencia WHERE id = ?', id);
  assert.equal(i.reaperturas, 1); assert.equal(i.fecha_solucion, null); assert.equal(i.orden_actual_id, null);
  assert.equal(db.uno('SELECT estado FROM orden_trabajo WHERE id = ?', ot).estado, 'RECHAZADA');
  const otra = await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '4555', respuesta: 'SI' } });
  assert.equal(otra.estado, 409, 'mientras no se vuelva a restablecer no hay nada que confirmar');
  // Nueva orden y nuevo restablecimiento: el mismo cliente puede responder otra vez
  const ot2 = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('LE-CH01') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) await pedir(`/api/ordenes/${ot2}/${p}`, { metodo: 'POST', ...jefe, datos: {} });
  await pedir(`/api/ordenes/${ot2}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 1, trabajo_realizado: 'Cambio de fusible en la SED', foto: FOTO_DEMO } });
  c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '4555' } });
  assert.equal(c.cuerpo.puede_confirmar, true, 'su "No" anterior ya no cuenta');
  assert.equal(c.cuerpo.confirmacion, null);
  const si = await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '4555', respuesta: 'SI' } });
  assert.equal(si.estado, 200, JSON.stringify(si.cuerpo));
  assert.equal(si.cuerpo.confirmacion, 'SI');
  assert.equal(si.cuerpo.puede_confirmar, false);
});

test('CP-21 Falla en la instalación interna del cliente: no se pregunta "¿Volvió tu luz?" ni se puede reabrir', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Chota'), direccion: 'Jr. Lima 310', telefono: '922333444', alcance: 'SOLO_MI_CASA' }) });
  const id = incId(a.cuerpo.incidencia);
  const cco = await login('despacho.cco'); const jefe = await login('jefe.emca01');
  const ot = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('EM-CA01') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) await pedir(`/api/ordenes/${ot}/${p}`, { metodo: 'POST', ...jefe, datos: {} });
  const fin = await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 12, trabajo_realizado: 'Llave térmica del cliente dañada; la red de ENSA está bien', foto: FOTO_DEMO } });
  assert.equal(fin.estado, 200, JSON.stringify(fin.cuerpo));
  const c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '3444' } });
  assert.equal(c.cuerpo.causa.responsabilidad, 'CLIENTE');
  assert.equal(c.cuerpo.puede_confirmar, false);
  const r = await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '3444', respuesta: 'NO' } });
  assert.equal(r.estado, 409);
  assert.equal(db.uno('SELECT estado FROM incidencia WHERE id = ?', id).estado, 'RESTABLECIDA', 'no vuelve al despacho');
});

test('CP-22 Un vecino dice que sigue sin luz pero otro ya confirmó: se abre una incidencia solo para su predio', async () => {
  const lugar = { tipo_id: tipo('CORTE'), zona_id: zona('Cutervo'), lat: -6.3810, lng: -78.8180, alcance: 'VARIAS_CASAS' };
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ ...lugar, direccion: 'Jr. Ayacucho 120', telefono: '911000111' }) });
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ ...lugar, direccion: 'Jr. Ayacucho 140', telefono: '911000222', lat: -6.3811 }) });
  assert.equal(a.cuerpo.incidencia, b.cuerpo.incidencia, 'los dos vecinos están en la misma incidencia');
  const id = incId(a.cuerpo.incidencia);
  const cco = await login('despacho.cco'); const jefe = await login('jefe.emca02');
  const ot = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('EM-CA02') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) await pedir(`/api/ordenes/${ot}/${p}`, { metodo: 'POST', ...jefe, datos: {} });
  await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 1, trabajo_realizado: 'Cambio de fusible en la SED', foto: FOTO_DEMO } });
  assert.equal((await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: a.cuerpo.numero_seguimiento, ultimos: '0111', respuesta: 'SI' } })).estado, 200);
  const r = await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: b.cuerpo.numero_seguimiento, ultimos: '0222', respuesta: 'NO' } });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.notEqual(r.cuerpo.incidencia, a.cuerpo.incidencia, 'su reporte pasa a una incidencia nueva');
  assert.equal(r.cuerpo.estado, 'REGISTRADA');
  const general = db.uno('SELECT * FROM incidencia WHERE id = ?', id);
  assert.equal(general.estado, 'RESTABLECIDA', 'la falla del sector sigue cerrada');
  assert.equal(general.reaperturas, 0); assert.equal(general.cantidad_reportes, 1);
  const rep = db.uno('SELECT * FROM reporte WHERE codigo = ?', b.cuerpo.numero_seguimiento);
  assert.equal(rep.alcance, 'SOLO_MI_CASA');
  assert.equal(db.uno('SELECT estado FROM orden_trabajo WHERE id = ?', ot).estado, 'RESTABLECIDA', 'la orden del sector no se rechaza');
});

test('CP-23 Sugerencia de cuadrillas: primero la especialidad que atiende ese tipo de falla', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Chiclayo (Cercado)'), direccion: 'Calle Colón 500', lat: -6.7705, lng: -79.8395, alcance: 'VARIAS_CASAS' }) });
  const cco = await login('despacho.cco');
  const cand = (await pedir(`/api/incidencias/${incId(a.cuerpo.incidencia)}/candidatos`, cco)).cuerpo;
  assert.equal(cand[0].codigo.slice(0, 2), 'EM', 'una cuadrilla de emergencias va primero');
  assert.equal(cand[0].recomendada, true);
  const le = cand.findIndex((c) => c.codigo === 'LE-CH01');
  assert.ok(le > cand.findIndex((c) => c.codigo === 'EM-CH02'), 'líneas energizadas después de emergencias de la misma unidad');
  // Un cierre incompleto no deja fotos sueltas en el servidor
  const fs = require('node:fs');
  const id = incId(a.cuerpo.incidencia); const jefe = await login('jefe.emch01');
  const ot = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('EM-CH01') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) await pedir(`/api/ordenes/${ot}/${p}`, { metodo: 'POST', ...jefe, datos: {} });
  const antes = fs.existsSync(process.env.FOTOS_PATH) ? fs.readdirSync(process.env.FOTOS_PATH).length : 0;
  const r = await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 1, foto: FOTO_DEMO } });
  assert.equal(r.estado, 400);
  const despues = fs.existsSync(process.env.FOTOS_PATH) ? fs.readdirSync(process.env.FOTOS_PATH).length : 0;
  assert.equal(despues, antes);
});

test('CP-18 Disponibilidad: turno, una orden en curso por cuadrilla y cola de órdenes', async () => {
  const cco = await login('despacho.cco'); const jefe = await login('jefe.emsu01');
  const em = cuadrillaId('EM-SU01');
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CABLE'), zona_id: zona('Lambayeque'), direccion: 'Calle 8 de Octubre 100' }) });
  const b = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CABLE'), zona_id: zona('Lambayeque'), direccion: 'Av. Ramón Castilla 900' }) });
  const otA = (await pedir(`/api/incidencias/${incId(a.cuerpo.incidencia)}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: em } })).cuerpo.id;
  const otB = (await pedir(`/api/incidencias/${incId(b.cuerpo.incidencia)}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: em } })).cuerpo.id;
  assert.equal((await pedir(`/api/ordenes/${otA}/en_camino`, { metodo: 'POST', ...jefe, datos: {} })).estado, 200);
  let r = await pedir(`/api/ordenes/${otB}/en_camino`, { metodo: 'POST', ...jefe, datos: {} });
  assert.equal(r.estado, 409, 'una sola orden en curso por cuadrilla');
  const lista = (await pedir('/api/cuadrillas', cco)).cuerpo.find((x) => x.codigo === 'EM-SU01');
  assert.equal(lista.estado, 'EN_SERVICIO'); assert.equal(lista.en_cola, 1);
  r = await pedir('/api/cuadrilla/turno', { metodo: 'POST', ...jefe, datos: { en_turno: false } });
  assert.equal(r.estado, 409, 'no sale de turno con una orden en curso');
  // Otra cuadrilla fuera de turno no se puede asignar
  const jefe2 = await login('jefe.emsu02');
  assert.equal((await pedir('/api/cuadrilla/turno', { metodo: 'POST', ...jefe2, datos: { en_turno: false } })).cuerpo.estado, 'FUERA_DE_TURNO');
  const cdos = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CABLE'), zona_id: zona('Motupe'), direccion: 'Calle Real 55' }) });
  r = await pedir(`/api/incidencias/${incId(cdos.cuerpo.incidencia)}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('EM-SU02') } });
  assert.equal(r.estado, 409);
  await pedir('/api/cuadrilla/turno', { metodo: 'POST', ...jefe2, datos: { en_turno: true } });
  // Hora estimada corregida a mano por el jefe
  r = await pedir(`/api/ordenes/${otA}/eta`, { metodo: 'POST', ...jefe, datos: { eta_min: 35 } });
  assert.equal(r.cuerpo.eta_manual, 1);
});

test('CP-19 Falla solo en mi casa: pide horario si hay que entrar al predio y no se agrupa con el sector', async () => {
  const s1 = (await pedir('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: '10345678' } })).cuerpo.token;
  let r = await pedir('/api/publico/reportes', { metodo: 'POST', token: s1, datos: { tipo_id: tipo('CORTE'), usar_direccion_suministro: true, consentimiento: true, alcance: 'SOLO_MI_CASA', requiere_acceso: true } });
  assert.equal(r.estado, 400, 'exige la franja horaria');
  r = await pedir('/api/publico/reportes', { metodo: 'POST', token: s1, datos: { tipo_id: tipo('CORTE'), usar_direccion_suministro: true, consentimiento: true, alcance: 'SOLO_MI_CASA', requiere_acceso: true, franja_horaria: 'HOY_TARDE' } });
  assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.requiere_acceso, true);
  assert.match(r.cuerpo.franja_horaria, /tarde/);
  // Un vecino reporta corte del sector a pocos metros: no se mezcla con la falla individual
  const v = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('CORTE'), zona_id: zona('Lambayeque'), direccion: 'Av. Augusto B. Leguía 340', lat: -6.70252, lng: -79.90482, alcance: 'VARIAS_CASAS' }) });
  assert.notEqual(v.cuerpo.incidencia, r.cuerpo.incidencia);
  const c = await pedir('/api/publico/consulta', { metodo: 'POST', token: s1, datos: { codigo: r.cuerpo.numero_seguimiento } });
  assert.equal(c.cuerpo.requiere_presencia, true);
});

test('CP-20 Alumbrado público: lo programa el supervisor de Alumbrado, no el Centro de Control', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('ALUMBRADO'), zona_id: zona('Ferreñafe'), direccion: 'Calle Real 1020', lat: -6.6390, lng: -79.7890 }) });
  const id = incId(a.cuerpo.incidencia);
  const cco = await login('despacho.cco'); const alp = await login('supervisor.alp');
  const ap = cuadrillaId('AP-SU01');
  assert.equal((await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: ap } })).estado, 403);
  const r = await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...alp, datos: { cuadrilla_id: ap } });
  assert.equal(r.estado, 200);
  const cu = (await pedir('/api/cuadrillas', alp)).cuerpo.find((x) => x.codigo === 'AP-SU01');
  assert.equal(cu.tipo, 'CONTRATISTA'); assert.match(cu.empresa, /Sucursales.*demo/);
});

test('CP-24 Encuesta de satisfacción totalmente opcional: estrellas de atención y rapidez, una vez por reporte, y KPI en el tablero', async () => {
  const a = await pedir('/api/publico/reportes', { metodo: 'POST', datos: reporte({ tipo_id: tipo('TENSION'), zona_id: zona('Bambamarca'), direccion: 'Jr. Jorge Chávez 220', telefono: '944555666', alcance: 'VARIAS_CASAS' }) });
  const cod = a.cuerpo.numero_seguimiento; const id = incId(a.cuerpo.incidencia);
  const enc = (datos) => pedir('/api/publico/encuesta', { metodo: 'POST', datos: { codigo: cod, ultimos: '5666', ...datos } });
  assert.equal((await enc({ general: 5 })).estado, 409, 'no hay encuesta antes de restablecer');
  const cco = await login('despacho.cco'); const jefe = await login('jefe.emca01');
  const ot = (await pedir(`/api/incidencias/${id}/asignar`, { metodo: 'POST', ...cco, datos: { cuadrilla_id: cuadrillaId('EM-CA01') } })).cuerpo.id;
  for (const p of ['en_camino', 'en_lugar']) await pedir(`/api/ordenes/${ot}/${p}`, { metodo: 'POST', ...jefe, datos: {} });
  await pedir(`/api/ordenes/${ot}/restablecer`, { metodo: 'POST', ...jefe, datos: { causa_id: 4, trabajo_realizado: 'Regulación del tap del transformador', foto: FOTO_DEMO } });
  let c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: cod, ultimos: '5666' } });
  assert.equal(c.cuerpo.puede_encuestar, false, 'primero se pregunta si volvió la luz');
  await pedir('/api/publico/confirmar', { metodo: 'POST', datos: { codigo: cod, ultimos: '5666', respuesta: 'SI' } });
  c = await pedir('/api/publico/consulta', { metodo: 'POST', datos: { codigo: cod, ultimos: '5666' } });
  assert.equal(c.cuerpo.puede_encuestar, true);
  assert.equal(c.cuerpo.encuesta, null, 'si no la responde, no pasa nada');
  assert.equal((await enc({})).estado, 400, 'un envío vacío no se guarda');
  assert.equal((await enc({ general: 6 })).estado, 400);
  // Puede calificar solo la rapidez
  const r = await enc({ rapidez: '3' });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.deepEqual(r.cuerpo.encuesta, { general: null, rapidez: 3 });
  assert.equal(r.cuerpo.puede_encuestar, false);
  assert.equal((await enc({ general: 1 })).estado, 409, 'una sola encuesta por reporte');
  const e = db.uno('SELECT * FROM encuesta WHERE incidencia_id = ?', id);
  assert.equal(e.cuadrilla_id, cuadrillaId('EM-CA01'), 'se guarda la cuadrilla que atendió');
  // El personal la ve en el detalle y en el tablero
  const sup = await login('supervisor.ope');
  assert.equal((await pedir(`/api/incidencias/${id}`, sup)).cuerpo.reportes[0].encuesta.rapidez, 3);
  const t = (await pedir('/api/indicadores', await login('gerencia'))).cuerpo;
  assert.ok(t.kpi.satisfaccion_promedio >= 1 && t.kpi.satisfaccion_promedio <= 5);
  assert.ok(t.satisfaccion.rapidez_promedio >= 1);
  assert.ok(t.satisfaccion.por_cuadrilla.some((x) => x.cuadrilla === 'EM-CA01'));
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
