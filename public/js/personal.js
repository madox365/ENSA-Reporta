// Vista del personal: bandeja, registro telefónico, tablero y administración
'use strict';

const S = { usuario: null, csrf: null, catalogo: null, vista: null, sel: null, filtros: { estado: 'ABIERTAS' }, refresco: null };
const MENU = [
  { id: 'mis-ordenes', nombre: 'Mis órdenes de trabajo', icono: 'bandeja', roles: ['JEFE_CUADRILLA'] },
  { id: 'bandeja', nombre: 'Bandeja de incidencias', icono: 'bandeja', roles: ['ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR'] },
  { id: 'registrar', nombre: 'Registrar reporte', icono: 'mas', roles: ['ADMIN', 'OPERADOR', 'DESPACHADOR'] },
  { id: 'cuadrillas', nombre: 'Cuadrillas', icono: 'usuarios', roles: ['ADMIN', 'DESPACHADOR', 'SUPERVISOR', 'OPERADOR', 'GERENCIA'] },
  { id: 'tablero', nombre: 'Tablero de indicadores', icono: 'tablero', roles: ['ADMIN', 'OPERADOR', 'DESPACHADOR', 'SUPERVISOR', 'GERENCIA'] },
  { id: 'notificaciones', nombre: 'Avisos enviados', icono: 'campana', roles: ['ADMIN', 'OPERADOR', 'DESPACHADOR'] },
  { id: 'catalogo', nombre: 'Catálogo de incidencias', icono: 'ajustes', roles: ['ADMIN'] },
  { id: 'usuarios', nombre: 'Usuarios', icono: 'usuarios', roles: ['ADMIN'] },
  { id: 'auditoria', nombre: 'Auditoría', icono: 'escudo', roles: ['ADMIN'] },
];
const ROLES = { ADMIN: 'Administrador TIC', OPERADOR: 'Atención al Cliente', DESPACHADOR: 'Centro de Control de Operaciones', SUPERVISOR: 'Supervisor de área', JEFE_CUADRILLA: 'Jefe de cuadrilla', GERENCIA: 'Gerencia' };
const P = $('#principal');
const llamar = (ruta, op = {}) => api(ruta, { ...op, csrf: S.csrf }).catch((e) => { if (e.estado === 401) mostrarLogin(e.message); throw e; });
const anchos = (raiz = document) => { for (const el of $$('[data-w]', raiz)) el.style.width = `${el.dataset.w}%`; };

// ------------------------------------------------------------- sesión
async function iniciar() {
  $('#logo').innerHTML = LOGO;
  $('#btn-salir').innerHTML = `${icono('salir')} Salir`;
  const s = await api('/api/auth/sesion').catch(() => ({ usuario: null }));
  if (s.usuario) entrar(s); else mostrarLogin();
}
function mostrarLogin(msg) {
  clearInterval(S.refresco);
  S.usuario = null; S.csrf = null;
  $('#v-app').classList.add('oculto'); $('#v-login').classList.remove('oculto');
  $('#chip-usuario').classList.add('oculto'); $('#btn-salir').classList.add('oculto');
  mostrarError($('#e-login'), msg ? { message: msg } : null);
}
$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; mostrarError($('#e-login'));
  try {
    const s = await api('/api/auth/login', { metodo: 'POST', datos: { usuario: $('#l-usuario').value, clave: $('#l-clave').value } });
    $('#l-clave').value = '';
    entrar(s);
  } catch (err) { mostrarError($('#e-login'), err); } finally { btn.disabled = false; }
});
$('#btn-salir').addEventListener('click', async () => { await api('/api/auth/logout', { metodo: 'POST', datos: {} }).catch(() => {}); mostrarLogin(); });

async function entrar(s) {
  S.usuario = s.usuario; S.csrf = s.csrf;
  S.catalogo = await llamar('/api/catalogo');
  if (['SUPERVISOR', 'DESPACHADOR'].includes(S.usuario.rol) && S.usuario.area_id) S.filtros.area_id = String(S.usuario.area_id);
  $('#v-login').classList.add('oculto'); $('#v-app').classList.remove('oculto');
  $('#chip-usuario').innerHTML = `<b>${esc(S.usuario.nombre.split(' · ')[0])}</b>${esc(ROLES[S.usuario.rol])}`;
  $('#chip-usuario').classList.remove('oculto'); $('#btn-salir').classList.remove('oculto');
  const opciones = MENU.filter((m) => m.roles.includes(S.usuario.rol));
  $('#menu').innerHTML = `<div class="rol">${esc(ROLES[S.usuario.rol])}</div>` + opciones.map((m) => `<button type="button" data-vista="${m.id}">${icono(m.icono)} ${esc(m.nombre)}</button>`).join('');
  for (const b of $$('#menu [data-vista]')) b.addEventListener('click', () => abrir(b.dataset.vista));
  const inicial = location.hash.slice(1);
  abrir(opciones.some((o) => o.id === inicial) ? inicial : opciones[0].id);
}

