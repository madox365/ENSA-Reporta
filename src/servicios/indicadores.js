'use strict';
// Tablero: indicadores del PETI para el P01
//   KPI 1  Tiempo medio desde el reporte hasta la atención (solución)        — mensual
//   KPI 2  Reportes duplicados agrupados en una sola incidencia (meta 100%)  — mensual
//   KPI 3  Incidencias atendidas dentro del plazo (meta ≥ 90%)               — mensual
const db = require('../db');
const { ahora, iso, sumarHoras, horasEntre } = require('../util');

const META_EN_PLAZO = 90;
const META_DUPLICADOS = 100;

function rango(f) {
  const hoy = new Date(ahora().getTime() - 5 * 3600e3).toISOString().slice(0, 10); // fecha en Lima
  const hasta = f.hasta || hoy;
  const desde = f.desde || new Date(new Date(`${hasta}T00:00:00Z`).getTime() - 29 * 864e5).toISOString().slice(0, 10);
  return {
    desde, hasta,
    desdeIso: new Date(`${desde}T00:00:00-05:00`).toISOString(),
    hastaIso: sumarHoras(new Date(`${hasta}T00:00:00-05:00`).toISOString(), 24),
  };
}

const prom = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const pct = (a, b) => (b ? (100 * a) / b : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function calcular(f = {}) {
  const { desde, hasta, desdeIso, hastaIso } = rango(f);
  const cond = ['i.fecha_registro >= ?', 'i.fecha_registro < ?', 'i.fusionada_en_id IS NULL'];
  const p = [desdeIso, hastaIso];
  if (f.unidad_id) { cond.push('z.unidad_negocio_id = ?'); p.push(Number(f.unidad_id)); }
  if (f.tipo_id) { cond.push('i.tipo_id = ?'); p.push(Number(f.tipo_id)); }
  const incs = db.todos(
    `SELECT i.*, t.nombre AS tipo, z.nombre AS zona, u.nombre AS unidad
       FROM incidencia i JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
       JOIN unidad_negocio u ON u.id = z.unidad_negocio_id
      WHERE ${cond.join(' AND ')}`, ...p,
  );
  const condR = ['r.fecha >= ?', 'r.fecha < ?'], pR = [desdeIso, hastaIso];
  if (f.unidad_id) { condR.push('z.unidad_negocio_id = ?'); pR.push(Number(f.unidad_id)); }
  if (f.tipo_id) { condR.push('i.tipo_id = ?'); pR.push(Number(f.tipo_id)); }
  const reps = db.todos(
    `SELECT r.canal, r.es_duplicado, r.tipo_agrupacion FROM reporte r JOIN incidencia i ON i.id = r.incidencia_id
       JOIN zona z ON z.id = i.zona_id WHERE ${condR.join(' AND ')}`, ...pR,
  );

  const ahoraIso = iso();
  const validas = incs.filter((i) => i.estado !== 'ANULADA');
  const solucionadas = validas.filter((i) => i.estado === 'SOLUCIONADA');
  const enPlazo = solucionadas.filter((i) => i.fecha_solucion <= i.fecha_limite);
  const abiertas = validas.filter((i) => ['REGISTRADA', 'ASIGNADA', 'EN_ATENCION'].includes(i.estado));
  const vencidas = abiertas.filter((i) => i.fecha_limite < ahoraIso);
  const tAtencion = solucionadas.map((i) => horasEntre(i.fecha_registro, i.fecha_solucion));
  const tRespuesta = validas.filter((i) => i.fecha_atencion).map((i) => horasEntre(i.fecha_registro, i.fecha_atencion));
  const dup = reps.filter((r) => r.es_duplicado);
  const dupAuto = dup.filter((r) => r.tipo_agrupacion === 'AUTOMATICA').length;

  const agrupar = (clave) => {
    const m = new Map();
    for (const i of validas) {
      const k = i[clave];
      if (!m.has(k)) m.set(k, { nombre: k, unidad: i.unidad, incidencias: 0, reportes: 0, abiertas: 0, vencidas: 0, sol: 0, plazo: 0, horas: [] });
      const g = m.get(k);
      g.incidencias++; g.reportes += i.cantidad_reportes;
      if (abiertas.includes(i)) { g.abiertas++; if (i.fecha_limite < ahoraIso) g.vencidas++; }
      if (i.estado === 'SOLUCIONADA') { g.sol++; if (i.fecha_solucion <= i.fecha_limite) g.plazo++; g.horas.push(horasEntre(i.fecha_registro, i.fecha_solucion)); }
    }
    return [...m.values()]
      .map((g) => ({ nombre: g.nombre, unidad: g.unidad, incidencias: g.incidencias, reportes: g.reportes, abiertas: g.abiertas, vencidas: g.vencidas, pct_en_plazo: r1(pct(g.plazo, g.sol)), tiempo_medio_h: r1(prom(g.horas)) }))
      .sort((a, b) => b.reportes - a.reportes);
  };

  // Tendencia semanal (lunes a domingo, hora de Lima)
  const semanas = new Map();
  for (const i of validas) {
    const lima = new Date(new Date(i.fecha_registro).getTime() - 5 * 3600e3);
    const dia = (lima.getUTCDay() + 6) % 7;
    const lunes = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() - dia)).toISOString().slice(0, 10);
    if (!semanas.has(lunes)) semanas.set(lunes, { semana: lunes, incidencias: 0, sol: 0, plazo: 0, horas: [] });
    const s = semanas.get(lunes);
    s.incidencias++;
    if (i.estado === 'SOLUCIONADA') { s.sol++; if (i.fecha_solucion <= i.fecha_limite) s.plazo++; s.horas.push(horasEntre(i.fecha_registro, i.fecha_solucion)); }
  }
  const canales = {};
  for (const r of reps) canales[r.canal] = (canales[r.canal] || 0) + 1;

  return {
    periodo: { desde, hasta },
    kpi: {
      tiempo_medio_atencion_h: r1(prom(tAtencion)),
      tiempo_medio_respuesta_h: r1(prom(tRespuesta)),
      pct_en_plazo: r1(pct(enPlazo.length, solucionadas.length)),
      meta_en_plazo: META_EN_PLAZO,
      pct_duplicados_agrupados_auto: r1(pct(dupAuto, dup.length)),
      meta_duplicados: META_DUPLICADOS,
      pct_reportes_duplicados: r1(pct(dup.length, reps.length)),
    },
    totales: {
      reportes: reps.length,
      incidencias: validas.length,
      duplicados: dup.length,
      duplicados_auto: dupAuto,
      duplicados_manual: dup.length - dupAuto,
      solucionadas: solucionadas.length,
      en_plazo: enPlazo.length,
      abiertas: abiertas.length,
      vencidas: vencidas.length,
      anuladas: incs.length - validas.length,
    },
    por_zona: agrupar('zona'),
    por_tipo: agrupar('tipo'),
    por_canal: Object.entries(canales).map(([canal, n]) => ({ canal, reportes: n })).sort((a, b) => b.reportes - a.reportes),
    tendencia: [...semanas.values()].sort((a, b) => a.semana.localeCompare(b.semana))
      .map((s) => ({ semana: s.semana, incidencias: s.incidencias, pct_en_plazo: r1(pct(s.plazo, s.sol)), tiempo_medio_h: r1(prom(s.horas)) })),
  };
}

