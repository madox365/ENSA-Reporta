'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const notif = require('./notificaciones');
const auditoria = require('./auditoria');
const {
  ahora, iso, sumarHoras, horasEntre, distanciaM, similitudDireccion,
  ErrorNegocio, texto, opcional, numero,
} = require('../util');

const ABIERTOS = ['REGISTRADA', 'ASIGNADA', 'EN_ATENCION'];
const CANALES = ['WEB', 'APP', 'TELEFONO', 'OFICINA', 'WHATSAPP'];
const UMBRAL_DIRECCION = 0.5;
const TIPOS_POR_SED = ['CORTE', 'TENSION'];

// ---------------------------------------------------------------- catálogo
function catalogo() {
  return {
    unidades: db.todos('SELECT * FROM unidad_negocio ORDER BY id'),
    zonas: db.todos(`SELECT z.*, u.nombre AS unidad FROM zona z JOIN unidad_negocio u ON u.id = z.unidad_negocio_id
                     WHERE z.activo = 1 ORDER BY u.id, z.nombre`),
    tipos: db.todos(`SELECT t.*, a.nombre AS area FROM tipo_incidencia t JOIN area a ON a.id = t.area_id
                     WHERE t.activo = 1 ORDER BY t.id`),
    areas: db.todos('SELECT * FROM area ORDER BY id'),
  };
}

// ---------------------------------------------------------------- validación
function validarReporte(d, canal) {
  const errores = [];
  const tipo = db.uno('SELECT * FROM tipo_incidencia WHERE id = ? AND activo = 1', numero(d.tipo_id));
  if (!tipo) errores.push('Selecciona el tipo de incidencia.');
  const zona = db.uno('SELECT * FROM zona WHERE id = ? AND activo = 1', numero(d.zona_id));
  if (!zona) errores.push('Selecciona el distrito o zona.');
  const direccion = texto(d.direccion, 200);
  if (direccion.length < 5) errores.push('Escribe la dirección o una referencia del lugar (mínimo 5 caracteres).');
  const nombre = texto(d.nombre, 120);
  if (nombre.length < 3) errores.push('Escribe tu nombre.');
  const telefono = texto(d.telefono, 15).replace(/\D/g, '');
  if (!/^9\d{8}$/.test(telefono) && !/^0?\d{6,9}$/.test(telefono)) errores.push('Escribe un número de celular válido (9 dígitos, empieza con 9).');
  const documento = opcional(d.documento, 12);
  if (documento && !/^\d{8}$|^[A-Z0-9]{9,12}$/i.test(documento)) errores.push('El DNI debe tener 8 dígitos.');
  const email = opcional(d.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errores.push('El correo no es válido.');
  const suministro = opcional(d.suministro, 15);
  if (suministro && !/^\d{5,12}$/.test(suministro)) errores.push('El número de suministro solo lleva dígitos.');
  let lat = numero(d.lat), lng = numero(d.lng);
  if (lat != null && lng != null) {
    // Ámbito aproximado de ENSA (Lambayeque y Cajamarca norte)
    if (lat < -8.5 || lat > -4.5 || lng < -81.5 || lng > -77.5) { lat = null; lng = null; }
  } else { lat = null; lng = null; }
  if (!CANALES.includes(canal)) errores.push('Canal no válido.');
  if (canal === 'WEB' || canal === 'APP') {
    if (!(d.consentimiento === true || d.consentimiento === 'true' || d.consentimiento === 1 || d.consentimiento === '1')) {
      errores.push('Debes aceptar el tratamiento de tus datos personales para registrar el reporte.');
    }
  }
  if (errores.length) throw new ErrorNegocio(errores.join(' '));
  return {
    tipo, zona, direccion, nombre, telefono, documento, email, suministro, lat, lng,
    referencia: opcional(d.referencia, 200),
    descripcion: opcional(d.descripcion, 500),
  };
}

function guardarFoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new ErrorNegocio('La foto debe ser una imagen JPG, PNG o WEBP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > config.tamanoMaxFotoKB * 1024) throw new ErrorNegocio('La foto es muy pesada.');
  // Verifica la firma real del archivo, no solo el tipo declarado
  const firmas = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };
  if (!firmas[m[1]].every((b, i) => buf[i] === b)) throw new ErrorNegocio('El archivo de la foto no es válido.');
  fs.mkdirSync(config.rutaFotos, { recursive: true });
  const nombre = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(config.rutaFotos, nombre), buf);
  return nombre;
}

