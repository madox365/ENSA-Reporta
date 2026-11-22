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

// Estados en los que la falla sigue sin resolverse
const ABIERTOS = ['REGISTRADA', 'ASIGNADA', 'EN_CAMINO', 'EN_LUGAR', 'REPARANDO'];
const SQL_ABIERTOS = ABIERTOS.map((e) => `'${e}'`).join(',');
// Con el servicio restablecido (validado o por validar por el supervisor)
const CON_SOLUCION = ['RESTABLECIDA', 'SOLUCIONADA'];
const ALCANCES = ['SOLO_MI_CASA', 'VARIAS_CASAS', 'NO_SE'];
const FRANJAS = ['AHORA', 'HOY_TARDE', 'HOY_NOCHE', 'MANANA_MANANA', 'MANANA_TARDE'];
const FRANJAS_TEXTO = { AHORA: 'Ahora mismo', HOY_TARDE: 'Hoy en la tarde (14:00-18:00)', HOY_NOCHE: 'Hoy en la noche (18:00-21:00)', MANANA_MANANA: 'Mañana en la mañana (8:00-12:00)', MANANA_TARDE: 'Mañana en la tarde (14:00-18:00)' };
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
    causas: db.todos('SELECT * FROM causa ORDER BY id'),
    empresas: db.todos('SELECT * FROM empresa_contratista WHERE activo = 1 ORDER BY nombre'),
    franjas: Object.entries(FRANJAS_TEXTO).map(([codigo, nombre]) => ({ codigo, nombre })),
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
  // ¿A quién afecta? Solo para fallas que pueden ser de un suministro (corte de luz, luz baja)
  let alcance = null, requiereAcceso = 0, franja = null;
  if (tipo && TIPOS_POR_SED.includes(tipo.codigo)) {
    alcance = ALCANCES.includes(d.alcance) ? d.alcance : null;
    if (alcance === 'SOLO_MI_CASA') {
      requiereAcceso = d.requiere_acceso === true || d.requiere_acceso === 'true' || d.requiere_acceso === 1 || d.requiere_acceso === '1' ? 1 : 0;
      if (requiereAcceso) {
        franja = FRANJAS.includes(d.franja_horaria) ? d.franja_horaria : null;
        if (!franja) errores.push('Indica en qué horario podrá estar alguien en el predio.');
      }
    }
  }
  if (errores.length) throw new ErrorNegocio(errores.join(' '));
  return {
    tipo, zona, direccion, nombre, telefono, documento, email, suministro, lat, lng,
    referencia: opcional(d.referencia, 200),
    descripcion: opcional(d.descripcion, 500),
    alcance, requiereAcceso, franja,
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

// Borra una foto recién guardada cuando la operación que la usaba no se completó
function borrarFoto(nombre) {
  if (!nombre || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(nombre)) return;
  try { fs.unlinkSync(path.join(config.rutaFotos, nombre)); } catch { /* ya no existe */ }
}

// ---------------------------------------------------------------- agrupación de duplicados
// Busca una incidencia abierta del mismo tipo y zona, dentro de la ventana de tiempo del tipo,
// que coincida por ubicación (radio), por número de suministro o por dirección parecida.
function buscarCoincidencia(tipo, zona, d, fecha) {
  const desde = sumarHoras(fecha, -tipo.ventana_agrupacion_h);
  const candidatas = db.todos(
    `SELECT * FROM incidencia WHERE tipo_id = ? AND zona_id = ? AND estado IN (${SQL_ABIERTOS})
       AND fecha_registro >= ? ORDER BY fecha_registro DESC`,
    tipo.id, zona.id, desde,
  );
  if (!candidatas.length) return null;
  // Si el cliente dice que la falla es solo de su casa, solo se agrupa con otro reporte del mismo suministro
  if (d.alcance === 'SOLO_MI_CASA') {
    if (!d.suministro) return null;
    for (const inc of candidatas) {
      if (db.uno('SELECT 1 FROM reporte WHERE incidencia_id = ? AND suministro = ?', inc.id, d.suministro)) {
        return { incidencia: inc, criterio: 'mismo suministro', puntaje: 1.5 };
      }
    }
    return null;
  }
  if (tipo.radio_agrupacion_m == null) {
    return { incidencia: candidatas[0], criterio: 'misma zona' };
  }
  let mejor = null;
  for (const inc of candidatas) {
    const reps = db.todos('SELECT direccion, referencia, suministro, sed, lat, lng, alcance FROM reporte WHERE incidencia_id = ?', inc.id);
    for (const r of reps) {
      let puntaje = 0, criterio = null;
      // Una falla que el cliente declaró "solo en mi casa" no absorbe reportes de otros suministros
      if (r.alcance === 'SOLO_MI_CASA' && !(d.suministro && r.suministro === d.suministro)) continue;
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
         referencia, lat, lng, descripcion, foto, es_duplicado, tipo_agrupacion, alcance, requiere_acceso, franja_horaria,
         consentimiento, registrado_por, fecha)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      codigoRep, inc.id, canal, d.nombre, d.documento, d.telefono, d.email, d.suministro, d.sed, d.autenticado, d.direccion,
      d.referencia, d.lat, d.lng, d.descripcion, foto, coincidencia ? 1 : 0, coincidencia ? 'AUTOMATICA' : null,
      d.alcance, d.requiereAcceso, d.franja, usuarioId, fecha,
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
      requiere_acceso: !!d.requiereAcceso,
      franja_horaria: d.franja ? FRANJAS_TEXTO[d.franja] : null,
    };
  });
  return resultado;
}

