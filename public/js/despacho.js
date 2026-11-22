// Despacho y atención en campo: detalle de incidencia con orden de trabajo, cuadrillas y app del jefe de cuadrilla.
// Se carga antes de personal.js; usa sus funciones globales (S, llamar, P, opcionesDe, restante, cargarBandeja).
'use strict';

const RESPONSABILIDAD = { ENSA: 'Red de ENSA', CLIENTE: 'Instalación interna del cliente', TERCEROS: 'Terceros', NATURALEZA: 'Naturaleza' };
const ALCANCE = { SOLO_MI_CASA: 'Solo su casa', VARIAS_CASAS: 'Varias casas o la calle', NO_SE: 'No sabe' };
const hora = (isoTxt) => (isoTxt ? fecha(isoTxt).slice(-5) : '');
const haceMin = (isoTxt) => {
  if (!isoTxt) return 'sin ubicación';
  const m = Math.round((Date.now() - new Date(isoTxt)) / 60000);
  return m < 1 ? 'hace instantes' : m < 60 ? `hace ${m} min` : `hace ${duracion(m / 60)}`;
};
const enlaceMapa = (lat, lng, texto = 'Ver en mapa') => (lat != null
  ? `<a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}" target="_blank" rel="noopener">${texto}</a>` : '');
const responsable = (c) => (c.tipo === 'PROPIA' || c.cuadrilla_tipo === 'PROPIA' ? 'Cuadrilla propia de ENSA' : `Contratista: ${esc(c.empresa)}`);

function puedeDespachar(u, i) {
  if (u.rol === 'ADMIN') return true;
  if (u.rol === 'DESPACHADOR') return i.area_codigo === 'OPE';
  if (u.rol === 'SUPERVISOR') return u.area_id === i.area_id;
  return false;
}

function pasosOrden(ot, estadoActual) {
  const pasos = [
    ['ASIGNADA', 'Orden emitida', ot.fecha_asignacion],
    ['EN_CAMINO', `En camino${ot.eta && ot.estado === 'EN_CAMINO' ? ` · llegada estimada ${hora(ot.eta)}` : ''}`, ot.fecha_en_camino],
    ['EN_LUGAR', 'En el lugar', ot.fecha_llegada],
    ['REPARANDO', 'Reparando', ot.fecha_reparando],
    ['RESTABLECIDA', 'Servicio restablecido', ot.fecha_restablecida],
    ['VALIDADA', 'Cierre validado por el supervisor', ot.fecha_validacion],
  ];
  const idx = pasos.findIndex((p) => p[0] === estadoActual);
  return `<ol class="pasos">${pasos.map((p, k) => `<li class="${p[2] ? 'hecho' : ''} ${k === idx ? 'actual' : ''}">${esc(p[1])}<span class="hora muted">${p[2] ? fecha(p[2]) : ''}</span></li>`).join('')}</ol>`;
}

// Confirmación en dos pasos (sin diálogos del navegador)
function confirmarDosPasos(boton, textoConfirmar) {
  if (boton.dataset.confirmado) return true;
  const original = boton.textContent;
  boton.dataset.confirmado = '1'; boton.textContent = textoConfirmar;
  setTimeout(() => { delete boton.dataset.confirmado; boton.textContent = original; }, 5000);
  return false;
}

