'use strict';
// Despacho y atención en campo (MAPRO P12.01 Gestión de la operación / P12.02 Gestión del mantenimiento)
//
//  1. El Centro de Control de Operaciones (emergencias) o el supervisor del área (alumbrado, redes) emite una
//     ORDEN DE TRABAJO a una cuadrilla elegida de una lista: propia de ENSA o de una empresa contratista.
//  2. El jefe de cuadrilla, desde su celular, marca: en camino (con hora estimada de llegada), en el lugar,
//     reparando y servicio restablecido (causa, trabajo realizado y foto).
//  3. El supervisor del área valida el cierre o lo devuelve a la cuadrilla.
//  4. El cliente sigue cada paso y confirma si volvió el servicio; si responde que no, la incidencia se reabre.
const db = require('../db');
const notif = require('./notificaciones');
const auditoria = require('./auditoria');
const inc$ = require('./incidencias');
const { iso, distanciaM, horasEntre, ErrorNegocio, texto, opcional, numero } = require('../util');

const OT_ACTIVAS = ['EN_CAMINO', 'EN_LUGAR', 'REPARANDO'];
const OT_PENDIENTES = ['ASIGNADA', ...OT_ACTIVAS];
// Velocidad media de desplazamiento por unidad de negocio (km/h) y factor de recorrido por calles
const VELOCIDAD = { CHI: 25, SUC: 35, CAJ: 30 };
const FACTOR_RUTA = 1.3;
const MINUTOS_ALISTAMIENTO = 5;

const historial = (incId, antes, despues, comentario, usuarioId, fecha) => db.ejecutar(
  'INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
  incId, antes, despues, comentario, usuarioId, fecha,
);

// ---------------------------------------------------------------- cuadrillas
function estadoCuadrilla(c) {
  if (!c.activo) return 'INACTIVA';
  if (!c.en_turno) return 'FUERA_DE_TURNO';
  const activa = db.uno(`SELECT id FROM orden_trabajo WHERE cuadrilla_id = ? AND estado IN ('EN_CAMINO','EN_LUGAR','REPARANDO')`, c.id);
  return activa ? 'EN_SERVICIO' : 'DISPONIBLE';
}

function enriquecer(c) {
  const ordenes = db.todos(
    `SELECT ot.id, ot.codigo, ot.estado, ot.eta, i.codigo AS incidencia, i.id AS incidencia_id, t.nombre AS tipo, i.prioridad
       FROM orden_trabajo ot JOIN incidencia i ON i.id = ot.incidencia_id JOIN tipo_incidencia t ON t.id = i.tipo_id
      WHERE ot.cuadrilla_id = ? AND ot.estado IN ('ASIGNADA','EN_CAMINO','EN_LUGAR','REPARANDO')
      ORDER BY CASE WHEN ot.estado = 'ASIGNADA' THEN 1 ELSE 0 END, ot.fecha_asignacion`, c.id,
  );
  return {
    ...c,
    estado: estadoCuadrilla(c),
    orden_activa: ordenes.find((o) => OT_ACTIVAS.includes(o.estado)) || null,
    en_cola: ordenes.filter((o) => o.estado === 'ASIGNADA').length,
    ordenes,
  };
}

const SQL_CUADRILLA = `
  SELECT c.*, e.nombre AS empresa, e.contrato, a.nombre AS area, a.codigo AS area_codigo, u.nombre AS unidad, u.codigo AS unidad_codigo,
         z.nombre AS zona_base, z.lat AS base_lat, z.lng AS base_lng, j.nombre AS jefe, j.usuario AS jefe_usuario
    FROM cuadrilla c LEFT JOIN empresa_contratista e ON e.id = c.empresa_id JOIN area a ON a.id = c.area_id
    JOIN unidad_negocio u ON u.id = c.unidad_negocio_id LEFT JOIN zona z ON z.id = c.zona_base_id
    LEFT JOIN usuario j ON j.id = c.jefe_usuario_id`;