// ---------------------------------------------------------------- consulta pública (seguimiento estilo courier)
function reporteParaCliente(codigo, ultimos, cliente) {
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
  return rep;
}

const HORAS_PARA_CONFIRMAR = 72;
// Una respuesta solo vale para el restablecimiento actual: si la incidencia se reabrió y se volvió a restablecer,
// la respuesta anterior ya no cuenta y el cliente puede responder de nuevo.
function confirmacionVigente(rep, inc) {
  if (!rep.confirmacion) return null;
  if (!inc.fecha_solucion) return rep.confirmacion;
  return rep.fecha_confirmacion >= inc.fecha_solucion ? rep.confirmacion : null;
}

// Causa con la que la cuadrilla cerró la orden vigente (null si aún no hay cierre)
function causaDelCierre(inc) {
  if (!inc.orden_actual_id || !CON_SOLUCION.includes(inc.estado)) return null;
  return db.uno(`SELECT ca.id, ca.nombre, ca.responsabilidad FROM orden_trabajo ot JOIN causa ca ON ca.id = ot.causa_id
                  WHERE ot.id = ? AND ot.estado <> 'CANCELADA'`, inc.orden_actual_id) || null;
}

function puedeConfirmar(rep, inc) {
  if (confirmacionVigente(rep, inc) || !CON_SOLUCION.includes(inc.estado) || !inc.fecha_solucion) return false;
  if (horasEntre(inc.fecha_solucion, iso()) > HORAS_PARA_CONFIRMAR) return false;
  // Si la falla estaba en la instalación interna del cliente, ENSA no vuelve a atenderla: no se pregunta "¿Volvió tu luz?"
  const causa = causaDelCierre(inc);
  return !(causa && causa.responsabilidad === 'CLIENTE');
}

// Encuesta de satisfacción, totalmente opcional: se ofrece cuando el servicio fue restablecido, después de la
// pregunta "¿Volvió tu luz?" (o cuando no corresponde hacerla), una sola vez por reporte y hasta 7 días después.
// El cliente puede ignorarla o cerrarla; si la envía, califica la atención en general, la rapidez o ambas.
const DIAS_PARA_ENCUESTA = 7;
function encuestaDe(rep) {
  return db.uno('SELECT general, rapidez, fecha FROM encuesta WHERE reporte_id = ?', rep.id) || null;
}
function puedeEncuestar(rep, inc) {
  if (!CON_SOLUCION.includes(inc.estado) || !inc.fecha_solucion) return false;
  if (horasEntre(inc.fecha_solucion, iso()) > DIAS_PARA_ENCUESTA * 24) return false;
  if (confirmacionVigente(rep, inc) === 'NO' || puedeConfirmar(rep, inc)) return false;
  return !encuestaDe(rep);
}