// Exportación CSV para el reporte mensual de indicadores (actividad 19 del roadmap)
function csv(f = {}) {
  const { desdeIso, hastaIso } = rango(f);
  const filas = db.todos(
    `SELECT i.codigo, t.nombre AS tipo, u.nombre AS unidad, z.nombre AS zona, i.direccion, i.estado, i.prioridad, a.nombre AS area,
            i.cuadrilla, i.cantidad_reportes, i.fecha_registro, i.fecha_limite, i.fecha_asignacion, i.fecha_atencion, i.fecha_solucion
       FROM incidencia i JOIN tipo_incidencia t ON t.id = i.tipo_id JOIN zona z ON z.id = i.zona_id
       JOIN unidad_negocio u ON u.id = z.unidad_negocio_id JOIN area a ON a.id = i.area_id
      WHERE i.fecha_registro >= ? AND i.fecha_registro < ? ORDER BY i.fecha_registro`, desdeIso, hastaIso,
  );
  const cab = ['codigo', 'tipo', 'unidad', 'zona', 'direccion', 'estado', 'prioridad', 'area', 'cuadrilla', 'reportes',
    'fecha_registro', 'fecha_limite', 'fecha_asignacion', 'fecha_atencion', 'fecha_solucion', 'horas_atencion', 'en_plazo'];
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en Excel
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = filas.map((r) => [
    r.codigo, r.tipo, r.unidad, r.zona, r.direccion, r.estado, r.prioridad, r.area, r.cuadrilla, r.cantidad_reportes,
    r.fecha_registro, r.fecha_limite, r.fecha_asignacion, r.fecha_atencion, r.fecha_solucion,
    r.fecha_solucion ? r1(horasEntre(r.fecha_registro, r.fecha_solucion)) : '',
    r.fecha_solucion ? (r.fecha_solucion <= r.fecha_limite ? 'SI' : 'NO') : '',
  ].map(esc).join(';'));
  return `﻿${cab.join(';')}\n${lineas.join('\n')}\n`;
}

module.exports = { calcular, csv, META_EN_PLAZO, META_DUPLICADOS };