function listarCuadrillas(f = {}) {
  const cond = ['c.activo = 1'], p = [];
  if (f.area_id) { cond.push('c.area_id = ?'); p.push(Number(f.area_id)); }
  if (f.unidad_id) { cond.push('c.unidad_negocio_id = ?'); p.push(Number(f.unidad_id)); }
  return db.todos(`${SQL_CUADRILLA} WHERE ${cond.join(' AND ')} ORDER BY u.id, a.id, c.codigo`, ...p).map(enriquecer);
}

function cuadrillaPorId(id) {
  const c = db.uno(`${SQL_CUADRILLA} WHERE c.id = ?`, Number(id));
  if (!c) throw new ErrorNegocio('Cuadrilla no encontrada.', 404);
  return enriquecer(c);
}

function etaMinutos(distKm, unidadCodigo) {
  const v = VELOCIDAD[unidadCodigo] || 30;
  return Math.max(MINUTOS_ALISTAMIENTO, Math.ceil(((distKm * FACTOR_RUTA) / v) * 60) + MINUTOS_ALISTAMIENTO);
}

// Punto de la falla: ubicación GPS de la incidencia o, si no tiene, el centro de su zona
function puntoIncidencia(inc) {
  if (inc.lat != null) return { lat: inc.lat, lng: inc.lng };
  const z = db.uno('SELECT lat, lng FROM zona WHERE id = ?', inc.zona_id);
  return { lat: z.lat, lng: z.lng };
}
function puntoCuadrilla(c) {
  if (c.lat != null) return { lat: c.lat, lng: c.lng };
  return { lat: c.base_lat, lng: c.base_lng };
}

// Cuadrillas que pueden atender una incidencia: misma especialidad (área); primero las disponibles y más cercanas
// Especialidad de cada cuadrilla (prefijo del código) y cuáles atienden primero cada tipo de falla
const ESPECIALIDADES = { EM: 'Emergencias', LE: 'Líneas energizadas', AP: 'Alumbrado público', MR: 'Mantenimiento de redes' };
const PREFERENCIA = { CORTE: ['EM', 'LE'], TENSION: ['EM', 'LE'], CABLE: ['EM', 'LE'], ALUMBRADO: ['AP'], POSTE: ['MR', 'LE'] };
const especialidadDe = (codigo) => String(codigo || '').split('-')[0].toUpperCase();

function candidatos(incidenciaId) {
  const inc = db.uno(`SELECT i.*, z.unidad_negocio_id, t.codigo AS tipo_codigo FROM incidencia i JOIN zona z ON z.id = i.zona_id
                       JOIN tipo_incidencia t ON t.id = i.tipo_id WHERE i.id = ?`, Number(incidenciaId));
  const pref = PREFERENCIA[inc ? inc.tipo_codigo : ''] || [];
  const rango = (codigo) => { const k = pref.indexOf(especialidadDe(codigo)); return k < 0 ? pref.length : k; };
  if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
  const p = puntoIncidencia(inc);
  const orden = { DISPONIBLE: 0, EN_SERVICIO: 1, FUERA_DE_TURNO: 2 };
  return listarCuadrillas({ area_id: inc.area_id })
    .map((c) => {
      const q = puntoCuadrilla(c);
      const dist = q.lat != null && p.lat != null ? distanciaM(p.lat, p.lng, q.lat, q.lng) / 1000 : null;
      return {
        id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, empresa: c.empresa, unidad: c.unidad, jefe: c.jefe,
        estado: c.estado, en_cola: c.en_cola, orden_activa: c.orden_activa ? c.orden_activa.incidencia : null,
        misma_unidad: c.unidad_negocio_id === inc.unidad_negocio_id,
        especialidad: ESPECIALIDADES[especialidadDe(c.codigo)] || null,
        recomendada: rango(c.codigo) === 0,
        rango_especialidad: rango(c.codigo),
        distancia_km: dist == null ? null : Math.round(dist * 10) / 10,
        eta_min: dist == null ? null : etaMinutos(dist, c.unidad_codigo),
        ubicacion_hace_min: c.fecha_ubicacion ? Math.round(horasEntre(c.fecha_ubicacion, iso()) * 60) : null,
      };
    })
    // Primero la unidad de negocio, luego la especialidad que atiende ese tipo de falla, la disponibilidad y la distancia
    .sort((a, b) => (b.misma_unidad - a.misma_unidad) || (a.rango_especialidad - b.rango_especialidad) || (orden[a.estado] - orden[b.estado])
      || (a.en_cola - b.en_cola) || ((a.distancia_km ?? 1e9) - (b.distancia_km ?? 1e9)));
}