function consultaPublica(codigo, ultimos, cliente = null) {
  const rep = reporteParaCliente(codigo, ultimos, cliente);
  const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', rep.incidencia_id);
  const tipo = db.uno('SELECT nombre, codigo FROM tipo_incidencia WHERE id = ?', inc.tipo_id);
  const zona = db.uno('SELECT nombre FROM zona WHERE id = ?', inc.zona_id);
  const area = db.uno('SELECT nombre FROM area WHERE id = ?', inc.area_id);
  const linea = db.todos(
    `SELECT estado_nuevo AS estado, fecha FROM historial WHERE incidencia_id = ? AND (estado_anterior IS NULL OR estado_anterior <> estado_nuevo)
      ORDER BY fecha, id`, inc.id,
  );
  // Datos de la cuadrilla: código, si es propia o de qué contratista, y hora estimada. Nunca su ubicación.
  let cuadrilla = null, causa = null;
  const ot = inc.orden_actual_id ? db.uno('SELECT * FROM orden_trabajo WHERE id = ?', inc.orden_actual_id) : null;
  if (ot && ot.estado !== 'CANCELADA') {
    const cu = db.uno(`SELECT c.codigo, c.nombre, c.tipo, e.nombre AS empresa FROM cuadrilla c
                        LEFT JOIN empresa_contratista e ON e.id = c.empresa_id WHERE c.id = ?`, ot.cuadrilla_id);
    cuadrilla = {
      codigo: cu.codigo, nombre: cu.nombre,
      responsable: cu.tipo === 'PROPIA' ? 'Personal de ENSA' : `Contratista de ENSA: ${cu.empresa}`,
      orden_trabajo: ot.codigo,
      hora_estimada_llegada: ot.estado === 'EN_CAMINO' ? ot.eta : null,
      llegada: ot.fecha_llegada,
    };
    if (ot.causa_id && CON_SOLUCION.includes(inc.estado)) {
      const ca = db.uno('SELECT nombre, responsabilidad FROM causa WHERE id = ?', ot.causa_id);
      causa = { nombre: ca.nombre, responsabilidad: ca.responsabilidad };
    }
  }
  return {
    numero_seguimiento: rep.codigo,
    fecha_reporte: rep.fecha,
    incidencia: inc.codigo,
    tipo: tipo.nombre,
    tipo_codigo: tipo.codigo,
    zona: zona.nombre,
    estado: inc.estado,
    area: area.nombre,
    reportes_de_la_falla: inc.cantidad_reportes,
    fecha_limite: inc.fecha_limite,
    fecha_solucion: inc.fecha_solucion,
    detalle_solucion: CON_SOLUCION.includes(inc.estado) ? inc.detalle_solucion : null,
    causa,
    cuadrilla,
    requiere_presencia: !!rep.requiere_acceso,
    franja_horaria: rep.franja_horaria ? FRANJAS_TEXTO[rep.franja_horaria] : null,
    confirmacion: confirmacionVigente(rep, inc),
    puede_confirmar: puedeConfirmar(rep, inc),
    puede_encuestar: puedeEncuestar(rep, inc),
    encuesta: encuestaDe(rep) ? { general: encuestaDe(rep).general, rapidez: encuestaDe(rep).rapidez } : null,
    reabierta: inc.reaperturas > 0,
    linea_tiempo: linea,
  };
}