// ---------------------------------------------------------------- agrupación de duplicados
// Busca una incidencia abierta del mismo tipo y zona, dentro de la ventana de tiempo del tipo,
// que coincida por ubicación (radio), por número de suministro o por dirección parecida.
function buscarCoincidencia(tipo, zona, d, fecha) {
  const desde = sumarHoras(fecha, -tipo.ventana_agrupacion_h);
  const candidatas = db.todos(
    `SELECT * FROM incidencia WHERE tipo_id = ? AND zona_id = ? AND estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION')
       AND fecha_registro >= ? ORDER BY fecha_registro DESC`,
    tipo.id, zona.id, desde,
  );
  if (!candidatas.length) return null;
  if (tipo.radio_agrupacion_m == null) {
    return { incidencia: candidatas[0], criterio: 'misma zona' };
  }
  let mejor = null;
  for (const inc of candidatas) {
    const reps = db.todos('SELECT direccion, referencia, suministro, sed, lat, lng FROM reporte WHERE incidencia_id = ?', inc.id);
    for (const r of reps) {
      let puntaje = 0, criterio = null;
      // Cortes y variaciones de tensión: clientes de la misma subestación sufren la misma falla
      if (TIPOS_POR_SED.includes(tipo.codigo) && d.sed && r.sed && d.sed === r.sed) { puntaje = 2.5; criterio = `misma subestación ${d.sed}`; }
      if (!criterio && d.lat != null && r.lat != null) {
        const dist = distanciaM(d.lat, d.lng, r.lat, r.lng);
        if (dist <= tipo.radio_agrupacion_m) { puntaje = 2 - dist / tipo.radio_agrupacion_m; criterio = `a ${Math.round(dist)} m`; }
      }
      if (!criterio && d.suministro && r.suministro && d.suministro === r.suministro) { puntaje = 1.5; criterio = 'mismo suministro'; }
      if (!criterio) {
        const sim = Math.max(
          similitudDireccion(d.direccion, r.direccion),
          d.referencia && r.referencia ? similitudDireccion(`${d.direccion} ${d.referencia}`, `${r.direccion} ${r.referencia}`) : 0,
        );
        if (sim >= UMBRAL_DIRECCION) { puntaje = sim; criterio = `dirección similar (${Math.round(sim * 100)}%)`; }
      }
      if (criterio && (!mejor || puntaje > mejor.puntaje)) mejor = { incidencia: inc, criterio, puntaje };
    }
  }
  return mejor;
}