// ---------------------------------------------------------------- orden de trabajo
function asignar(incidenciaId, datos, usuario, ip = null) {
  if (!['ADMIN', 'DESPACHADOR', 'SUPERVISOR'].includes(usuario.rol)) {
    throw new ErrorNegocio('Las órdenes de trabajo las emite el Centro de Control de Operaciones o el supervisor del área.', 403);
  }
  return db.transaccion(() => {
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(incidenciaId));
    if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
    if (!inc$.esDeSuArea(usuario, inc)) throw new ErrorNegocio('Esta incidencia la despacha otra área.', 403);
    if (!['REGISTRADA', 'ASIGNADA', 'EN_CAMINO'].includes(inc.estado)) {
      throw new ErrorNegocio('Solo se asigna o reasigna antes de que la cuadrilla llegue al lugar.', 409);
    }
    const c = db.uno('SELECT * FROM cuadrilla WHERE id = ? AND activo = 1', numero(datos.cuadrilla_id));
    if (!c) throw new ErrorNegocio('Elige una cuadrilla de la lista.');
    if (c.area_id !== inc.area_id) throw new ErrorNegocio('La cuadrilla no atiende este tipo de falla.');
    if (!c.en_turno) throw new ErrorNegocio('La cuadrilla está fuera de turno.', 409);
    const fecha = iso();
    const anterior = inc.orden_actual_id ? db.uno('SELECT * FROM orden_trabajo WHERE id = ?', inc.orden_actual_id) : null;
    if (anterior && OT_PENDIENTES.includes(anterior.estado)) {
      if (anterior.cuadrilla_id === c.id) throw new ErrorNegocio('La incidencia ya está asignada a esa cuadrilla.', 409);
      db.ejecutar("UPDATE orden_trabajo SET estado = 'CANCELADA', observacion = ? WHERE id = ?", `Reasignada a ${c.codigo}`, anterior.id);
    }
    const anio = new Date(fecha).getUTCFullYear();
    const codigo = `OT-${anio}-${String(db.siguiente(`OT-${anio}`)).padStart(6, '0')}`;
    const r = db.ejecutar(
      `INSERT INTO orden_trabajo (codigo, incidencia_id, cuadrilla_id, estado, instrucciones, asignada_por, fecha_asignacion)
       VALUES (?,?,?,'ASIGNADA',?,?,?)`, codigo, inc.id, c.id, opcional(datos.instrucciones, 300), usuario.id, fecha,
    );
    const otId = Number(r.lastInsertRowid);
    db.ejecutar(`UPDATE incidencia SET estado = 'ASIGNADA', orden_actual_id = ?, fecha_asignacion = COALESCE(fecha_asignacion, ?) WHERE id = ?`, otId, fecha, inc.id);
    historial(inc.id, inc.estado, 'ASIGNADA', `${anterior ? 'Reasignada' : 'Orden de trabajo'} ${codigo} a la cuadrilla ${c.codigo}`, usuario.id, fecha);
    auditoria.registrar({ usuarioId: usuario.id, accion: anterior ? 'OT_REASIGNAR' : 'OT_EMITIR', entidad: 'orden_trabajo', entidadId: otId, ip, detalle: `${codigo}: ${inc.codigo} → ${c.codigo}` });
    return db.uno('SELECT * FROM orden_trabajo WHERE id = ?', otId);
  });
}

// ---------------------------------------------------------------- jefe de cuadrilla
function cuadrillaDelJefe(usuario) {
  const c = db.uno('SELECT id FROM cuadrilla WHERE jefe_usuario_id = ? AND activo = 1', usuario.id);
  if (!c) throw new ErrorNegocio('Tu usuario no está asignado como jefe de ninguna cuadrilla.', 403);
  return cuadrillaPorId(c.id);
}