// Saca el reporte de una falla ya restablecida para los vecinos y abre con él una incidencia nueva solo para su predio.
function separarReporte(rep, inc, fecha) {
  const tipo = db.uno('SELECT * FROM tipo_incidencia WHERE id = ?', inc.tipo_id);
  const anio = new Date(fecha).getUTCFullYear();
  const codigo = `INC-${anio}-${String(db.siguiente(`INC-${anio}`)).padStart(6, '0')}`;
  const zonaId = (rep.suministro && (db.uno('SELECT zona_id FROM suministro WHERE numero = ?', rep.suministro) || {}).zona_id) || inc.zona_id;
  const r = db.ejecutar(
    `INSERT INTO incidencia (codigo, tipo_id, zona_id, direccion, lat, lng, estado, prioridad, area_id,
       fecha_registro, fecha_limite, cantidad_reportes) VALUES (?,?,?,?,?,?,'REGISTRADA',?,?,?,?,1)`,
    codigo, inc.tipo_id, zonaId, rep.direccion + (rep.referencia ? ` (${rep.referencia})` : ''), rep.lat ?? inc.lat, rep.lng ?? inc.lng,
    tipo.prioridad, inc.area_id, fecha, sumarHoras(fecha, tipo.plazo_horas),
  );
  const nueva = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(r.lastInsertRowid));
  // El reporte pasa a la nueva incidencia como falla de una sola casa; su respuesta "No" queda en el historial
  db.ejecutar(`UPDATE reporte SET incidencia_id = ?, alcance = 'SOLO_MI_CASA', es_duplicado = 0, tipo_agrupacion = NULL,
                 confirmacion = NULL, fecha_confirmacion = NULL WHERE id = ?`, nueva.id, rep.id);
  db.ejecutar('UPDATE incidencia SET cantidad_reportes = cantidad_reportes - 1 WHERE id = ?', inc.id);
  db.ejecutar('INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
    nueva.id, null, 'REGISTRADA', `El cliente del reporte ${rep.codigo} indicó que sigue sin luz después de restablecida la incidencia ${inc.codigo}, que otros vecinos confirmaron. Se atiende solo su predio.`, null, fecha);
  db.ejecutar('INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
    inc.id, inc.estado, inc.estado, `El cliente del reporte ${rep.codigo} sigue sin luz; otros vecinos confirmaron el servicio. Su falla pasa a la incidencia ${codigo}.`, null, fecha);
  return nueva;
}

// El cliente responde "¿Volvió tu luz?". Un "No" reabre la incidencia y la devuelve al despacho.
function confirmar(codigo, ultimos, cliente, respuesta, ip = null) {
  const resp = String(respuesta || '').toUpperCase();
  if (!['SI', 'NO'].includes(resp)) throw new ErrorNegocio('Respuesta no válida.');
  return db.transaccion(() => {
    const rep = reporteParaCliente(codigo, ultimos, cliente);
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', rep.incidencia_id);
    if (!puedeConfirmar(rep, inc)) throw new ErrorNegocio('Este reporte ya no admite confirmación.', 409);
    const fecha = iso();
    db.ejecutar('UPDATE reporte SET confirmacion = ?, fecha_confirmacion = ? WHERE id = ?', resp, fecha, rep.id);
    let separada = null;
    if (resp === 'NO') {
      // ¿Otros vecinos de la misma falla ya confirmaron que volvió la luz en este restablecimiento?
      const otrosSi = db.todos("SELECT * FROM reporte WHERE incidencia_id = ? AND id <> ? AND confirmacion = 'SI'", inc.id, rep.id)
        .filter((o) => confirmacionVigente(o, inc) === 'SI').length;
      if (otrosSi > 0) {
        // La red ya funciona para los demás: la falla de este cliente es solo de su predio. La incidencia general
        // sigue cerrada y se abre una incidencia nueva, solo para este suministro.
        separada = separarReporte(rep, inc, fecha);
      } else {
        // La orden vigente queda rechazada por el cliente; la incidencia vuelve al despacho conservando su plazo original
        if (inc.orden_actual_id) {
          db.ejecutar("UPDATE orden_trabajo SET estado = 'RECHAZADA', observacion = ? WHERE id = ? AND estado IN ('RESTABLECIDA','VALIDADA')",
            `El cliente ${rep.codigo} indicó que la falla continúa`, inc.orden_actual_id);
        }
        db.ejecutar(`UPDATE incidencia SET estado = 'REGISTRADA', fecha_solucion = NULL, fecha_validacion = NULL, detalle_solucion = NULL,
                     orden_actual_id = NULL, reaperturas = reaperturas + 1 WHERE id = ?`, inc.id);
        db.ejecutar('INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
          inc.id, inc.estado, 'REGISTRADA', `Reabierta: el cliente del reporte ${rep.codigo} indicó que la falla continúa`, null, fecha);
      }
    } else {
      db.ejecutar('INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
        inc.id, inc.estado, inc.estado, `El cliente del reporte ${rep.codigo} confirmó que volvió el servicio`, null, fecha);
    }
    auditoria.registrar({ accion: resp === 'SI' ? 'CLIENTE_CONFIRMA' : separada ? 'CLIENTE_FALLA_PROPIA' : 'CLIENTE_REABRE', entidad: 'incidencia', entidadId: inc.id,
      detalle: `${rep.codigo} → ${separada ? separada.codigo : inc.codigo}`, ip });
    return consultaPublica(rep.codigo, String(rep.telefono).slice(-4), null);
  });
}