// ------------------------------------------------------------- detalle de incidencia (bandeja)
async function verDetalle(id) {
  S.sel = id;
  for (const tr of $$('#b-lista tr[data-id]')) tr.classList.toggle('sel', Number(tr.dataset.id) === id);
  const p = $('#b-detalle');
  if (!p) return;
  p.innerHTML = '<p class="muted">Cargando…</p>';
  let i;
  try { i = await llamar(`/api/incidencias/${id}`); } catch (e) { mostrarError(p, e); return; }
  const u = S.usuario;
  const ot = i.orden_actual;
  const despachable = puedeDespachar(u, i) && ['REGISTRADA', 'ASIGNADA', 'EN_CAMINO'].includes(i.estado);
  const validable = i.estado === 'RESTABLECIDA' && (u.rol === 'ADMIN' || (u.rol === 'SUPERVISOR' && u.area_id === i.area_id));
  const anulable = ['REGISTRADA', 'ASIGNADA'].includes(i.estado) && (u.rol === 'OPERADOR' || puedeDespachar(u, i));
  const fusionable = ['REGISTRADA', 'ASIGNADA', 'EN_CAMINO'].includes(i.estado) && ['ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR'].includes(u.rol);
  const acceso = i.reportes.filter((r) => r.requiere_acceso);
  p.innerHTML = `
    <div class="cabecera"><h2 class="mono">${esc(i.codigo)}</h2>${chipEstado(i.estado)}</div>
    <dl class="dl">
      <dt>Tipo</dt><dd>${esc(i.tipo)} · <span class="prio p-${i.prioridad}">${esc(i.prioridad)}</span></dd>
      <dt>Ubicación</dt><dd>${esc(i.direccion)}<br>${esc(i.zona)} · ${esc(i.unidad.replace('Unidad de Negocio ', ''))} · ${enlaceMapa(i.lat, i.lng) || '<span class="muted">Sin GPS</span>'}</dd>
      <dt>Área</dt><dd>${esc(i.area)}</dd>
      <dt>Registrada</dt><dd>${fecha(i.fecha_registro)}</dd>
      <dt>Plazo</dt><dd>${fecha(i.fecha_limite)} (${i.plazo_horas} h) · ${restante(i)}</dd>
      ${i.fecha_atencion ? `<dt>Llegada</dt><dd>${fecha(i.fecha_atencion)} · ${duracion((new Date(i.fecha_atencion) - new Date(i.fecha_registro)) / 3600e3)} desde el reporte</dd>` : ''}
      ${i.fecha_solucion ? `<dt>Restablecida</dt><dd>${fecha(i.fecha_solucion)} · ${duracion((new Date(i.fecha_solucion) - new Date(i.fecha_registro)) / 3600e3)}</dd>` : ''}
      ${i.reaperturas ? `<dt>Reaperturas</dt><dd class="vencida">${i.reaperturas} (el cliente indicó que la falla continuaba)</dd>` : ''}
      ${i.fusionada_en ? `<dt>Fusionada en</dt><dd class="mono">${esc(i.fusionada_en)}</dd>` : ''}
    </dl>
    ${acceso.length ? `<div class="aviso aviso-alerta peq"><b>Requiere acceso al predio.</b> ${acceso.map((r) => `${esc(r.nombre)} · ${esc(r.telefono)} · ${esc(r.franja_texto || '')}`).join('<br>')}</div>` : ''}
    <div id="d-error"></div>
    ${ot ? `<div class="accion-form"><h3>Orden de trabajo <span class="mono">${esc(ot.codigo)}</span> ${chipEstado(ot.estado)}</h3>
      <dl class="dl">
        <dt>Cuadrilla</dt><dd><b class="mono">${esc(ot.cuadrilla_codigo)}</b> · ${esc(ot.cuadrilla_nombre)}<br><span class="muted">${responsable(ot)}${ot.jefe ? ` · Jefe: ${esc(ot.jefe.split(' · ')[0])}` : ''}</span></dd>
        <dt>Emitida por</dt><dd>${esc(ot.asignada_por_nombre || '—')}</dd>
        ${ot.instrucciones ? `<dt>Instrucciones</dt><dd>${esc(ot.instrucciones)}</dd>` : ''}
        ${['EN_CAMINO', 'EN_LUGAR', 'REPARANDO'].includes(ot.estado) ? `<dt>Ubicación</dt><dd>${enlaceMapa(ot.cuadrilla_lat, ot.cuadrilla_lng, 'Posición de la cuadrilla')} <span class="muted">(${haceMin(ot.fecha_ubicacion)}; solo personal de ENSA)</span></dd>` : ''}
        ${ot.distancia_km != null ? `<dt>Distancia</dt><dd>${ot.distancia_km} km al salir</dd>` : ''}
        ${ot.devoluciones ? `<dt>Devoluciones</dt><dd class="vencida">${ot.devoluciones} · ${esc(ot.observacion || '')}</dd>` : ''}
      </dl>
      ${pasosOrden(ot, ot.estado)}
      ${ot.causa ? `<dl class="dl"><dt>Causa</dt><dd>${esc(ot.causa)} <span class="etiqueta">${esc(RESPONSABILIDAD[ot.responsabilidad] || '')}</span></dd><dt>Trabajo</dt><dd>${esc(ot.trabajo_realizado || '')}</dd></dl>
        ${ot.foto_cierre ? `<img class="foto-cierre" src="/api/fotos/${esc(ot.foto_cierre)}" alt="Foto del trabajo terminado">` : ''}` : ''}
    </div>` : ''}
    ${validable ? `<form class="accion-form" data-accion="validar"><h3>Validar el cierre</h3>
      <p class="peq">Clientes que confirmaron que volvió el servicio: <b>${i.confirmaciones.si}</b>${i.confirmaciones.no ? ` · dijeron que no: <b class="vencida">${i.confirmaciones.no}</b>` : ''} de ${i.reportes.length}.</p>
      <label>Observación <span class="opc">(obligatoria para devolver)</span></label><input name="observacion" type="text" maxlength="300">
      <div class="acciones mt-s"><button class="btn btn-primario" type="submit" name="aprobar" value="1">Validar cierre</button><button class="btn btn-peligro" type="submit" name="aprobar" value="0">Devolver a la cuadrilla</button></div></form>` : ''}
    ${despachable ? `<form class="accion-form" data-accion="asignar"><h3>${ot ? 'Reasignar cuadrilla' : 'Emitir orden de trabajo'}</h3>
      <p class="ayuda">Cuadrillas de ${esc(i.area)}: primero las disponibles de la misma unidad de negocio y más cercanas.</p>
      <div class="candidatos" id="d-candidatos"><p class="muted">Cargando cuadrillas…</p></div>
      <label>Instrucciones para la cuadrilla <span class="opc">(opcional)</span></label><input name="instrucciones" type="text" maxlength="300" placeholder="Ej.: llevar escalera telescópica; cliente espera en la puerta">
      <button class="btn btn-primario mt-s" type="submit">${ot ? 'Reasignar' : 'Emitir orden de trabajo'}</button></form>` : ''}
    ${!despachable && i.estado === 'REGISTRADA' && u.rol === 'OPERADOR' ? `<div class="aviso aviso-info peq">La orden de trabajo la emite ${i.area_codigo === 'OPE' ? 'el Centro de Control de Operaciones' : `el supervisor de ${esc(i.area)}`}.</div>` : ''}
    ${fusionable ? `<form class="accion-form" data-accion="fusionar"><h3>¿Es un duplicado?</h3>
      <p class="ayuda">Si esta falla ya está registrada en otra incidencia abierta del mismo tipo, fusiónala: sus reportes pasan a la otra.</p>
      <div class="fila"><div><input name="destino" type="text" placeholder="INC-2026-000123" required></div><div><button class="btn btn-sec" type="submit">Fusionar</button></div></div></form>` : ''}
    ${anulable ? `<form class="accion-form" data-accion="anular"><h3>Anular</h3>
      <input name="comentario" type="text" maxlength="200" placeholder="Motivo (ej.: falla en instalación interna del cliente)" required>
      <button class="btn btn-peligro mt-s" type="submit">Anular incidencia</button></form>` : ''}
    <h3 class="mt">Reportes de clientes (${i.reportes.length})</h3>
    ${i.reportes.map((r) => `<div class="reporte-item">
      <b class="mono">${esc(r.codigo)}</b><span class="etiqueta">${esc(CANALES[r.canal] || r.canal)}</span>${r.es_duplicado ? `<span class="etiqueta dup">Duplicado · ${r.tipo_agrupacion === 'MANUAL' ? 'fusión manual' : 'agrupado auto.'}</span>` : ''}${r.autenticado ? '<span class="etiqueta auth">Con suministro</span>' : ''}${r.confirmacion_vigente ? `<span class="etiqueta ${r.confirmacion_vigente === 'SI' ? 'auth' : 'vencida'}">${r.confirmacion_vigente === 'SI' ? 'Confirmó: volvió la luz' : 'Dijo que sigue la falla'}</span>` : ''}
      <div>${esc(r.nombre)} · ${esc(r.telefono)}${r.email ? ` · ${esc(r.email)}` : ''}</div>
      <div class="muted">${fecha(r.fecha)}${r.suministro ? ` · Sum. ${esc(r.suministro)}` : ''}${r.sed ? ` · ${esc(r.sed)}` : ''}${r.registrado_por_nombre ? ` · registró ${esc(r.registrado_por_nombre)}` : ''}</div>
      <div>${esc(r.direccion)}${r.referencia ? ` (${esc(r.referencia)})` : ''}</div>
      ${r.encuesta ? `<div class="peq">Encuesta: ${r.encuesta.general ? `atención <span class="estrellas-fijas" aria-label="${r.encuesta.general} de 5">${'★'.repeat(r.encuesta.general)}<span class="apagadas">${'★'.repeat(5 - r.encuesta.general)}</span></span>` : ''}${r.encuesta.general && r.encuesta.rapidez ? ' · ' : ''}${r.encuesta.rapidez ? `rapidez <span class="estrellas-fijas" aria-label="${r.encuesta.rapidez} de 5">${'★'.repeat(r.encuesta.rapidez)}<span class="apagadas">${'★'.repeat(5 - r.encuesta.rapidez)}</span></span>` : ''}</div>` : ''}
      ${r.alcance ? `<div class="peq">Afecta: ${esc(ALCANCE[r.alcance])}${r.requiere_acceso ? ` · <b>acceso al predio: ${esc(r.franja_texto || '')}</b>` : ''}</div>` : ''}
      ${r.descripcion ? `<div><i>“${esc(r.descripcion)}”</i></div>` : ''}
      ${r.foto ? `<img src="/api/fotos/${esc(r.foto)}" alt="Foto del reporte ${esc(r.codigo)}" loading="lazy">` : ''}
    </div>`).join('')}
    ${i.ordenes.length > 1 ? `<h3 class="mt">Órdenes anteriores</h3>${i.ordenes.filter((o) => o.id !== i.orden_actual_id).map((o) => `<div class="peq">${esc(o.codigo)} · ${esc(o.cuadrilla_codigo)} · ${chipEstado(o.estado)} <span class="muted">${esc(o.observacion || '')}</span></div>`).join('')}` : ''}
    <h3 class="mt">Historial</h3>
    <ol class="linea">${i.historial.map((h) => `<li class="hecho"><b>${esc(ESTADOS[h.estado_nuevo] || h.estado_nuevo)}</b><span class="peq">${esc(h.comentario || '')}</span><br><span class="muted peq">${fecha(h.fecha)}${h.usuario ? ` · ${esc(h.usuario)}` : ' · Cliente'}</span></li>`).join('')}</ol>`;

  if (despachable) {
    try {
      const cand = await llamar(`/api/incidencias/${id}/candidatos`);
      const actual = ot ? ot.cuadrilla_codigo : null;
      $('#d-candidatos').innerHTML = cand.length ? cand.map((c, k) => {
        const off = c.estado === 'FUERA_DE_TURNO' || c.codigo === actual;
        return `<label class="candidato ${off ? 'deshabilitada' : ''}"><input type="radio" name="cuadrilla_id" value="${c.id}" ${off ? 'disabled' : ''} ${!off && k === cand.findIndex((x) => x.estado !== 'FUERA_DE_TURNO' && x.codigo !== actual) ? 'checked' : ''}>
          <span><b class="mono">${esc(c.codigo)}</b> · ${esc(c.nombre)} ${chipEstado(c.estado)}<br><span class="peq muted">${c.recomendada ? '<span class="etiqueta auth">Recomendada</span> ' : ''}${c.especialidad ? `${esc(c.especialidad)} · ` : ''}${c.tipo === 'PROPIA' ? 'Propia de ENSA' : esc(c.empresa)}${c.misma_unidad ? '' : ` · ${esc(c.unidad)}`}${c.orden_activa ? ` · atendiendo ${esc(c.orden_activa)}` : ''}${c.codigo === actual ? ' · asignada actualmente' : ''}</span></span>
          <span class="dato">${c.distancia_km != null ? `${c.distancia_km} km<br>~${c.eta_min} min` : '—'}${c.en_cola ? `<br>${c.en_cola} en cola` : ''}</span></label>`;
      }).join('') : '<p class="muted">No hay cuadrillas registradas para esta especialidad.</p>';
    } catch (e) { mostrarError($('#d-candidatos'), e); }
  }

  for (const f of $$('form[data-accion]', p)) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const acc = f.dataset.accion, datos = Object.fromEntries(new FormData(f).entries());
      if (acc === 'validar') datos.aprobar = e.submitter && e.submitter.value === '1';
      if (acc === 'anular' && !confirmarDosPasos(f.querySelector('button[type=submit]'), 'Confirmar anulación')) return;
      if (acc === 'asignar' && !datos.cuadrilla_id) { mostrarError($('#d-error'), { message: 'Elige una cuadrilla de la lista.' }); return; }
      f.classList.add('cargando'); mostrarError($('#d-error'));
      try {
        await llamar(`/api/incidencias/${id}/${acc}`, { metodo: 'POST', datos });
        await cargarBandeja();
        if (acc === 'fusionar') { const d = await llamar(`/api/incidencias/buscar/${encodeURIComponent(datos.destino)}`); verDetalle(d.id); } else verDetalle(id);
      } catch (err) { mostrarError($('#d-error'), err); $('#d-error').scrollIntoView({ block: 'nearest' }); } finally { f.classList.remove('cargando'); }
    });
  }
}