function misOrdenes(usuario) {
  const c = cuadrillaDelJefe(usuario);
  const ordenes = db.todos(
    `SELECT ot.*, i.codigo AS incidencia, i.id AS incidencia_id, i.direccion, i.lat, i.lng, i.prioridad, i.fecha_limite, i.cantidad_reportes,
            t.nombre AS tipo, t.codigo AS tipo_codigo, z.nombre AS zona
       FROM orden_trabajo ot JOIN incidencia i ON i.id = ot.incidencia_id JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
      WHERE ot.cuadrilla_id = ? AND (ot.estado IN ('ASIGNADA','EN_CAMINO','EN_LUGAR','REPARANDO')
            OR (ot.estado IN ('RESTABLECIDA','VALIDADA') AND ot.fecha_restablecida >= ?))
      ORDER BY CASE WHEN ot.estado IN ('EN_CAMINO','EN_LUGAR','REPARANDO') THEN 0 WHEN ot.estado = 'ASIGNADA' THEN 1 ELSE 2 END,
               CASE i.prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END, ot.fecha_asignacion`,
    c.id, new Date(Date.parse(iso()) - 24 * 3600e3).toISOString(),
  ).map((o) => {
    // La cuadrilla ve qué reportaron los clientes; el contacto solo si debe entrar al predio
    const reportes = db.todos('SELECT codigo, nombre, telefono, referencia, descripcion, foto, requiere_acceso, franja_horaria FROM reporte WHERE incidencia_id = ? ORDER BY fecha', o.incidencia_id);
    return {
      ...o,
      reportes: reportes.map((r) => ({
        codigo: r.codigo, referencia: r.referencia, descripcion: r.descripcion, foto: r.foto,
        requiere_acceso: !!r.requiere_acceso,
        franja: r.franja_horaria ? inc$.FRANJAS_TEXTO[r.franja_horaria] : null,
        contacto: r.requiere_acceso ? `${r.nombre} · ${r.telefono}` : null,
      })),
    };
  });
  return { cuadrilla: c, ordenes, causas: db.todos('SELECT * FROM causa ORDER BY id') };
}

function cambiarTurno(usuario, enTurno, ip = null) {
  const c = cuadrillaDelJefe(usuario);
  if (!enTurno && c.orden_activa) throw new ErrorNegocio('Termina la orden en curso antes de salir de turno.', 409);
  db.ejecutar('UPDATE cuadrilla SET en_turno = ? WHERE id = ?', enTurno ? 1 : 0, c.id);
  auditoria.registrar({ usuarioId: usuario.id, accion: enTurno ? 'CUADRILLA_INICIA_TURNO' : 'CUADRILLA_TERMINA_TURNO', entidad: 'cuadrilla', entidadId: c.id, ip, detalle: c.codigo });
  return cuadrillaPorId(c.id);
}

function registrarUbicacion(usuario, lat, lng) {
  const c = cuadrillaDelJefe(usuario);
  const la = numero(lat), ln = numero(lng);
  if (la == null || ln == null || la < -8.5 || la > -4.5 || ln < -81.5 || ln > -77.5) throw new ErrorNegocio('Ubicación fuera del ámbito de ENSA.');
  const fecha = iso();
  db.ejecutar('UPDATE cuadrilla SET lat = ?, lng = ?, fecha_ubicacion = ? WHERE id = ?', la, ln, fecha, c.id);
  db.ejecutar('INSERT INTO cuadrilla_ubicacion (cuadrilla_id, lat, lng, fecha) VALUES (?,?,?,?)', c.id, la, ln, fecha);
  // Si va en camino, la hora estimada se recalcula con la nueva posición (salvo que el jefe la haya fijado)
  const ot = db.uno("SELECT ot.*, i.lat AS ilat, i.lng AS ilng, i.zona_id FROM orden_trabajo ot JOIN incidencia i ON i.id = ot.incidencia_id WHERE ot.cuadrilla_id = ? AND ot.estado = 'EN_CAMINO'", c.id);
  if (ot && !ot.eta_manual) {
    const p = puntoIncidencia({ lat: ot.ilat, lng: ot.ilng, zona_id: ot.zona_id });
    const dist = distanciaM(la, ln, p.lat, p.lng) / 1000;
    const min = Math.max(1, Math.ceil(((dist * FACTOR_RUTA) / (VELOCIDAD[c.unidad_codigo] || 30)) * 60));
    db.ejecutar('UPDATE orden_trabajo SET eta = ?, distancia_km = ? WHERE id = ?', new Date(Date.parse(fecha) + min * 60e3).toISOString(), Math.round(dist * 10) / 10, ot.id);
  }
  return { ok: true, fecha };
}