function responderEncuesta(codigo, ultimos, cliente, datos = {}, ip = null) {
  const estrella = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ErrorNegocio('La calificación debe ser de 1 a 5 estrellas.');
    return n;
  };
  const general = estrella(datos.general);
  const rapidez = estrella(datos.rapidez);
  if (general == null && rapidez == null) throw new ErrorNegocio('Marca al menos una calificación, o cierra la encuesta si no deseas responderla.');
  return db.transaccion(() => {
    const rep = reporteParaCliente(codigo, ultimos, cliente);
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', rep.incidencia_id);
    if (!puedeEncuestar(rep, inc)) throw new ErrorNegocio('La encuesta de este reporte ya no está disponible.', 409);
    const ot = inc.orden_actual_id ? db.uno('SELECT id, cuadrilla_id FROM orden_trabajo WHERE id = ?', inc.orden_actual_id) : null;
    db.ejecutar(`INSERT INTO encuesta (reporte_id, incidencia_id, orden_trabajo_id, cuadrilla_id, general, rapidez, fecha)
                 VALUES (?,?,?,?,?,?,?)`, rep.id, inc.id, ot ? ot.id : null, ot ? ot.cuadrilla_id : null, general, rapidez, iso());
    auditoria.registrar({ accion: 'CLIENTE_ENCUESTA', entidad: 'incidencia', entidadId: inc.id,
      detalle: `${rep.codigo}: general ${general ?? '-'} · rapidez ${rapidez ?? '-'}`, ip });
    return consultaPublica(rep.codigo, String(rep.telefono).slice(-4), null);
  });
}

// ---------------------------------------------------------------- bandeja y detalle
function listar(f = {}) {
  const cond = [], p = [];
  if (f.estado === 'ABIERTAS') cond.push(`i.estado IN (${SQL_ABIERTOS})`);
  else if (f.estado === 'EN_CAMPO') cond.push("i.estado IN ('EN_CAMINO','EN_LUGAR','REPARANDO')");
  else if (f.estado) { cond.push('i.estado = ?'); p.push(f.estado); }
  if (f.tipo_id) { cond.push('i.tipo_id = ?'); p.push(Number(f.tipo_id)); }
  if (f.zona_id) { cond.push('i.zona_id = ?'); p.push(Number(f.zona_id)); }
  if (f.unidad_id) { cond.push('z.unidad_negocio_id = ?'); p.push(Number(f.unidad_id)); }
  if (f.area_id) { cond.push('i.area_id = ?'); p.push(Number(f.area_id)); }
  if (f.vencidas === '1') { cond.push(`i.estado IN (${SQL_ABIERTOS}) AND i.fecha_limite < ?`); p.push(iso()); }
  if (f.cuadrilla_id) { cond.push('ot.cuadrilla_id = ?'); p.push(Number(f.cuadrilla_id)); }
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
    `SELECT i.*, t.nombre AS tipo, t.codigo AS tipo_codigo, z.nombre AS zona, u.nombre AS unidad, a.nombre AS area, a.codigo AS area_codigo,
            ot.codigo AS orden, ot.estado AS orden_estado, ot.eta, cu.codigo AS cuadrilla, cu.tipo AS cuadrilla_tipo,
            (SELECT COUNT(*) FROM reporte r WHERE r.incidencia_id = i.id AND r.requiere_acceso = 1) AS requiere_acceso
       FROM incidencia i JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
       JOIN unidad_negocio u ON u.id = z.unidad_negocio_id JOIN area a ON a.id = i.area_id
       LEFT JOIN orden_trabajo ot ON ot.id = i.orden_actual_id LEFT JOIN cuadrilla cu ON cu.id = ot.cuadrilla_id
       ${where}
      ORDER BY CASE WHEN i.estado IN (${SQL_ABIERTOS}) THEN 0 WHEN i.estado = 'RESTABLECIDA' THEN 1 ELSE 2 END,
               CASE i.prioridad WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
               i.fecha_limite ASC
      LIMIT ?`, ...p, limite,
  );
}