// ------------------------------------------------------------- cuadrillas y contratistas
async function vCuadrillas() {
  const c = S.catalogo, admin = S.usuario.rol === 'ADMIN';
  P.innerHTML = `
    <div class="cabecera"><h1>Cuadrillas</h1><span class="muted peq" id="cu-resumen"></span></div>
    <form class="filtros" id="cu-filtros">
      <div><label>Unidad</label><select name="unidad_id">${opcionesDe(c.unidades, '', 'Todas', unidadCorta)}</select></div>
      <div><label>Especialidad</label><select name="area_id">${opcionesDe(c.areas.filter((a) => a.codigo !== 'ATC'), S.usuario.rol === 'SUPERVISOR' || S.usuario.rol === 'DESPACHADOR' ? S.usuario.area_id : '', 'Todas')}</select></div>
    </form>
    <div class="tarjeta tabla-env" id="cu-lista"><p class="muted">Cargando…</p></div>
    <div class="tarjeta tabla-env"><h2>Empresas contratistas</h2>
      <p class="muted peq">Empresas con contrato vigente para emergencias, mantenimiento de redes y alumbrado público. Los nombres de esta demostración son ficticios.</p>
      <table><thead><tr><th>Empresa</th><th>Servicio contratado</th><th>Contrato</th><th>Vigencia</th></tr></thead><tbody>
      ${c.empresas.map((e) => `<tr><td><b>${esc(e.nombre)}</b>${e.ruc ? `<br><span class="mono peq">RUC ${esc(e.ruc)}</span>` : ''}</td><td class="peq">${esc(e.servicio)}</td><td class="peq">${esc(e.contrato || '—')}</td><td class="peq">${esc(e.vigencia_hasta || '—')}</td></tr>`).join('')}
      </tbody></table></div>
    ${admin ? `<div class="graficos">
      <form class="tarjeta" id="f-empresa" novalidate><h2>Nueva empresa contratista</h2>
        <label>Razón social</label><input name="nombre" type="text" maxlength="150" required>
        <div class="fila"><div><label>RUC</label><input name="ruc" type="text" inputmode="numeric" maxlength="11"></div><div><label>Contrato o proceso</label><input name="contrato" type="text" maxlength="80"></div></div>
        <label>Servicio contratado</label><input name="servicio" type="text" maxlength="300" required>
        <label>Vigencia hasta</label><input name="vigencia_hasta" type="date">
        <div id="e-empresa"></div><button class="btn btn-primario mt-s" type="submit">Registrar empresa</button></form>
      <form class="tarjeta" id="f-cuadrilla" novalidate><h2>Nueva cuadrilla</h2>
        <div class="fila"><div><label>Código</label><input name="codigo" type="text" maxlength="20" placeholder="EM-CH03" required></div><div><label>Nombre</label><input name="nombre" type="text" maxlength="80"></div></div>
        <div class="fila"><div><label>Tipo</label><select name="tipo" id="fc-tipo"><option value="PROPIA">Propia de ENSA</option><option value="CONTRATISTA">Contratista</option></select></div>
          <div id="fc-empresa" class="oculto"><label>Empresa</label><select name="empresa_id">${opcionesDe(c.empresas, '', 'Elige…')}</select></div></div>
        <div class="fila"><div><label>Especialidad</label><select name="area_id">${opcionesDe(c.areas.filter((a) => a.codigo !== 'ATC'), '')}</select></div>
          <div><label>Unidad de negocio</label><select name="unidad_negocio_id" id="fc-un">${opcionesDe(c.unidades, '', '', unidadCorta)}</select></div></div>
        <div class="fila"><div><label>Zona base</label><select name="zona_base_id" id="fc-zona"></select></div><div><label>Jefe de cuadrilla</label><select name="jefe_usuario_id" id="fc-jefe"><option value="">Sin asignar</option></select></div></div>
        <div class="fila"><div><label>Integrantes</label><input name="integrantes" type="number" min="1" max="10" value="3"></div><div><label>Vehículo (placa)</label><input name="vehiculo" type="text" maxlength="20"></div></div>
        <p class="ayuda">El jefe de cuadrilla debe existir como usuario con rol "Jefe de cuadrilla" (opción Usuarios).</p>
        <div id="e-cuadrilla"></div><button class="btn btn-primario mt-s" type="submit">Registrar cuadrilla</button></form>
    </div>` : ''}`;

  const cargar = async () => {
    const q = new URLSearchParams(Object.fromEntries([...new FormData($('#cu-filtros')).entries()].filter(([, v]) => v))).toString();
    try {
      const l = await llamar(`/api/cuadrillas?${q}`);
      const cuenta = (e) => l.filter((x) => x.estado === e).length;
      $('#cu-resumen').textContent = `${l.length} cuadrillas · ${cuenta('DISPONIBLE')} disponibles · ${cuenta('EN_SERVICIO')} en servicio · ${cuenta('FUERA_DE_TURNO')} fuera de turno`;
      $('#cu-lista').innerHTML = `<table><thead><tr><th>Cuadrilla</th><th>Responsable</th><th>Especialidad</th><th>Jefe</th><th>Estado</th><th>Orden en curso</th><th class="num">En cola</th><th>Última ubicación</th></tr></thead><tbody>
        ${l.map((x) => `<tr><td><b class="mono">${esc(x.codigo)}</b><br><span class="peq muted">${esc(x.nombre)} · ${esc(x.unidad.replace('Unidad de Negocio ', ''))}</span></td>
          <td class="peq">${x.tipo === 'PROPIA' ? 'Propia de ENSA' : esc(x.empresa)}</td><td class="peq">${esc(x.area)}</td>
          <td class="peq">${esc((x.jefe || '—').split(' · ')[0])}<br><span class="muted">${x.integrantes} integrantes${x.vehiculo ? ` · ${esc(x.vehiculo)}` : ''}</span></td>
          <td>${chipEstado(x.estado)}</td>
          <td class="peq">${x.orden_activa ? `<span class="mono">${esc(x.orden_activa.codigo)}</span><br>${esc(x.orden_activa.tipo)} · ${chipEstado(x.orden_activa.estado)}` : '—'}</td>
          <td class="num">${x.en_cola}</td>
          <td class="peq">${enlaceMapa(x.lat, x.lng, 'Mapa')} <span class="muted">${haceMin(x.fecha_ubicacion)}</span></td></tr>`).join('')}</tbody></table>`;
    } catch (e) { mostrarError($('#cu-lista'), e); }
  };
  $('#cu-filtros').addEventListener('change', cargar);
  cargar();
  S.refresco = setInterval(() => { if (S.vista === 'cuadrillas' && !document.hidden) cargar(); }, 30000);

  if (admin) {
    const zonas = () => { $('#fc-zona').innerHTML = opcionesDe(c.zonas.filter((z) => String(z.unidad_negocio_id) === $('#fc-un').value), ''); };
    $('#fc-un').addEventListener('change', zonas); zonas();
    $('#fc-tipo').addEventListener('change', () => $('#fc-empresa').classList.toggle('oculto', $('#fc-tipo').value !== 'CONTRATISTA'));
    llamar('/api/admin/usuarios').then((us) => {
      $('#fc-jefe').innerHTML += us.filter((x) => x.rol === 'JEFE_CUADRILLA' && x.activo).map((x) => `<option value="${x.id}">${esc(x.nombre.split(' · ')[0])} (${esc(x.usuario)})</option>`).join('');
    }).catch(() => {});
    const enviar = (form, ruta, err) => form.addEventListener('submit', async (e) => {
      e.preventDefault(); mostrarError($(err));
      try {
        await llamar(ruta, { metodo: 'POST', datos: Object.fromEntries(new FormData(form).entries()) });
        S.catalogo = await llamar('/api/catalogo'); vCuadrillas();
      } catch (ex) { mostrarError($(err), ex); }
    });
    enviar($('#f-empresa'), '/api/admin/contratistas', '#e-empresa');
    enviar($('#f-cuadrilla'), '/api/admin/cuadrillas', '#e-cuadrilla');
  }
}