const PASOS = {
  en_camino: { desde: ['ASIGNADA'], ot: 'EN_CAMINO', inc: 'EN_CAMINO' },
  en_lugar: { desde: ['EN_CAMINO'], ot: 'EN_LUGAR', inc: 'EN_LUGAR' },
  reparando: { desde: ['EN_LUGAR'], ot: 'REPARANDO', inc: 'REPARANDO' },
  restablecer: { desde: ['EN_LUGAR', 'REPARANDO'], ot: 'RESTABLECIDA', inc: 'RESTABLECIDA' },
  eta: { desde: ['EN_CAMINO'], ot: 'EN_CAMINO', inc: 'EN_CAMINO' },
};

function avanzar(otId, paso, datos, usuario, ip = null) {
  const regla = PASOS[paso];
  if (!regla) throw new ErrorNegocio('Acción no válida.');
  if (!['JEFE_CUADRILLA', 'ADMIN'].includes(usuario.rol)) throw new ErrorNegocio('Solo el jefe de cuadrilla registra el avance en campo.', 403);
  if (paso === 'restablecer') {
    // Se revisan el estado de la orden y los datos obligatorios antes de escribir la foto en disco
    const previa = db.uno('SELECT estado FROM orden_trabajo WHERE id = ?', Number(otId));
    if (previa && !regla.desde.includes(previa.estado)) throw new ErrorNegocio(`La orden está en estado ${previa.estado.replace('_', ' ').toLowerCase()}.`, 409);
    if (!db.uno('SELECT id FROM causa WHERE id = ?', numero(datos.causa_id))) throw new ErrorNegocio('Elige la causa de la falla.');
    if (!opcional(datos.trabajo_realizado, 500)) throw new ErrorNegocio('Describe el trabajo realizado.');
    if (!datos.foto) throw new ErrorNegocio('Adjunta una foto del trabajo terminado.');
  }
  // La foto se guarda fuera de la transacción (escritura en disco); si el cierre falla, se borra
  const foto = paso === 'restablecer' ? inc$.guardarFoto(datos.foto) : null;
  try {
    return avanzarEnBase(otId, paso, regla, datos, usuario, ip, foto);
  } catch (e) {
    inc$.borrarFoto(foto);
    throw e;
  }
}