function detalle(id) {
  const inc = db.uno(
    `SELECT i.*, t.nombre AS tipo, t.codigo AS tipo_codigo, t.plazo_horas, z.nombre AS zona, z.unidad_negocio_id, u.nombre AS unidad,
            a.nombre AS area, a.codigo AS area_codigo, f.codigo AS fusionada_en
       FROM incidencia i JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
       JOIN unidad_negocio u ON u.id = z.unidad_negocio_id JOIN area a ON a.id = i.area_id
       LEFT JOIN incidencia f ON f.id = i.fusionada_en_id
      WHERE i.id = ?`, Number(id),
  );
  if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
  inc.reportes = db.todos(
    `SELECT r.*, us.nombre AS registrado_por_nombre FROM reporte r LEFT JOIN usuario us ON us.id = r.registrado_por
      WHERE r.incidencia_id = ? ORDER BY r.fecha`, inc.id,
  ).map((r) => ({ ...r, franja_texto: r.franja_horaria ? FRANJAS_TEXTO[r.franja_horaria] : null, encuesta: encuestaDe(r) }));
  inc.historial = db.todos(
    `SELECT h.*, us.nombre AS usuario FROM historial h LEFT JOIN usuario us ON us.id = h.usuario_id
      WHERE h.incidencia_id = ? ORDER BY h.fecha, h.id`, inc.id,
  );
  inc.ordenes = db.todos(
    `SELECT ot.*, c.codigo AS cuadrilla_codigo, c.nombre AS cuadrilla_nombre, c.tipo AS cuadrilla_tipo, e.nombre AS empresa,
            j.nombre AS jefe, ca.nombre AS causa, ca.responsabilidad, ua.nombre AS asignada_por_nombre, uv.nombre AS validado_por_nombre,
            c.lat AS cuadrilla_lat, c.lng AS cuadrilla_lng, c.fecha_ubicacion
       FROM orden_trabajo ot JOIN cuadrilla c ON c.id = ot.cuadrilla_id LEFT JOIN empresa_contratista e ON e.id = c.empresa_id
       LEFT JOIN usuario j ON j.id = c.jefe_usuario_id LEFT JOIN causa ca ON ca.id = ot.causa_id
       LEFT JOIN usuario ua ON ua.id = ot.asignada_por LEFT JOIN usuario uv ON uv.id = ot.validado_por
      WHERE ot.incidencia_id = ? ORDER BY ot.id DESC`, inc.id,
  );
  inc.orden_actual = inc.ordenes.find((o) => o.id === inc.orden_actual_id) || null;
  for (const r of inc.reportes) r.confirmacion_vigente = confirmacionVigente(r, inc);
  inc.confirmaciones = {
    si: inc.reportes.filter((r) => confirmacionVigente(r, inc) === 'SI').length,
    no: inc.reportes.filter((r) => confirmacionVigente(r, inc) === 'NO').length,
  };
  return inc;
}

function porCodigo(codigo) {
  const c = texto(codigo, 30).toUpperCase();
  const fila = db.uno('SELECT id FROM incidencia WHERE codigo = ?', c)
    || db.uno('SELECT incidencia_id AS id FROM reporte WHERE codigo = ?', c);
  if (!fila) throw new ErrorNegocio('No existe una incidencia o reporte con ese código.', 404);
  return fila.id;
}

// ---------------------------------------------------------------- anulación
// Quién puede actuar sobre una incidencia según el proceso:
//  - Centro de Control de Operaciones (DESPACHADOR): emergencias del área de Operaciones (cortes, cables, luz baja).
//  - Supervisor de área: las incidencias de su área (alumbrado público, mantenimiento de redes) y la validación del cierre.
//  - Atención al Cliente (OPERADOR): registra, anula reportes improcedentes y fusiona duplicados; no despacha.
function esDeSuArea(usuario, inc) {
  if (usuario.rol === 'ADMIN') return true;
  const areaCodigo = db.uno('SELECT codigo FROM area WHERE id = ?', inc.area_id).codigo;
  if (usuario.rol === 'DESPACHADOR') return areaCodigo === 'OPE';
  if (usuario.rol === 'SUPERVISOR') return usuario.area_id === inc.area_id;
  return false;
}