// ---------------------------------------------------------------- registro
function registrarReporte(datosEntrada, { canal = 'WEB', usuarioId = null, ip = null, cliente = null } = {}) {
  // Si el cliente ingresó con su suministro (o el personal lo digitó), se completan los datos con el padrón
  const datos = { ...datosEntrada };
  const vacio = (v) => v == null || String(v).trim() === '';
  let padron = null;
  if (cliente) {
    padron = cliente;
    datos.suministro = cliente.numero;
    if (vacio(datos.nombre)) datos.nombre = cliente.titular;
    if (vacio(datos.documento) && /^\d{8}$/.test(cliente.documento)) datos.documento = cliente.documento;
    if (vacio(datos.telefono) && cliente.telefono) datos.telefono = cliente.telefono;
  } else if (!vacio(datos.suministro)) {
    padron = db.uno('SELECT * FROM suministro WHERE numero = ?', String(datos.suministro).trim());
  }
  if (padron && (datos.usar_direccion_suministro || vacio(datos.direccion))) {
    datos.direccion = padron.direccion; datos.zona_id = padron.zona_id; datos.lat = padron.lat; datos.lng = padron.lng;
  }
  const d = validarReporte(datos, canal);
  d.sed = padron ? padron.sed : null;
  d.autenticado = cliente ? 1 : 0;
  const foto = guardarFoto(datos.foto);
  const fecha = iso();
  const anio = new Date(fecha).getUTCFullYear();

  const resultado = db.transaccion(() => {
    const coincidencia = buscarCoincidencia(d.tipo, d.zona, d, fecha);
    let inc;
    if (coincidencia) {
      inc = coincidencia.incidencia;
    } else {
      const codigo = `INC-${anio}-${String(db.siguiente(`INC-${anio}`)).padStart(6, '0')}`;
      const r = db.ejecutar(
        `INSERT INTO incidencia (codigo, tipo_id, zona_id, direccion, lat, lng, estado, prioridad, area_id,
           fecha_registro, fecha_limite, cantidad_reportes) VALUES (?,?,?,?,?,?,'REGISTRADA',?,?,?,?,0)`,
        codigo, d.tipo.id, d.zona.id, d.direccion + (d.referencia ? ` (${d.referencia})` : ''), d.lat, d.lng,
        d.tipo.prioridad, d.tipo.area_id, fecha, sumarHoras(fecha, d.tipo.plazo_horas),
      );
      inc = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(r.lastInsertRowid));
      db.ejecutar(
        'INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
        inc.id, null, 'REGISTRADA', `Reporte inicial por canal ${canal}`, usuarioId, fecha,
      );
    }
    const codigoRep = `RP-${anio}-${String(db.siguiente(`RP-${anio}`)).padStart(6, '0')}`;
    const r = db.ejecutar(
      `INSERT INTO reporte (codigo, incidencia_id, canal, nombre, documento, telefono, email, suministro, sed, autenticado, direccion,
         referencia, lat, lng, descripcion, foto, es_duplicado, tipo_agrupacion, consentimiento, registrado_por, fecha)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      codigoRep, inc.id, canal, d.nombre, d.documento, d.telefono, d.email, d.suministro, d.sed, d.autenticado, d.direccion,
      d.referencia, d.lat, d.lng, d.descripcion, foto, coincidencia ? 1 : 0, coincidencia ? 'AUTOMATICA' : null,
      usuarioId, fecha,
    );
    db.ejecutar('UPDATE incidencia SET cantidad_reportes = cantidad_reportes + 1 WHERE id = ?', inc.id);
    if (coincidencia) {
      db.ejecutar(
        'INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
        inc.id, inc.estado, inc.estado, `Reporte ${codigoRep} agrupado automáticamente (${coincidencia.criterio})`, usuarioId, fecha,
      );
    }
    const rep = db.uno('SELECT * FROM reporte WHERE id = ?', Number(r.lastInsertRowid));
    inc = db.uno('SELECT * FROM incidencia WHERE id = ?', inc.id);
    notif.encolar(rep, notif.mensajes.registro(rep, inc, !!coincidencia));
    auditoria.registrar({
      usuarioId, accion: 'REPORTE_REGISTRADO', entidad: 'reporte', entidadId: rep.id, ip,
      detalle: `${rep.codigo} → ${inc.codigo} (${canal}${coincidencia ? `, agrupado: ${coincidencia.criterio}` : ''})`,
    });
    return {
      numero_seguimiento: rep.codigo,
      incidencia: inc.codigo,
      agrupado: !!coincidencia,
      criterio: coincidencia ? coincidencia.criterio : null,
      cantidad_reportes: inc.cantidad_reportes,
      estado: inc.estado,
      tipo: d.tipo.nombre,
      plazo_horas: d.tipo.plazo_horas,
    };
  });
  return resultado;
}

// ---------------------------------------------------------------- consulta pública
function consultaPublica(codigo, ultimos, cliente = null) {
  const c = texto(codigo, 30).toUpperCase();
  const u = texto(ultimos, 4).replace(/\D/g, '');
  const rep = c ? db.uno('SELECT * FROM reporte WHERE codigo = ?', c) : null;
  // El titular que ingresó con su suministro consulta sus reportes sin más datos
  const esSuyo = rep && cliente && rep.suministro === cliente.numero;
  if (!esSuyo) {
    if (!c || u.length !== 4) throw new ErrorNegocio('Ingresa tu número de seguimiento y los 4 últimos dígitos de tu celular.');
    // Mismo mensaje si no existe o si el celular no coincide: no revela qué códigos existen
    if (!rep || !String(rep.telefono).endsWith(u)) throw new ErrorNegocio('No encontramos un reporte con esos datos.', 404);
  }
  let inc = db.uno('SELECT * FROM incidencia WHERE id = ?', rep.incidencia_id);
  const tipo = db.uno('SELECT nombre FROM tipo_incidencia WHERE id = ?', inc.tipo_id);
  const zona = db.uno('SELECT nombre FROM zona WHERE id = ?', inc.zona_id);
  const area = db.uno('SELECT nombre FROM area WHERE id = ?', inc.area_id);
  const linea = db.todos(
    `SELECT estado_nuevo AS estado, fecha FROM historial WHERE incidencia_id = ? AND (estado_anterior IS NULL OR estado_anterior <> estado_nuevo)
      ORDER BY fecha, id`, inc.id,
  );
  return {
    numero_seguimiento: rep.codigo,
    fecha_reporte: rep.fecha,
    incidencia: inc.codigo,
    tipo: tipo.nombre,
    zona: zona.nombre,
    estado: inc.estado,
    area: area.nombre,
    reportes_de_la_falla: inc.cantidad_reportes,
    fecha_limite: inc.fecha_limite,
    fecha_solucion: inc.fecha_solucion,
    detalle_solucion: inc.estado === 'SOLUCIONADA' ? inc.detalle_solucion : null,
    linea_tiempo: linea,
  };
}

// ---------------------------------------------------------------- bandeja y detalle
function listar(f = {}) {
  const cond = [], p = [];
  if (f.estado === 'ABIERTAS') cond.push("i.estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION')");
  else if (f.estado) { cond.push('i.estado = ?'); p.push(f.estado); }
  if (f.tipo_id) { cond.push('i.tipo_id = ?'); p.push(Number(f.tipo_id)); }
  if (f.zona_id) { cond.push('i.zona_id = ?'); p.push(Number(f.zona_id)); }
  if (f.unidad_id) { cond.push('z.unidad_negocio_id = ?'); p.push(Number(f.unidad_id)); }
  if (f.area_id) { cond.push('i.area_id = ?'); p.push(Number(f.area_id)); }
  if (f.vencidas === '1') { cond.push("i.estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION') AND i.fecha_limite < ?"); p.push(iso()); }
  if (f.desde) { cond.push('i.fecha_registro >= ?'); p.push(new Date(`${f.desde}T00:00:00-05:00`).toISOString()); }
  if (f.hasta) { cond.push('i.fecha_registro < ?'); p.push(sumarHoras(new Date(`${f.hasta}T00:00:00-05:00`).toISOString(), 24)); }
  if (f.q) {
    cond.push('(i.codigo LIKE ? OR i.direccion LIKE ? OR EXISTS (SELECT 1 FROM reporte r WHERE r.incidencia_id = i.id AND (r.codigo LIKE ? OR r.telefono LIKE ? OR r.suministro LIKE ? OR r.nombre LIKE ?)))');
    const q = `%${texto(f.q, 60)}%`;
    p.push(q, q, q, q, q, q);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const limite = Math.min(Number(f.limite) || 300, 2000);
  return db.todos(
    `SELECT i.*, t.nombre AS tipo, t.codigo AS tipo_codigo, z.nombre AS zona, u.nombre AS unidad, a.nombre AS area
       FROM incidencia i JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
       JOIN unidad_negocio u ON u.id = z.unidad_negocio_id JOIN area a ON a.id = i.area_id
       ${where}
      ORDER BY CASE WHEN i.estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION') THEN 0 ELSE 1 END,
               CASE i.prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
               i.fecha_limite ASC
      LIMIT ?`, ...p, limite,
  );
}

function detalle(id) {
  const inc = db.uno(
    `SELECT i.*, t.nombre AS tipo, t.codigo AS tipo_codigo, t.plazo_horas, z.nombre AS zona, u.nombre AS unidad, a.nombre AS area,
            f.codigo AS fusionada_en
       FROM incidencia i JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
       JOIN unidad_negocio u ON u.id = z.unidad_negocio_id JOIN area a ON a.id = i.area_id
       LEFT JOIN incidencia f ON f.id = i.fusionada_en_id
      WHERE i.id = ?`, Number(id),
  );
  if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
  inc.reportes = db.todos(
    `SELECT r.*, us.nombre AS registrado_por_nombre FROM reporte r LEFT JOIN usuario us ON us.id = r.registrado_por
      WHERE r.incidencia_id = ? ORDER BY r.fecha`, inc.id,
  );
  inc.historial = db.todos(
    `SELECT h.*, us.nombre AS usuario FROM historial h LEFT JOIN usuario us ON us.id = h.usuario_id
      WHERE h.incidencia_id = ? ORDER BY h.fecha, h.id`, inc.id,
  );
  return inc;
}

function porCodigo(codigo) {
  const c = texto(codigo, 30).toUpperCase();
  const fila = db.uno('SELECT id FROM incidencia WHERE codigo = ?', c)
    || db.uno('SELECT incidencia_id AS id FROM reporte WHERE codigo = ?', c);
  if (!fila) throw new ErrorNegocio('No existe una incidencia o reporte con ese código.', 404);
  return fila.id;
}

// ---------------------------------------------------------------- flujo de estados
const TRANSICIONES = {
  asignar: { desde: ['REGISTRADA', 'ASIGNADA'], hacia: 'ASIGNADA', roles: ['ADMIN', 'OPERADOR', 'SUPERVISOR'] },
  iniciar: { desde: ['ASIGNADA'], hacia: 'EN_ATENCION', roles: ['ADMIN', 'SUPERVISOR'] },
  solucionar: { desde: ['ASIGNADA', 'EN_ATENCION'], hacia: 'SOLUCIONADA', roles: ['ADMIN', 'SUPERVISOR'] },
  anular: { desde: ['REGISTRADA', 'ASIGNADA'], hacia: 'ANULADA', roles: ['ADMIN', 'OPERADOR', 'SUPERVISOR'] },
};

function puedeOperarArea(usuario, inc) {
  return usuario.rol !== 'SUPERVISOR' || usuario.area_id == null || usuario.area_id === inc.area_id;
}

function cambiarEstado(id, accion, datos, usuario, ip = null) {
  const regla = TRANSICIONES[accion];
  if (!regla) throw new ErrorNegocio('Acción no válida.');
  if (!regla.roles.includes(usuario.rol)) throw new ErrorNegocio('Tu rol no permite esta acción.', 403);
  return db.transaccion(() => {
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(id));
    if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
    if (!regla.desde.includes(inc.estado)) {
      throw new ErrorNegocio(`No se puede ${accion} una incidencia en estado ${inc.estado.replace('_', ' ')}.`, 409);
    }
    if (!puedeOperarArea(usuario, inc)) throw new ErrorNegocio('La incidencia pertenece a otra área.', 403);
    const fecha = iso();
    let comentario = opcional(datos.comentario, 500);
    const sets = ['estado = ?'], vals = [regla.hacia];

    if (accion === 'asignar') {
      const area = db.uno('SELECT * FROM area WHERE id = ?', numero(datos.area_id) ?? inc.area_id);
      if (!area) throw new ErrorNegocio('Área no válida.');
      const cuadrilla = opcional(datos.cuadrilla, 80);
      if (!cuadrilla) throw new ErrorNegocio('Indica la cuadrilla o responsable que atenderá la falla.');
      sets.push('area_id = ?', 'cuadrilla = ?', 'fecha_asignacion = COALESCE(fecha_asignacion, ?)');
      vals.push(area.id, cuadrilla, fecha);
      comentario = `Asignada a ${area.nombre} · ${cuadrilla}${comentario ? ` · ${comentario}` : ''}`;
    }
    if (accion === 'iniciar') {
      sets.push('fecha_atencion = ?'); vals.push(fecha);
      comentario = comentario || 'Cuadrilla en atención';
    }
    if (accion === 'solucionar') {
      const det = opcional(datos.detalle_solucion, 500);
      if (!det) throw new ErrorNegocio('Describe la solución aplicada.');
      sets.push('fecha_atencion = COALESCE(fecha_atencion, ?)', 'fecha_solucion = ?', 'detalle_solucion = ?');
      vals.push(fecha, fecha, det);
      comentario = det;
    }
    if (accion === 'anular') {
      if (!comentario) throw new ErrorNegocio('Indica el motivo de la anulación.');
    }
    db.ejecutar(`UPDATE incidencia SET ${sets.join(', ')} WHERE id = ?`, ...vals, inc.id);
    db.ejecutar(
      'INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
      inc.id, inc.estado, regla.hacia, comentario, usuario.id, fecha,
    );
    const act = db.uno('SELECT * FROM incidencia WHERE id = ?', inc.id);
    if (accion === 'solucionar' || accion === 'anular') {
      for (const rep of db.todos('SELECT * FROM reporte WHERE incidencia_id = ?', inc.id)) {
        notif.encolar(rep, accion === 'solucionar' ? notif.mensajes.solucion(rep, act) : notif.mensajes.anulacion(rep, comentario));
      }
    }
    auditoria.registrar({
      usuarioId: usuario.id, accion: `INCIDENCIA_${accion.toUpperCase()}`, entidad: 'incidencia', entidadId: inc.id, ip,
      detalle: `${inc.codigo}: ${inc.estado} → ${regla.hacia}${comentario ? ` · ${comentario}` : ''}`,
    });
    return act;
  });
}

// Fusión manual: el personal detecta un duplicado que el sistema no agrupó
function fusionar(origenId, codigoDestino, usuario, ip = null) {
  if (!['ADMIN', 'OPERADOR', 'SUPERVISOR'].includes(usuario.rol)) throw new ErrorNegocio('Tu rol no permite esta acción.', 403);
  return db.transaccion(() => {
    const origen = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(origenId));
    const destino = db.uno('SELECT * FROM incidencia WHERE codigo = ?', texto(codigoDestino, 30).toUpperCase());
    if (!origen || !destino) throw new ErrorNegocio('No se encontró una de las incidencias.', 404);
    if (origen.id === destino.id) throw new ErrorNegocio('No puedes fusionar una incidencia consigo misma.');
    if (!ABIERTOS.includes(origen.estado) || !ABIERTOS.includes(destino.estado)) throw new ErrorNegocio('Ambas incidencias deben estar abiertas.', 409);
    if (origen.tipo_id !== destino.tipo_id) throw new ErrorNegocio('Solo se fusionan incidencias del mismo tipo.');
    const fecha = iso();
    const n = db.ejecutar(
      `UPDATE reporte SET incidencia_id = ?, es_duplicado = 1, tipo_agrupacion = COALESCE(tipo_agrupacion, 'MANUAL') WHERE incidencia_id = ?`,
      destino.id, origen.id,
    ).changes;
    db.ejecutar('UPDATE incidencia SET cantidad_reportes = cantidad_reportes + ? WHERE id = ?', n, destino.id);
    db.ejecutar("UPDATE incidencia SET estado = 'ANULADA', cantidad_reportes = 0, fusionada_en_id = ? WHERE id = ?", destino.id, origen.id);
    db.ejecutar(
      'INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
      origen.id, origen.estado, 'ANULADA', `Fusionada en ${destino.codigo} (duplicado)`, usuario.id, fecha,
    );
    db.ejecutar(
      'INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
      destino.id, destino.estado, destino.estado, `Se agregaron ${n} reporte(s) de ${origen.codigo} (fusión manual)`, usuario.id, fecha,
    );
    auditoria.registrar({
      usuarioId: usuario.id, accion: 'INCIDENCIA_FUSIONAR', entidad: 'incidencia', entidadId: destino.id, ip,
      detalle: `${origen.codigo} → ${destino.codigo} (${n} reportes)`,
    });
    return db.uno('SELECT * FROM incidencia WHERE id = ?', destino.id);
  });
}

module.exports = {
  catalogo, registrarReporte, buscarCoincidencia, consultaPublica, listar, detalle, porCodigo,
  cambiarEstado, fusionar, TRANSICIONES, ABIERTOS,
};