function avanzarEnBase(otId, paso, regla, datos, usuario, ip, foto) {
  return db.transaccion(() => {
    const ot = db.uno('SELECT * FROM orden_trabajo WHERE id = ?', Number(otId));
    if (!ot) throw new ErrorNegocio('Orden de trabajo no encontrada.', 404);
    const c = db.uno(`${SQL_CUADRILLA} WHERE c.id = ?`, ot.cuadrilla_id);
    if (usuario.rol === 'JEFE_CUADRILLA' && c.jefe_usuario_id !== usuario.id) throw new ErrorNegocio('La orden es de otra cuadrilla.', 403);
    if (!regla.desde.includes(ot.estado)) throw new ErrorNegocio(`La orden está en estado ${ot.estado.replace('_', ' ').toLowerCase()}.`, 409);
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', ot.incidencia_id);
    if (inc.orden_actual_id !== ot.id) throw new ErrorNegocio('Esta orden ya no está vigente.', 409);
    const fecha = iso();
    let comentario = null;

    if (paso === 'en_camino') {
      if (!c.en_turno) throw new ErrorNegocio('Inicia tu turno para salir a atender.', 409);
      const otra = db.uno(`SELECT codigo FROM orden_trabajo WHERE cuadrilla_id = ? AND id <> ? AND estado IN ('EN_CAMINO','EN_LUGAR','REPARANDO')`, c.id, ot.id);
      if (otra) throw new ErrorNegocio(`Primero termina la orden ${otra.codigo}.`, 409);
      const la = numero(datos.lat), ln = numero(datos.lng);
      if (la != null && ln != null) {
        db.ejecutar('UPDATE cuadrilla SET lat = ?, lng = ?, fecha_ubicacion = ? WHERE id = ?', la, ln, fecha, c.id);
        db.ejecutar('INSERT INTO cuadrilla_ubicacion (cuadrilla_id, lat, lng, fecha) VALUES (?,?,?,?)', c.id, la, ln, fecha);
        c.lat = la; c.lng = ln;
      }
      const p = puntoIncidencia(inc), q = puntoCuadrilla(c);
      const dist = distanciaM(p.lat, p.lng, q.lat, q.lng) / 1000;
      const manual = numero(datos.eta_min);
      const min = manual != null && manual >= 1 && manual <= 600 ? Math.round(manual) : etaMinutos(dist, c.unidad_codigo);
      const eta = new Date(Date.parse(fecha) + min * 60e3).toISOString();
      db.ejecutar('UPDATE orden_trabajo SET estado = ?, fecha_en_camino = ?, eta = ?, eta_manual = ?, distancia_km = ? WHERE id = ?',
        'EN_CAMINO', fecha, eta, manual != null ? 1 : 0, Math.round(dist * 10) / 10, ot.id);
      comentario = `Cuadrilla ${c.codigo} en camino · llegada estimada en ${min} min`;
      for (const rep of db.todos('SELECT * FROM reporte WHERE incidencia_id = ?', inc.id)) notif.encolar(rep, notif.mensajes.enCamino(rep, c, eta));
    } else if (paso === 'eta') {
      const manual = numero(datos.eta_min);
      if (manual == null || manual < 1 || manual > 600) throw new ErrorNegocio('Indica los minutos estimados de llegada (1 a 600).');
      db.ejecutar('UPDATE orden_trabajo SET eta = ?, eta_manual = 1 WHERE id = ?', new Date(Date.parse(fecha) + manual * 60e3).toISOString(), ot.id);
      auditoria.registrar({ usuarioId: usuario.id, accion: 'OT_ETA', entidad: 'orden_trabajo', entidadId: ot.id, ip, detalle: `${ot.codigo}: ${manual} min` });
      return db.uno('SELECT * FROM orden_trabajo WHERE id = ?', ot.id);
    } else if (paso === 'en_lugar') {
      db.ejecutar("UPDATE orden_trabajo SET estado = 'EN_LUGAR', fecha_llegada = ? WHERE id = ?", fecha, ot.id);
      db.ejecutar('UPDATE incidencia SET fecha_atencion = COALESCE(fecha_atencion, ?) WHERE id = ?', fecha, inc.id);
      comentario = `Cuadrilla ${c.codigo} llegó al lugar`;
    } else if (paso === 'reparando') {
      db.ejecutar("UPDATE orden_trabajo SET estado = 'REPARANDO', fecha_reparando = ? WHERE id = ?", fecha, ot.id);
      comentario = `Cuadrilla ${c.codigo} reparando`;
    } else if (paso === 'restablecer') {
      const causa = db.uno('SELECT * FROM causa WHERE id = ?', numero(datos.causa_id));
      if (!causa) throw new ErrorNegocio('Elige la causa de la falla.');
      const trabajo = opcional(datos.trabajo_realizado, 500);
      if (!trabajo) throw new ErrorNegocio('Describe el trabajo realizado.');
      if (!foto) throw new ErrorNegocio('Adjunta una foto del trabajo terminado.');
      db.ejecutar(`UPDATE orden_trabajo SET estado = 'RESTABLECIDA', fecha_restablecida = ?, causa_id = ?, trabajo_realizado = ?, foto_cierre = ?,
                   fecha_llegada = COALESCE(fecha_llegada, ?) WHERE id = ?`, fecha, causa.id, trabajo, foto, fecha, ot.id);
      db.ejecutar('UPDATE incidencia SET fecha_atencion = COALESCE(fecha_atencion, ?), fecha_solucion = ?, detalle_solucion = ? WHERE id = ?',
        fecha, fecha, `${causa.nombre}. ${trabajo}`, inc.id);
      comentario = `Servicio restablecido por ${c.codigo} · causa: ${causa.nombre} · pendiente de validación`;
      for (const rep of db.todos('SELECT * FROM reporte WHERE incidencia_id = ?', inc.id)) notif.encolar(rep, notif.mensajes.restablecido(rep, causa));
    }
    db.ejecutar('UPDATE incidencia SET estado = ? WHERE id = ?', regla.inc, inc.id);
    historial(inc.id, inc.estado, regla.inc, comentario, usuario.id, fecha);
    auditoria.registrar({ usuarioId: usuario.id, accion: `OT_${paso.toUpperCase()}`, entidad: 'orden_trabajo', entidadId: ot.id, ip, detalle: `${ot.codigo} (${inc.codigo}): ${ot.estado} → ${regla.ot}` });
    return db.uno('SELECT * FROM orden_trabajo WHERE id = ?', ot.id);
  });
}