// ------------------------------------------------------------- app del jefe de cuadrilla (celular)
const GPS = { watch: null, ultimoEnvio: 0, estado: 'Ubicación no activada' };
function seguirUbicacion(activar) {
  if (!activar) { if (GPS.watch != null) navigator.geolocation.clearWatch(GPS.watch); GPS.watch = null; GPS.estado = 'Fuera de turno: no se comparte la ubicación'; return; }
  if (GPS.watch != null || !navigator.geolocation) return;
  GPS.watch = navigator.geolocation.watchPosition(async (pos) => {
    GPS.ultima = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (Date.now() - GPS.ultimoEnvio < 60000) return; // como máximo una vez por minuto
    GPS.ultimoEnvio = Date.now();
    try { await llamar('/api/cuadrilla/ubicacion', { metodo: 'POST', datos: GPS.ultima }); GPS.estado = `Ubicación compartida con el Centro de Control · ${hora(new Date().toISOString())}`; } catch (e) { GPS.estado = e.message; }
    const el = $('#j-gps'); if (el) el.textContent = GPS.estado;
  }, () => { GPS.estado = 'Activa el GPS y da permiso de ubicación'; const el = $('#j-gps'); if (el) el.textContent = GPS.estado; }, { enableHighAccuracy: true, maximumAge: 30000 });
}