function abrir(vista) {
  S.vista = vista;
  history.replaceState(null, '', `#${vista}`);
  for (const b of $$('#menu [data-vista]')) b.classList.toggle('activo', b.dataset.vista === vista);
  clearInterval(S.refresco);
  ({ 'mis-ordenes': vMisOrdenes, cuadrillas: vCuadrillas, bandeja: vBandeja, registrar: vRegistrar, tablero: vTablero, notificaciones: vNotificaciones, catalogo: vCatalogo, usuarios: vUsuarios, auditoria: vAuditoria })[vista]();
}

const opcionesDe = (lista, valor, vacio, etiqueta = (x) => x.nombre) =>
  (vacio ? `<option value="">${esc(vacio)}</option>` : '') + lista.map((x) => `<option value="${x.id}" ${String(x.id) === String(valor) ? 'selected' : ''}>${esc(etiqueta(x))}</option>`).join('');
const unidadCorta = (u) => u.nombre.replace('Unidad de Negocio ', '');

function restante(inc) {
  if (!ABIERTOS.includes(inc.estado)) {
    if (['SOLUCIONADA', 'RESTABLECIDA'].includes(inc.estado) && inc.fecha_solucion) {
      const enPlazo = inc.fecha_solucion <= inc.fecha_limite;
      return `<span class="${enPlazo ? '' : 'vencida'}">${enPlazo ? 'En plazo' : 'Fuera de plazo'}</span>`;
    }
    return '—';
  }
  const h = (new Date(inc.fecha_limite) - Date.now()) / 3600e3;
  if (h < 0) return `<span class="vencida">Vencida hace ${duracion(-h)}</span>`;
  return `<span class="${h < 2 ? 'porvencer' : ''}">Quedan ${duracion(h)}</span>`;
}