// ---------------------------------------------------------------- validación del supervisor
function validar(incidenciaId, datos, usuario, ip = null) {
  if (!['SUPERVISOR', 'ADMIN'].includes(usuario.rol)) throw new ErrorNegocio('El cierre lo valida el supervisor del área.', 403);
  return db.transaccion(() => {
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(incidenciaId));
    if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
    if (usuario.rol === 'SUPERVISOR' && usuario.area_id !== inc.area_id) throw new ErrorNegocio('La incidencia pertenece a otra área.', 403);
    if (inc.estado !== 'RESTABLECIDA') throw new ErrorNegocio('Solo se valida una incidencia con el servicio restablecido.', 409);
    const ot = db.uno('SELECT * FROM orden_trabajo WHERE id = ?', inc.orden_actual_id);
    const fecha = iso();
    const aprobar = datos.aprobar === true || datos.aprobar === 'true' || datos.aprobar === 1 || datos.aprobar === '1';
    if (aprobar) {
      db.ejecutar("UPDATE orden_trabajo SET estado = 'VALIDADA', validado_por = ?, fecha_validacion = ? WHERE id = ?", usuario.id, fecha, ot.id);
      db.ejecutar("UPDATE incidencia SET estado = 'SOLUCIONADA', fecha_validacion = ? WHERE id = ?", fecha, inc.id);
      historial(inc.id, 'RESTABLECIDA', 'SOLUCIONADA', `Cierre validado${opcional(datos.observacion, 300) ? `: ${datos.observacion}` : ''}`, usuario.id, fecha);
    } else {
      const obs = opcional(datos.observacion, 300);
      if (!obs) throw new ErrorNegocio('Indica por qué se devuelve la orden a la cuadrilla.');
      // La orden vuelve a la cola de la misma cuadrilla; el tiempo de solución se recalculará con el nuevo cierre
      db.ejecutar(`UPDATE orden_trabajo SET estado = 'ASIGNADA', observacion = ?, devoluciones = devoluciones + 1, fecha_en_camino = NULL,
                   eta = NULL, fecha_llegada = NULL, fecha_reparando = NULL, fecha_restablecida = NULL WHERE id = ?`, obs, ot.id);
      db.ejecutar("UPDATE incidencia SET estado = 'ASIGNADA', fecha_solucion = NULL, detalle_solucion = NULL WHERE id = ?", inc.id);
      historial(inc.id, 'RESTABLECIDA', 'ASIGNADA', `Cierre devuelto a la cuadrilla: ${obs}`, usuario.id, fecha);
    }
    auditoria.registrar({ usuarioId: usuario.id, accion: aprobar ? 'CIERRE_VALIDADO' : 'CIERRE_DEVUELTO', entidad: 'incidencia', entidadId: inc.id, ip, detalle: `${inc.codigo} · ${ot.codigo}` });
    return db.uno('SELECT * FROM incidencia WHERE id = ?', inc.id);
  });
}