async function vMisOrdenes() {
  P.innerHTML = '<div id="j-cont"><p class="muted">Cargando…</p></div>';
  const pintar = async () => {
    let d;
    try { d = await llamar('/api/cuadrilla/ordenes'); } catch (e) { mostrarError($('#j-cont'), e); return; }
    const c = d.cuadrilla;
    seguirUbicacion(!!c.en_turno);
    const activa = d.ordenes.find((o) => ['EN_CAMINO', 'EN_LUGAR', 'REPARANDO'].includes(o.estado));
    const cola = d.ordenes.filter((o) => o.estado === 'ASIGNADA');
    const cerradas = d.ordenes.filter((o) => ['RESTABLECIDA', 'VALIDADA'].includes(o.estado));
    const tarjeta = (o, principal) => `<div class="tarjeta" data-ot="${o.id}">
      <div class="jefe-cab"><h2 class="mono">${esc(o.codigo)}</h2>${chipEstado(o.estado)}</div>
      <p><b>${esc(o.tipo)}</b> · <span class="prio p-${o.prioridad}">${esc(o.prioridad)}</span> · ${esc(o.incidencia)}<br>${esc(o.direccion)} · ${esc(o.zona)}<br>
        ${o.lat != null ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}" target="_blank" rel="noopener">${icono('mapa')} Cómo llegar</a> · ` : ''}<span class="muted">Plazo: ${fecha(o.fecha_limite)} · ${o.cantidad_reportes} reporte(s)</span></p>
      ${o.instrucciones ? `<div class="aviso aviso-info peq"><b>Instrucciones:</b> ${esc(o.instrucciones)}</div>` : ''}
      ${o.observacion && o.devoluciones ? `<div class="aviso aviso-alerta peq"><b>Devuelta por el supervisor:</b> ${esc(o.observacion)}</div>` : ''}
      ${o.reportes.filter((r) => r.requiere_acceso).map((r) => `<div class="aviso aviso-alerta peq"><b>Necesita entrar al predio.</b> Contacto: ${esc(r.contacto)} · ${esc(r.franja || '')}</div>`).join('')}
      ${principal ? `${o.reportes.filter((r) => r.descripcion || r.referencia).map((r) => `<div class="peq">· ${esc([r.referencia, r.descripcion].filter(Boolean).join(' — '))}</div>`).join('')}
        ${o.estado === 'EN_CAMINO' ? `<p class="mt-s">Llegada estimada que ve el cliente: <span class="eta-grande">${hora(o.eta)}</span></p>
          <form class="fila" data-paso="eta"><div><input name="eta_min" type="number" min="1" max="600" placeholder="Minutos para llegar"></div><div><button class="btn btn-sec" type="submit">Corregir hora</button></div></form>
          <button class="btn btn-primario boton-paso mt-s" data-paso="en_lugar" type="button">${icono('mapa')} Llegué al lugar</button>` : ''}
        ${o.estado === 'EN_LUGAR' ? `<button class="btn btn-primario boton-paso mt-s" data-paso="reparando" type="button">${icono('herramienta')} Iniciar reparación</button>` : ''}
        ${['EN_LUGAR', 'REPARANDO'].includes(o.estado) ? `<form class="accion-form" data-paso="restablecer"><h3>Servicio restablecido</h3>
          <label>Causa de la falla</label><select name="causa_id" required><option value="">Elige…</option>${d.causas.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select>
          <label>Trabajo realizado</label><textarea name="trabajo_realizado" maxlength="500" required placeholder="Ej.: se cambió el fusible de la SED y se probó el servicio"></textarea>
          <label>Foto del trabajo terminado</label><input name="foto_archivo" type="file" accept="image/*" capture="environment" required>
          <button class="btn btn-primario boton-paso mt-s" type="submit">${icono('ok')} Servicio restablecido</button></form>` : ''}` : ''}
      ${o.estado === 'ASIGNADA' ? `<form class="fila mt-s" data-paso="en_camino"><div><input name="eta_min" type="number" min="1" max="600" placeholder="Minutos (opcional; se calcula solo)"></div>
        <div><button class="btn btn-primario" type="submit" ${activa || !c.en_turno ? 'disabled' : ''}>${icono('camion')} Salir: en camino</button></div></form>
        ${activa ? '<p class="ayuda">Termina la orden en curso para salir a esta.</p>' : ''}` : ''}
    </div>`;
    $('#j-cont').innerHTML = `
      <div class="tarjeta"><div class="jefe-cab"><div><h1 class="sin-margen">${esc(c.codigo)} · ${esc(c.nombre)}</h1>
        <span class="muted peq">${c.tipo === 'PROPIA' ? 'Cuadrilla propia de ENSA' : esc(c.empresa)} · ${esc(c.area)} · ${esc(c.unidad.replace('Unidad de Negocio ', ''))}</span></div>
        <div>${chipEstado(c.estado)} <button class="btn ${c.en_turno ? 'btn-sec' : 'btn-primario'}" id="j-turno" type="button">${c.en_turno ? 'Terminar turno' : 'Iniciar turno'}</button></div></div>
        <p class="peq muted mt-s" id="j-gps">${esc(GPS.estado)}</p></div>
      <div id="j-error"></div>
      ${activa ? tarjeta(activa, true) : '<div class="aviso aviso-info">No tienes una orden en curso.</div>'}
      <h2 class="mt">En cola (${cola.length})</h2>${cola.length ? cola.map((o) => tarjeta(o, false)).join('') : '<p class="muted">Sin órdenes pendientes.</p>'}
      ${cerradas.length ? `<h2 class="mt">Cerradas en las últimas 24 h</h2>${cerradas.map((o) => `<div class="peq">${esc(o.codigo)} · ${esc(o.tipo)} · ${esc(o.direccion)} · ${chipEstado(o.estado)}</div>`).join('')}` : ''}`;

    $('#j-turno').addEventListener('click', async () => {
      try { await llamar('/api/cuadrilla/turno', { metodo: 'POST', datos: { en_turno: !c.en_turno } }); pintar(); } catch (e) { mostrarError($('#j-error'), e); }
    });
    const enviarPaso = async (otId, paso, datos) => {
      mostrarError($('#j-error'));
      try { await llamar(`/api/ordenes/${otId}/${paso}`, { metodo: 'POST', datos }); await pintar(); window.scrollTo(0, 0); } catch (e) { mostrarError($('#j-error'), e); $('#j-error').scrollIntoView({ block: 'nearest' }); }
    };
    for (const b of $$('button[data-paso]', $('#j-cont'))) {
      b.addEventListener('click', () => enviarPaso(b.closest('[data-ot]').dataset.ot, b.dataset.paso, {}));
    }
    for (const f of $$('form[data-paso]', $('#j-cont'))) {
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otId = f.closest('[data-ot]').dataset.ot, paso = f.dataset.paso;
        const datos = Object.fromEntries(new FormData(f).entries());
        delete datos.foto_archivo;
        if (paso === 'en_camino' && GPS.ultima) Object.assign(datos, GPS.ultima);
        if (!datos.eta_min) delete datos.eta_min;
        if (paso === 'restablecer') {
          const archivo = f.querySelector('input[type=file]').files[0];
          if (!archivo) { mostrarError($('#j-error'), { message: 'Toma una foto del trabajo terminado.' }); return; }
          try { datos.foto = await reducirFoto(archivo); } catch (ex) { mostrarError($('#j-error'), ex); return; }
        }
        f.classList.add('cargando');
        await enviarPaso(otId, paso, datos);
        f.classList.remove('cargando');
      });
    }
  };
  await pintar();
  S.refresco = setInterval(() => { if (S.vista === 'mis-ordenes' && !document.hidden && !document.activeElement.matches('input,textarea,select')) pintar(); }, 30000);
}