// ------------------------------------------------------------- bandeja
function vBandeja() {
  const f = S.filtros, c = S.catalogo;
  P.innerHTML = `
    <div class="cabecera"><h1>Bandeja de incidencias</h1><span class="muted peq" id="b-total"></span></div>
    <form class="filtros" id="b-filtros">
      <div><label for="f-estado">Estado</label><select id="f-estado" name="estado">
        ${[['ABIERTAS', 'Abiertas'], ['', 'Todas'], ['REGISTRADA', 'Por despachar'], ['ASIGNADA', 'Con orden de trabajo'], ['EN_CAMPO', 'Cuadrilla en campo'], ['RESTABLECIDA', 'Por validar'], ['SOLUCIONADA', 'Solucionadas'], ['ANULADA', 'Anuladas']].map(([v, t]) => `<option value="${v}" ${f.estado === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
      <div><label for="f-unidad">Unidad</label><select id="f-unidad" name="unidad_id">${opcionesDe(c.unidades, f.unidad_id, 'Todas', unidadCorta)}</select></div>
      <div><label for="f-tipo">Tipo</label><select id="f-tipo" name="tipo_id">${opcionesDe(c.tipos, f.tipo_id, 'Todos')}</select></div>
      <div><label for="f-area">Área</label><select id="f-area" name="area_id">${opcionesDe(c.areas, f.area_id, 'Todas')}</select></div>
      <div><label for="f-desde">Desde</label><input type="date" id="f-desde" name="desde" value="${esc(f.desde || '')}"></div>
      <div><label for="f-hasta">Hasta</label><input type="date" id="f-hasta" name="hasta" value="${esc(f.hasta || '')}"></div>
      <div><label for="f-q">Buscar</label><input type="text" id="f-q" name="q" placeholder="Código, celular, suministro…" value="${esc(f.q || '')}"></div>
      <div><label class="check"><input type="checkbox" name="vencidas" value="1" ${f.vencidas === '1' ? 'checked' : ''}> Solo vencidas</label></div>
    </form>
    <div class="bandeja">
      <div class="tarjeta tabla-env" id="b-lista"><p class="muted">Cargando…</p></div>
      <aside class="tarjeta panel" id="b-detalle"><p class="muted">Selecciona una incidencia para ver su detalle y atenderla.</p></aside>
    </div>`;
  const form = $('#b-filtros');
  form.addEventListener('change', () => { leerFiltros(form); cargarBandeja(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); leerFiltros(form); cargarBandeja(); });
  let t; $('#f-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { leerFiltros(form); cargarBandeja(); }, 350); });
  cargarBandeja();
  if (S.sel) verDetalle(S.sel);
  S.refresco = setInterval(() => { if (S.vista === 'bandeja' && !document.hidden) cargarBandeja(true); }, 60000);
}
function leerFiltros(form) {
  const fd = new FormData(form);
  S.filtros = Object.fromEntries([...fd.entries()].filter(([, v]) => v !== ''));
  if (!fd.has('estado')) S.filtros.estado = '';
}

async function cargarBandeja(silencioso = false) {
  const cont = $('#b-lista');
  if (!cont) return;
  try {
    const q = new URLSearchParams(S.filtros).toString();
    const lista = await llamar(`/api/incidencias?${q}`);
    $('#b-total').textContent = `${lista.length} incidencia(s)${lista.length >= 300 ? ' · se muestran las 300 primeras' : ''}`;
    cont.innerHTML = lista.length ? `<table><thead><tr><th>Incidencia</th><th>Tipo / zona</th><th class="num">Rep.</th><th>Estado</th><th>Plazo</th><th>Cuadrilla</th></tr></thead><tbody>
      ${lista.map((i) => `<tr class="clic ${i.id === S.sel ? 'sel' : ''}" data-id="${i.id}">
        <td><span class="mono sin-corte">${esc(i.codigo)}</span><br><span class="prio p-${i.prioridad}">${esc(i.prioridad)}</span> <span class="muted peq">${fecha(i.fecha_registro)}</span></td>
        <td>${esc(i.tipo)}<br><span class="muted peq">${esc(i.zona)} · ${esc(i.direccion.slice(0, 34))}</span></td>
        <td class="num">${i.cantidad_reportes}</td>
        <td>${chipEstado(i.estado)}</td>
        <td class="peq">${restante(i)}</td>
        <td class="peq">${i.cuadrilla ? `<b class="mono">${esc(i.cuadrilla)}</b>${i.orden_estado === 'EN_CAMINO' && i.eta ? `<br><span class="muted">llega ${fecha(i.eta).slice(-5)}</span>` : ''}` : `<span class="muted">Sin asignar</span>`}${i.requiere_acceso ? '<br><span class="etiqueta" title="La cuadrilla debe entrar al predio">acceso</span>' : ''}${i.reaperturas ? '<br><span class="etiqueta vencida" title="El cliente indicó que la falla continúa">reabierta</span>' : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">No hay incidencias con estos filtros.</p>';
    for (const tr of $$('tr[data-id]', cont)) tr.addEventListener('click', () => verDetalle(Number(tr.dataset.id)));
  } catch (e) { if (!silencioso) mostrarError(cont, e); }
}

// ------------------------------------------------------------- registro por teléfono u oficina
function vRegistrar() {
  const c = S.catalogo;
  P.innerHTML = `
    <div class="cabecera"><h1>Registrar reporte</h1></div>
    <form class="tarjeta" id="f-reg" novalidate>
      <p class="muted">Para clientes que llaman a la central, escriben por WhatsApp o se acercan a una oficina. El sistema agrupa el reporte si la falla ya está registrada.</p>
      <div class="fila">
        <div><label for="g-canal">Canal</label><select id="g-canal" name="canal"><option value="TELEFONO">Teléfono (central)</option><option value="OFICINA">Oficina</option><option value="WHATSAPP">WhatsApp</option></select></div>
        <div><label for="g-tipo">Tipo de incidencia</label><select id="g-tipo" name="tipo_id" required>${opcionesDe(c.tipos, '', 'Selecciona…')}</select></div>
      </div>
      <label for="g-suministro">N.° de suministro <span class="opc">(si el cliente lo tiene)</span></label>
      <div class="fila"><div><input id="g-suministro" name="suministro" type="text" inputmode="numeric" maxlength="12"></div><div><button class="btn btn-sec" type="button" id="g-buscar">${icono('buscar')} Buscar en padrón</button></div></div>
      <div id="g-padron"></div>
      <div class="fila">
        <div><label for="g-unidad">Unidad</label><select id="g-unidad">${opcionesDe(c.unidades, '', '', unidadCorta)}</select></div>
        <div><label for="g-zona">Distrito o zona</label><select id="g-zona" name="zona_id" required></select></div>
      </div>
      <label for="g-direccion">Dirección o lugar</label><input id="g-direccion" name="direccion" type="text" maxlength="200" required>
      <label for="g-referencia">Referencia <span class="opc">(opcional)</span></label><input id="g-referencia" name="referencia" type="text" maxlength="200">
      <div id="g-alcance" class="oculto">
        <label for="g-alcance-sel">¿A quién afecta?</label>
        <select id="g-alcance-sel" name="alcance"><option value="VARIAS_CASAS">Varias casas o toda la calle</option><option value="SOLO_MI_CASA">Solo la casa del cliente</option><option value="NO_SE">No sabe</option></select>
        <div id="g-acceso" class="oculto">
          <label class="check mt-s"><input type="checkbox" name="requiere_acceso" value="1" id="g-requiere"> La cuadrilla necesitará entrar al predio (medidor dentro de la casa o medir la luz baja)</label>
          <div id="g-franja-campo" class="oculto"><label for="g-franja">Horario en que habrá alguien</label><select id="g-franja" name="franja_horaria">${(c.franjas || []).map((x) => `<option value="${x.codigo}">${esc(x.nombre)}</option>`).join('')}</select></div>
        </div>
      </div>
      <label for="g-descripcion">Lo que informa el cliente <span class="opc">(opcional)</span></label><textarea id="g-descripcion" name="descripcion" maxlength="500"></textarea>
      <div class="fila">
        <div><label for="g-nombre">Nombre del cliente</label><input id="g-nombre" name="nombre" type="text" maxlength="120" required></div>
        <div><label for="g-telefono">Celular de contacto</label><input id="g-telefono" name="telefono" type="tel" maxlength="9" required></div>
      </div>
      <div class="fila">
        <div><label for="g-documento">DNI <span class="opc">(opcional)</span></label><input id="g-documento" name="documento" type="text" maxlength="8"></div>
        <div><label for="g-email">Correo <span class="opc">(opcional)</span></label><input id="g-email" name="email" type="email" maxlength="120"></div>
      </div>
      <p class="ayuda">Informe al cliente que sus datos se usan solo para atender el reporte (Ley N.° 29733) y entréguele el número de seguimiento.</p>
      <div id="g-error"></div>
      <button class="btn btn-acento btn-grande mt" type="submit">Registrar reporte</button>
    </form>
    <div id="g-resultado"></div>`;
  const alcance = () => {
    const t = c.tipos.find((x) => String(x.id) === $('#g-tipo').value);
    const aplica = t && ['CORTE', 'TENSION'].includes(t.codigo);
    $('#g-alcance').classList.toggle('oculto', !aplica);
    $('#g-acceso').classList.toggle('oculto', !aplica || $('#g-alcance-sel').value !== 'SOLO_MI_CASA');
    $('#g-franja-campo').classList.toggle('oculto', !aplica || $('#g-alcance-sel').value !== 'SOLO_MI_CASA' || !$('#g-requiere').checked);
  };
  for (const id of ['#g-tipo', '#g-alcance-sel', '#g-requiere']) $(id).addEventListener('change', alcance);
  const zonas = () => { $('#g-zona').innerHTML = opcionesDe(c.zonas.filter((z) => String(z.unidad_negocio_id) === $('#g-unidad').value), '', 'Selecciona…'); };
  $('#g-unidad').addEventListener('change', zonas); zonas();
  $('#g-buscar').addEventListener('click', async () => {
    const n = $('#g-suministro').value.trim();
    if (!n) return;
    try {
      const s = await llamar(`/api/suministros/${encodeURIComponent(n)}`);
      const z = c.zonas.find((x) => x.id === s.zona_id);
      $('#g-unidad').value = z.unidad_negocio_id; zonas(); $('#g-zona').value = s.zona_id;
      $('#g-direccion').value = s.direccion; $('#g-nombre').value = s.titular; if (s.telefono) $('#g-telefono').value = s.telefono;
      $('#g-padron').innerHTML = `<div class="aviso aviso-ok peq">Titular: <b>${esc(s.titular)}</b> · ${esc(s.direccion)}, ${esc(s.zona)} · ${esc(s.sed || '')}. Confirme el nombre y celular con quien llama.</div>`;
    } catch (e) { mostrarError($('#g-padron'), e); }
  });
  $('#f-reg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; f.classList.add('cargando'); mostrarError($('#g-error'));
    try {
      const datos = Object.fromEntries(new FormData(f).entries());
      if ($('#g-alcance').classList.contains('oculto')) { delete datos.alcance; delete datos.requiere_acceso; delete datos.franja_horaria; }
      if (!datos.requiere_acceso) delete datos.franja_horaria;
      const r = await llamar('/api/reportes', { metodo: 'POST', datos });
      $('#g-resultado').innerHTML = `<div class="tarjeta"><div class="aviso aviso-ok"><b>Reporte registrado.</b> Dicte al cliente su número de seguimiento:</div>
        <div class="codigo-grande">${esc(r.numero_seguimiento)}</div>
        ${r.requiere_acceso ? `<div class="aviso aviso-alerta">Indique al cliente que la cuadrilla necesitará entrar al predio (${esc(r.franja_horaria)}).</div>` : ''}
        <p>${r.agrupado ? `La falla ya estaba registrada: se agrupó en <b class="mono">${esc(r.incidencia)}</b> (${esc(r.criterio)}), que suma ${r.cantidad_reportes} reportes.` : `Se abrió la incidencia <b class="mono">${esc(r.incidencia)}</b>. Plazo de atención: ${r.plazo_horas} h.`}</p>
        <div class="acciones"><button class="btn btn-sec" type="button" id="g-ver">Ver incidencia</button></div></div>`;
      $('#g-ver').addEventListener('click', async () => { const d = await llamar(`/api/incidencias/buscar/${r.incidencia}`); S.sel = d.id; S.filtros = { estado: '' }; abrir('bandeja'); });
      f.reset(); zonas(); alcance(); $('#g-padron').innerHTML = '';
      $('#g-resultado').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { mostrarError($('#g-error'), err); } finally { f.classList.remove('cargando'); }
  });
}

// ------------------------------------------------------------- tablero
let tableroFiltros = {};
function vTablero() {
  const c = S.catalogo, f = tableroFiltros;
  P.innerHTML = `
    <div class="cabecera"><h1>Tablero de indicadores</h1><a class="btn btn-sec" id="t-csv" href="#">Descargar CSV del periodo</a></div>
    <form class="filtros" id="t-filtros">
      <div><label>Desde</label><input type="date" name="desde" value="${esc(f.desde || '')}"></div>
      <div><label>Hasta</label><input type="date" name="hasta" value="${esc(f.hasta || '')}"></div>
      <div><label>Unidad</label><select name="unidad_id">${opcionesDe(c.unidades, f.unidad_id, 'Todas', unidadCorta)}</select></div>
      <div><label>Tipo</label><select name="tipo_id">${opcionesDe(c.tipos, f.tipo_id, 'Todos')}</select></div>
    </form>
    <div id="t-cont"><p class="muted">Calculando…</p></div>`;
  $('#t-filtros').addEventListener('change', (e) => { tableroFiltros = Object.fromEntries([...new FormData(e.currentTarget).entries()].filter(([, v]) => v)); cargarTablero(); });
  cargarTablero();
}

async function cargarTablero() {
  const cont = $('#t-cont');
  const q = new URLSearchParams(tableroFiltros).toString();
  $('#t-csv').href = `/api/indicadores/csv?${q}`;
  let d;
  try { d = await llamar(`/api/indicadores?${q}`); } catch (e) { mostrarError(cont, e); return; }
  const k = d.kpi, t = d.totales;
  const meta = (valor, metaV, mayorEsMejor = true) => {
    if (valor == null) return '<div class="meta muted">Sin datos en el periodo</div>';
    const ok = mayorEsMejor ? valor >= metaV : valor <= metaV;
    return `<div class="meta ${ok ? 'cumple' : 'nocumple'}">${icono(ok ? 'ok' : 'x')} ${ok ? 'Cumple' : 'No cumple'} la meta (${mayorEsMejor ? '≥' : '≤'} ${metaV}%)</div>`;
  };
  const maxZona = Math.max(1, ...d.por_zona.map((z) => z.reportes));
  const maxCanal = Math.max(1, ...d.por_canal.map((x) => x.reportes));
  const maxEstrellas = Math.max(1, ...d.satisfaccion.distribucion.map((x) => x.encuestas));
  cont.innerHTML = `
    <p class="muted peq">Periodo: ${fecha(`${d.periodo.desde}T12:00:00Z`, false)} al ${fecha(`${d.periodo.hasta}T12:00:00Z`, false)} · fecha de registro de la incidencia · hora de Lima</p>
    <div class="kpis">
      <div class="kpi"><div class="nombre">KPI 1 · Tiempo medio desde el reporte hasta la solución</div>
        <div class="valor">${k.tiempo_medio_atencion_h == null ? '—' : k.tiempo_medio_atencion_h}<small> h</small></div>
        <div class="meta muted">Hasta el restablecimiento. Llegada de la cuadrilla: ${k.tiempo_medio_llegada_h ?? '—'} h · la meta se fija con la línea base</div></div>
      <div class="kpi"><div class="nombre">KPI 2 · Duplicados agrupados automáticamente</div>
        <div class="valor">${k.pct_duplicados_agrupados_auto ?? '—'}<small>%</small></div>
        ${meta(k.pct_duplicados_agrupados_auto, k.meta_duplicados)}</div>
      <div class="kpi"><div class="nombre">KPI 3 · Incidencias atendidas dentro del plazo</div>
        <div class="valor">${k.pct_en_plazo ?? '—'}<small>%</small></div>
        ${meta(k.pct_en_plazo, k.meta_en_plazo)}</div>
      <div class="kpi"><div class="nombre">Satisfacción del cliente · atención en general (encuesta opcional)</div>
        <div class="valor">${k.satisfaccion_promedio ?? '—'}<small> / 5 ★</small></div>
        ${k.pct_satisfechos == null ? '<div class="meta muted">Sin encuestas en el periodo</div>' : `<div class="meta ${k.pct_satisfechos >= k.meta_satisfaccion ? 'cumple' : 'nocumple'}">${icono(k.pct_satisfechos >= k.meta_satisfaccion ? 'ok' : 'x')} ${k.pct_satisfechos}% satisfechos (4 o 5 ★) · meta ≥ ${k.meta_satisfaccion}%</div>`}</div>
      <div class="kpi"><div class="nombre">Incidencias abiertas ahora en el periodo</div>
        <div class="valor">${t.abiertas}</div>
        <div class="meta ${t.vencidas ? 'nocumple' : 'cumple'}">${icono(t.vencidas ? 'x' : 'ok')} ${t.vencidas} vencida(s)</div></div>
    </div>
    <div class="totales">
      <span><b>${t.reportes}</b> reportes de clientes</span>
      <span><b>${t.incidencias}</b> incidencias</span>
      <span><b>${t.duplicados}</b> duplicados agrupados (${k.pct_reportes_duplicados ?? 0}% de los reportes; ${t.duplicados_auto} automáticos, ${t.duplicados_manual} por fusión manual)</span>
      <span><b>${t.solucionadas}</b> con servicio restablecido, <b>${t.en_plazo}</b> en plazo</span>
      <span><b>${t.anuladas}</b> anuladas</span>
      <span><b>${t.por_validar}</b> por validar</span>
      <span><b>${t.reabiertas}</b> reabiertas por el cliente</span>
      <span><b>${t.confirmaciones_si}</b> clientes confirmaron que volvió el servicio${t.confirmaciones_no ? `, <b>${t.confirmaciones_no}</b> dijeron que no` : ''}</span>
    </div>
    <div class="graficos">
      <div class="tarjeta"><h3>Atendidas en plazo por semana</h3><p class="muted peq">Porcentaje de incidencias solucionadas dentro del plazo. Línea punteada: meta de 90%.</p><div id="g-tendencia"></div></div>
      <div class="tarjeta"><h3>Reportes por distrito o zona</h3><p class="muted peq">Las 12 zonas con más reportes.</p>
        <div class="barras">${d.por_zona.slice(0, 12).map((z) => `<div class="barra-fila" data-tip="${esc(z.nombre)}: ${z.reportes} reportes, ${z.incidencias} incidencias, ${z.pct_en_plazo ?? '—'}% en plazo"><span class="n">${esc(z.nombre)}</span><span class="pista"><span class="relleno" data-w="${(100 * z.reportes / maxZona).toFixed(1)}"></span></span><span class="v">${z.reportes}</span></div>`).join('') || '<p class="muted">Sin datos.</p>'}</div></div>
      <div class="tarjeta"><h3>Por tipo de incidencia</h3>
        <div class="tabla-env"><table><thead><tr><th>Tipo</th><th class="num">Incid.</th><th class="num">Reportes</th><th class="num">T. medio</th><th class="num">En plazo</th><th class="num">Abiertas</th></tr></thead><tbody>
        ${d.por_tipo.map((x) => `<tr><td>${esc(x.nombre)}</td><td class="num">${x.incidencias}</td><td class="num">${x.reportes}</td><td class="num">${x.tiempo_medio_h == null ? '—' : `${x.tiempo_medio_h} h`}</td><td class="num ${x.pct_en_plazo != null && x.pct_en_plazo < 90 ? 'vencida' : ''}">${x.pct_en_plazo ?? '—'}%</td><td class="num">${x.abiertas}${x.vencidas ? ` <span class="vencida">(${x.vencidas} venc.)</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="tarjeta"><h3>Reportes por canal</h3>
        <div class="barras">${d.por_canal.map((x) => `<div class="barra-fila" data-tip="${esc(CANALES[x.canal] || x.canal)}: ${x.reportes} reportes"><span class="n">${esc(CANALES[x.canal] || x.canal)}</span><span class="pista"><span class="relleno" data-w="${(100 * x.reportes / maxCanal).toFixed(1)}"></span></span><span class="v">${x.reportes}</span></div>`).join('') || '<p class="muted">Sin datos.</p>'}</div>
        <p class="muted peq mt-s">Los canales Teléfono, Oficina y WhatsApp los registra el personal de Atención al Cliente.</p></div>
      <div class="tarjeta"><h3>Encuesta de satisfacción</h3>
        <p class="muted peq">${d.satisfaccion.encuestas} encuesta(s) respondida(s)${d.satisfaccion.pct_respuesta != null ? ` · ${d.satisfaccion.pct_respuesta}% de los clientes con el servicio restablecido` : ''}. Responder es opcional.</p>
        <p class="peq sin-margen"><b>Atención en general</b></p>
        <div class="barras">${d.satisfaccion.distribucion.map((x) => `<div class="barra-fila" data-tip="${x.estrellas} estrella(s): ${x.encuestas} encuesta(s)"><span class="n">${'★'.repeat(x.estrellas)}</span><span class="pista"><span class="relleno" data-w="${(100 * x.encuestas / maxEstrellas).toFixed(1)}"></span></span><span class="v">${x.encuestas}</span></div>`).join('')}</div>
        <p class="mt-s">Rapidez de la atención: <b>${d.satisfaccion.rapidez_promedio ?? '—'}</b> / 5 ★</p></div>
      <div class="tarjeta"><h3>Satisfacción por cuadrilla</h3><p class="muted peq">Calidad del servicio de cada cuadrilla, propia o contratista, según los clientes que atendió. Cuadrillas con 3 o más encuestas.</p>
        <div class="tabla-env"><table><thead><tr><th>Cuadrilla</th><th class="num">Encuestas</th><th class="num">Atención</th><th class="num">Rapidez</th><th class="num">Satisfechos</th></tr></thead><tbody>
        ${d.satisfaccion.por_cuadrilla.filter((c) => c.encuestas >= 3).map((c) => `<tr><td><span class="mono">${esc(c.cuadrilla)}</span><br><span class="muted peq">${esc(c.responsable || '')}</span></td><td class="num">${c.encuestas}</td><td class="num">${c.promedio ?? '—'} ★</td><td class="num">${c.rapidez ?? '—'} ★</td><td class="num ${c.pct_satisfechos != null && c.pct_satisfechos < k.meta_satisfaccion ? 'vencida' : ''}">${c.pct_satisfechos ?? '—'}%</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin encuestas suficientes en el periodo.</td></tr>'}
        </tbody></table></div></div>
    </div>`;
  anchos(cont);
  graficoTendencia($('#g-tendencia'), d.tendencia, k.meta_en_plazo);
  activarTooltips(cont);
}

function graficoTendencia(cont, datos, metaV) {
  const pts = datos.filter((x) => x.pct_en_plazo != null);
  if (pts.length < 2) { cont.innerHTML = '<p class="muted">Se necesitan al menos dos semanas con datos.</p>'; return; }
  const W = 560, H = 220, m = { l: 36, r: 12, t: 12, b: 28 };
  const min = Math.max(0, Math.floor(Math.min(metaV, ...pts.map((p) => p.pct_en_plazo)) / 10) * 10 - 10);
  const x = (i) => m.l + (i * (W - m.l - m.r)) / (pts.length - 1);
  const y = (v) => m.t + ((100 - v) * (H - m.t - m.b)) / (100 - min);
  const ticks = []; for (let v = min; v <= 100; v += 10) ticks.push(v);
  const etiqueta = (s) => fecha(`${s}T12:00:00Z`, false).slice(0, 5);
  cont.innerHTML = `<svg class="grafico-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Porcentaje semanal de incidencias atendidas en plazo">
    ${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e6eaf0"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('')}
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(metaV)}" y2="${y(metaV)}" stroke="#4a5566" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="${W - m.r}" y="${y(metaV) - 5}" text-anchor="end">meta ${metaV}%</text>
    <polyline fill="none" stroke="#23609e" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => `${x(i)},${y(p.pct_en_plazo)}`).join(' ')}"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.pct_en_plazo)}" r="4.5" fill="#23609e" stroke="#fff" stroke-width="2"/><circle cx="${x(i)}" cy="${y(p.pct_en_plazo)}" r="14" fill="transparent" data-tip="Semana del ${etiqueta(p.semana)}: ${p.pct_en_plazo}% en plazo · ${p.incidencias} incidencias · tiempo medio ${p.tiempo_medio_h} h"/>`).join('')}
    ${pts.map((p, i) => (i % Math.ceil(pts.length / 7) === 0 || i === pts.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${etiqueta(p.semana)}</text>` : '')).join('')}
  </svg>`;
}

function activarTooltips(raiz) {
  const tip = $('#tooltip');
  for (const el of $$('[data-tip]', raiz)) {
    el.addEventListener('mousemove', (e) => { tip.textContent = el.dataset.tip; tip.classList.remove('oculto'); tip.style.left = `${e.clientX + 12}px`; tip.style.top = `${e.clientY + 12}px`; });
    el.addEventListener('mouseleave', () => tip.classList.add('oculto'));
  }
}

// ------------------------------------------------------------- avisos enviados
async function vNotificaciones() {
  P.innerHTML = '<div class="cabecera"><h1>Avisos enviados a clientes</h1></div><div class="tarjeta tabla-env" id="n-lista"><p class="muted">Cargando…</p></div>';
  try {
    const l = await llamar('/api/admin/notificaciones?limite=300');
    $('#n-lista').innerHTML = `<p class="muted peq">En el piloto los avisos quedan registrados aquí. En producción se envían por SMS (Mensajes Ensa) y correo (Office 365).</p>
      <table><thead><tr><th>Fecha</th><th>Reporte</th><th>Canal</th><th>Destino</th><th>Mensaje</th><th>Estado</th></tr></thead><tbody>
      ${l.map((n) => `<tr><td class="peq">${fecha(n.fecha)}</td><td class="mono">${esc(n.reporte)}</td><td>${esc(n.canal)}</td><td class="mono">${esc(n.destino)}</td><td class="peq">${esc(n.mensaje)}</td><td>${esc(n.estado)}</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { mostrarError($('#n-lista'), e); }
}

// ------------------------------------------------------------- catálogo
function vCatalogo() {
  const c = S.catalogo;
  P.innerHTML = `<div class="cabecera"><h1>Catálogo de incidencias</h1></div>
    <div class="tarjeta tabla-env"><p class="muted peq">Plazos y prioridades propuestos para el piloto. Deben validarse con Atención al Cliente y las áreas técnicas (actividad 5 del roadmap). El radio y la ventana controlan la agrupación automática de duplicados; deje el radio vacío para agrupar toda la zona.</p>
    <div id="c-error"></div>
    <table><thead><tr><th>Tipo</th><th>Prioridad</th><th>Plazo (h)</th><th>Área responsable</th><th>Radio (m)</th><th>Ventana (h)</th><th></th></tr></thead><tbody>
    ${c.tipos.map((t) => `<tr data-id="${t.id}"><td><b>${esc(t.nombre)}</b><br><span class="muted peq mono">${esc(t.codigo)}</span></td>
      <td><select name="prioridad">${['CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map((p) => `<option ${p === t.prioridad ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
      <td><input name="plazo_horas" type="number" min="1" max="720" value="${t.plazo_horas}"></td>
      <td><select name="area_id">${opcionesDe(c.areas, t.area_id)}</select></td>
      <td><input name="radio_agrupacion_m" type="number" min="10" max="20000" value="${t.radio_agrupacion_m ?? ''}" placeholder="zona"></td>
      <td><input name="ventana_agrupacion_h" type="number" min="1" max="720" value="${t.ventana_agrupacion_h}"></td>
      <td><button class="btn btn-sec" type="button" data-guardar>Guardar</button></td></tr>`).join('')}
    </tbody></table></div>`;
  for (const b of $$('[data-guardar]')) {
    b.addEventListener('click', async () => {
      const tr = b.closest('tr'); const datos = {};
      for (const el of $$('[name]', tr)) datos[el.name] = el.value === '' ? null : el.value;
      try {
        await llamar(`/api/admin/tipos/${tr.dataset.id}`, { metodo: 'PUT', datos });
        S.catalogo = await llamar('/api/catalogo');
        b.textContent = 'Guardado ✓'; setTimeout(() => { b.textContent = 'Guardar'; }, 1800); mostrarError($('#c-error'));
      } catch (e) { mostrarError($('#c-error'), e); }
    });
  }
}

// ------------------------------------------------------------- usuarios
async function vUsuarios() {
  const c = S.catalogo;
  P.innerHTML = `<div class="cabecera"><h1>Usuarios</h1></div>
    <div class="tarjeta tabla-env" id="u-lista"><p class="muted">Cargando…</p></div>
    <form class="tarjeta" id="u-form" novalidate><h2>Nuevo usuario</h2>
      <div class="fila"><div><label>Usuario</label><input name="usuario" type="text" maxlength="40" placeholder="nombre.apellido" required></div>
      <div><label>Nombre completo</label><input name="nombre" type="text" maxlength="120" required></div></div>
      <div class="fila"><div><label>Rol</label><select name="rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div><label>Área <span class="opc">(para supervisores)</span></label><select name="area_id">${opcionesDe(c.areas, '', 'Ninguna')}</select></div></div>
      <label>Contraseña inicial</label><input name="clave" type="password" autocomplete="new-password" required>
      <p class="ayuda">Mínimo 10 caracteres, con letras y números. En producción el acceso se hará con la cuenta de Office 365.</p>
      <div id="u-error"></div><button class="btn btn-primario mt-s" type="submit">Crear usuario</button></form>`;
  const cargar = async () => {
    const l = await llamar('/api/admin/usuarios');
    $('#u-lista').innerHTML = `<table><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Área</th><th>Estado</th><th></th></tr></thead><tbody>
      ${l.map((u) => `<tr><td class="mono">${esc(u.usuario)}</td><td>${esc(u.nombre)}</td><td>${esc(ROLES[u.rol])}</td><td>${esc(u.area || '—')}</td><td>${u.activo ? 'Activo' : '<span class="muted">Inactivo</span>'}</td>
        <td>${u.id === S.usuario.id ? '' : `<button class="btn btn-sec" type="button" data-u="${u.id}" data-activo="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('')}</tbody></table>`;
    for (const b of $$('[data-u]')) b.addEventListener('click', async () => { await llamar(`/api/admin/usuarios/${b.dataset.u}`, { metodo: 'PUT', datos: { activo: b.dataset.activo === '1' } }); cargar(); });
  };
  cargar().catch((e) => mostrarError($('#u-lista'), e));
  $('#u-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await llamar('/api/admin/usuarios', { metodo: 'POST', datos: Object.fromEntries(new FormData(e.target).entries()) }); e.target.reset(); mostrarError($('#u-error')); cargar(); } catch (err) { mostrarError($('#u-error'), err); }
  });
}

// ------------------------------------------------------------- auditoría
async function vAuditoria() {
  P.innerHTML = '<div class="cabecera"><h1>Auditoría</h1></div><div class="tarjeta tabla-env" id="a-lista"><p class="muted">Cargando…</p></div>';
  try {
    const l = await llamar('/api/admin/auditoria?limite=400');
    $('#a-lista').innerHTML = `<p class="muted peq">Registro de eventos del sistema (control de ISO/IEC 27001: registro y seguimiento). Se conservan en la base de datos y no se pueden editar desde la aplicación.</p>
      <table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead><tbody>
      ${l.map((a) => `<tr><td class="peq">${fecha(a.fecha)}</td><td>${esc(a.usuario || 'Cliente / sistema')}</td><td class="mono peq">${esc(a.accion)}</td><td class="peq">${esc(a.detalle || '')}</td><td class="mono peq">${esc(a.ip || '')}</td></tr>`).join('')}</tbody></table>`;
  } catch (e) { mostrarError($('#a-lista'), e); }
}

iniciar();