// ---------------------------------------------------------------- administración de cuadrillas y contratistas
function guardarEmpresa(datos, usuario, ip = null) {
  const nombre = texto(datos.nombre, 150), servicio = texto(datos.servicio, 300);
  if (nombre.length < 3 || servicio.length < 5) throw new ErrorNegocio('Escribe el nombre de la empresa y el servicio contratado.');
  const ruc = opcional(datos.ruc, 11);
  if (ruc && !/^\d{11}$/.test(ruc)) throw new ErrorNegocio('El RUC debe tener 11 dígitos.');
  const r = db.ejecutar('INSERT INTO empresa_contratista (nombre, ruc, servicio, contrato, vigencia_hasta) VALUES (?,?,?,?,?)',
    nombre, ruc, servicio, opcional(datos.contrato, 80), opcional(datos.vigencia_hasta, 10));
  auditoria.registrar({ usuarioId: usuario.id, accion: 'CONTRATISTA_CREAR', entidad: 'empresa_contratista', entidadId: Number(r.lastInsertRowid), ip, detalle: nombre });
  return { id: Number(r.lastInsertRowid) };
}

function guardarCuadrilla(datos, usuario, ip = null) {
  const codigo = texto(datos.codigo, 20).toUpperCase();
  if (!/^[A-Z0-9-]{3,20}$/.test(codigo)) throw new ErrorNegocio('Código no válido (letras, números y guiones).');
  const tipo = datos.tipo === 'CONTRATISTA' ? 'CONTRATISTA' : 'PROPIA';
  const empresa = tipo === 'CONTRATISTA' ? db.uno('SELECT id FROM empresa_contratista WHERE id = ?', numero(datos.empresa_id)) : null;
  if (tipo === 'CONTRATISTA' && !empresa) throw new ErrorNegocio('Elige la empresa contratista.');
  const area = db.uno('SELECT id FROM area WHERE id = ?', numero(datos.area_id));
  const un = db.uno('SELECT id FROM unidad_negocio WHERE id = ?', numero(datos.unidad_negocio_id));
  if (!area || !un) throw new ErrorNegocio('Elige la especialidad y la unidad de negocio.');
  const jefe = numero(datos.jefe_usuario_id) ? db.uno("SELECT id FROM usuario WHERE id = ? AND rol = 'JEFE_CUADRILLA'", numero(datos.jefe_usuario_id)) : null;
  if (datos.jefe_usuario_id && !jefe) throw new ErrorNegocio('El jefe debe ser un usuario con rol de jefe de cuadrilla.');
  if (db.uno('SELECT 1 FROM cuadrilla WHERE codigo = ?', codigo)) throw new ErrorNegocio('Ya existe una cuadrilla con ese código.');
  const r = db.ejecutar(
    `INSERT INTO cuadrilla (codigo, nombre, tipo, empresa_id, area_id, unidad_negocio_id, zona_base_id, jefe_usuario_id, integrantes, vehiculo, en_turno)
     VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
    codigo, texto(datos.nombre, 80) || codigo, tipo, empresa ? empresa.id : null, area.id, un.id, numero(datos.zona_base_id),
    jefe ? jefe.id : null, Math.min(Math.max(numero(datos.integrantes) || 3, 1), 10), opcional(datos.vehiculo, 20),
  );
  auditoria.registrar({ usuarioId: usuario.id, accion: 'CUADRILLA_CREAR', entidad: 'cuadrilla', entidadId: Number(r.lastInsertRowid), ip, detalle: `${codigo} (${tipo})` });
  return { id: Number(r.lastInsertRowid) };
}

module.exports = {
  listarCuadrillas, cuadrillaPorId, candidatos, asignar, misOrdenes, cambiarTurno, registrarUbicacion, avanzar, validar,
  guardarEmpresa, guardarCuadrilla, etaMinutos, OT_ACTIVAS,
};