function anular(id, motivo, usuario, ip = null) {
  if (!['ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR'].includes(usuario.rol)) throw new ErrorNegocio('Tu rol no permite esta acción.', 403);
  return db.transaccion(() => {
    const inc = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(id));
    if (!inc) throw new ErrorNegocio('Incidencia no encontrada.', 404);
    if (!['REGISTRADA', 'ASIGNADA'].includes(inc.estado)) throw new ErrorNegocio('Solo se anula una incidencia registrada o asignada (antes de que la cuadrilla salga).', 409);
    if (usuario.rol !== 'OPERADOR' && !esDeSuArea(usuario, inc)) throw new ErrorNegocio('La incidencia pertenece a otra área.', 403);
    const comentario = opcional(motivo, 300);
    if (!comentario) throw new ErrorNegocio('Indica el motivo de la anulación.');
    const fecha = iso();
    if (inc.orden_actual_id) {
      db.ejecutar("UPDATE orden_trabajo SET estado = 'CANCELADA', observacion = ? WHERE id = ? AND estado = 'ASIGNADA'", `Incidencia anulada: ${comentario}`, inc.orden_actual_id);
    }
    db.ejecutar("UPDATE incidencia SET estado = 'ANULADA' WHERE id = ?", inc.id);
    db.ejecutar('INSERT INTO historial (incidencia_id, estado_anterior, estado_nuevo, comentario, usuario_id, fecha) VALUES (?,?,?,?,?,?)',
      inc.id, inc.estado, 'ANULADA', comentario, usuario.id, fecha);
    const act = db.uno('SELECT * FROM incidencia WHERE id = ?', inc.id);
    for (const rep of db.todos('SELECT * FROM reporte WHERE incidencia_id = ?', inc.id)) notif.encolar(rep, notif.mensajes.anulacion(rep, comentario));
    auditoria.registrar({ usuarioId: usuario.id, accion: 'INCIDENCIA_ANULAR', entidad: 'incidencia', entidadId: inc.id, ip, detalle: `${inc.codigo}: ${inc.estado} → ANULADA · ${comentario}` });
    return act;
  });
}

// Fusión manual: el personal detecta un duplicado que el sistema no agrupó
function fusionar(origenId, codigoDestino, usuario, ip = null) {
  if (!['ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR'].includes(usuario.rol)) throw new ErrorNegocio('Tu rol no permite esta acción.', 403);
  return db.transaccion(() => {
    const origen = db.uno('SELECT * FROM incidencia WHERE id = ?', Number(origenId));
    const destino = db.uno('SELECT * FROM incidencia WHERE codigo = ?', texto(codigoDestino, 30).toUpperCase());
    if (!origen || !destino) throw new ErrorNegocio('No se encontró una de las incidencias.', 404);
    if (origen.id === destino.id) throw new ErrorNegocio('No puedes fusionar una incidencia consigo misma.');
    if (!ABIERTOS.includes(origen.estado) || !ABIERTOS.includes(destino.estado)) throw new ErrorNegocio('Ambas incidencias deben estar abiertas.', 409);
    if (!['REGISTRADA', 'ASIGNADA', 'EN_CAMINO'].includes(origen.estado)) throw new ErrorNegocio('La cuadrilla ya está trabajando en esta incidencia; fusiona la otra en ella.', 409);
    if (origen.tipo_id !== destino.tipo_id) throw new ErrorNegocio('Solo se fusionan incidencias del mismo tipo.');
    const fecha = iso();
    if (origen.orden_actual_id) {
      db.ejecutar("UPDATE orden_trabajo SET estado = 'CANCELADA', observacion = ? WHERE id = ? AND estado IN ('ASIGNADA','EN_CAMINO')",
        `Fusionada en ${destino.codigo}`, origen.orden_actual_id);
    }
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
  catalogo, registrarReporte, buscarCoincidencia, consultaPublica, confirmar, responderEncuesta, listar, detalle, porCodigo,
  anular, fusionar, esDeSuArea, ABIERTOS, SQL_ABIERTOS, CON_SOLUCION, FRANJAS_TEXTO, guardarFoto, borrarFoto,
};
