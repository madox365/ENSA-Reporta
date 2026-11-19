// Vista del cliente: reportar, ingresar con suministro y consultar
'use strict';

const estado = {
  catalogo: null,
  config: null,
  tipo: null,
  ubicacion: null,
  foto: null,
  token: sessionStorage.getItem('ensa_cliente') || null,
  cliente: null,
};

// ------------------------------------------------------------- navegación
const VISTAS = ['inicio', 'ingresar', 'reportar', 'resultado', 'consultar'];
function ir(vista, { historial = true } = {}) {
  for (const v of VISTAS) $(`#v-${v}`).classList.toggle('oculto', v !== vista);
  if (historial) history.pushState({ vista }, '', vista === 'inicio' ? '/' : `#${vista}`);
  window.scrollTo(0, 0);
  if (vista === 'consultar') cargarMisReportes();
  if (vista === 'reportar') prepararFormulario();
}
window.addEventListener('popstate', (e) => ir((e.state && e.state.vista) || vistaDesdeHash(), { historial: false }));
const vistaDesdeHash = () => (VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inicio');
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir]');
  if (b) { e.preventDefault(); ir(b.dataset.ir); }
});
$('#lnk-inicio').addEventListener('click', (e) => { e.preventDefault(); ir('inicio'); });

function pintarIconos(raiz = document) {
  for (const el of $$('[data-icono]', raiz)) { el.outerHTML = icono(el.dataset.icono); }
}

// ------------------------------------------------------------- inicio
async function iniciar() {
  $('#logo').innerHTML = LOGO;
  pintarIconos();
  try {
    [estado.catalogo, estado.config] = await Promise.all([api('/api/publico/catalogo'), api('/api/publico/config')]);
  } catch (e) {
    mostrarError($('#chip-cliente-inicio'), e);
    return;
  }
  $('#aviso-emergencia').innerHTML = `${icono('telefono')}<div><b>¿Cable caído o chispas?</b> No te acerques. Llama de inmediato a la central de ENSA <b>${esc(estado.config.telefono_emergencias)}</b> y luego regístralo aquí.</div>`;
  $('#tipos-info').innerHTML = estado.catalogo.tipos.map((t) => `<div class="tipo ${t.prioridad === 'CRITICA' ? 'critico' : ''}">${icono(t.codigo, 'ico')}<b>${esc(t.nombre)}</b><span>${esc(t.descripcion)}</span></div>`).join('');
  $('#tipos').innerHTML = estado.catalogo.tipos.map((t) => `<button type="button" class="tipo ${t.prioridad === 'CRITICA' ? 'critico' : ''}" aria-pressed="false" data-tipo="${t.id}" data-codigo="${esc(t.codigo)}">${icono(t.codigo, 'ico')}<b>${esc(t.nombre)}</b><span>${esc(t.descripcion)}</span></button>`).join('');
  $('#r-unidad').innerHTML = estado.catalogo.unidades.map((u) => `<option value="${u.id}">${esc(u.nombre.replace('Unidad de Negocio ', ''))}</option>`).join('');
  llenarZonas();
  if (estado.token) {
    try { const c = await api('/api/publico/yo', { token: estado.token }); estado.cliente = c.suministro ? c : null; } catch { cerrarCliente(); }
  }
  pintarCliente();
  ir(vistaDesdeHash(), { historial: false });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function llenarZonas(zonaId) {
  const un = Number($('#r-unidad').value);
  $('#r-zona').innerHTML = '<option value="">Selecciona…</option>' + estado.catalogo.zonas
    .filter((z) => z.unidad_negocio_id === un).map((z) => `<option value="${z.id}">${esc(z.nombre)}</option>`).join('');
  if (zonaId) $('#r-zona').value = zonaId;
}
$('#r-unidad').addEventListener('change', () => llenarZonas());

// ------------------------------------------------------------- sesión del cliente
function pintarCliente() {
  const c = estado.cliente;
  $('#btn-ingresar').classList.toggle('oculto', !!c);
  $('#btn-salir').classList.toggle('oculto', !c);
  const chip = c ? `<div class="cliente-chip"><span>${icono('usuario')} <b>${esc(c.titular)}</b> · Suministro <span class="mono">${esc(c.suministro)}</span><br><span class="muted peq">${esc(c.direccion)} · ${esc(c.zona)}</span></span></div>` : '';
  $('#chip-cliente-inicio').innerHTML = chip ? `${chip}<br>` : '';
  $('#chip-cliente-reporte').innerHTML = chip;
  $('#mis-reportes-tarjeta').classList.toggle('oculto', !c);
  $('#c-ultimos-campo').querySelector('label').innerHTML = c ? 'Últimos 4 dígitos de tu celular <span class="opc">(no necesario para tus reportes)</span>' : 'Últimos 4 dígitos de tu celular';
  $('#donde-suministro').classList.toggle('oculto', !c);
  $('#datos-extra').classList.toggle('oculto', !!c);
  if (c) $('#dir-suministro').textContent = `${c.direccion}, ${c.zona}`;
  // Con suministro, nombre y celular son opcionales: se toman del padrón si se dejan vacíos
  $('#r-nombre').placeholder = c ? `${c.titular} (titular)` : '';
  $('#r-telefono').placeholder = c && c.telefono_registrado ? `Registrado: ${c.telefono_registrado}` : '9XXXXXXXX';
  actualizarDonde();
}
$('#btn-ingresar').addEventListener('click', () => ir('ingresar'));
$('#btn-salir').addEventListener('click', async () => {
  try { await api('/api/publico/salir', { metodo: 'POST', datos: {}, token: estado.token }); } catch { /* sin conexión */ }
  cerrarCliente(); ir('inicio');
});
function cerrarCliente() {
  estado.token = null; estado.cliente = null; sessionStorage.removeItem('ensa_cliente'); pintarCliente();
}

$('#f-ingresar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; mostrarError($('#e-ingresar'));
  try {
    const r = await api('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: $('#i-suministro').value, documento: $('#i-documento').value } });
    estado.token = r.token; estado.cliente = r.cliente; sessionStorage.setItem('ensa_cliente', r.token);
    $('#f-ingresar').reset();
    pintarCliente();
    ir('reportar');
  } catch (err) { mostrarError($('#e-ingresar'), err); } finally { btn.disabled = false; }
});

// ------------------------------------------------------------- formulario de reporte
function prepararFormulario() {
  mostrarError($('#e-reporte'));
  actualizarDonde();
}
function actualizarDonde() {
  const enDomicilio = !!estado.cliente && $('input[name=donde]:checked').value === 'suministro';
  $('#donde-otro').classList.toggle('oculto', enDomicilio);
}
for (const r of $$('input[name=donde]')) r.addEventListener('change', actualizarDonde);

$('#tipos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tipo]');
  if (!b) return;
  for (const x of $$('#tipos [data-tipo]')) x.setAttribute('aria-pressed', String(x === b));
  estado.tipo = Number(b.dataset.tipo);
  $('#alerta-cable').classList.toggle('oculto', b.dataset.codigo !== 'CABLE');
  // Alumbrado, postes y cables suelen estar en la calle, no en el domicilio
  if (estado.cliente && ['ALUMBRADO', 'POSTE', 'CABLE'].includes(b.dataset.codigo)) {
    $('input[name=donde][value=otro]').checked = true; actualizarDonde();
  } else if (estado.cliente) {
    $('input[name=donde][value=suministro]').checked = true; actualizarDonde();
  }
});

$('#btn-gps').addEventListener('click', async () => {
  const st = $('#gps-estado'); st.textContent = 'Obteniendo ubicación…';
  try {
    estado.ubicacion = await obtenerUbicacion();
    st.innerHTML = `${icono('ok')} Ubicación registrada (precisión ${Math.round(estado.ubicacion.precision)} m)`;
    // Sugiere la zona más cercana
    const cerca = estado.catalogo.zonas
      .map((z) => ({ z, d: Math.hypot((z.lat ?? 0) - estado.ubicacion.lat, (z.lng ?? 0) - estado.ubicacion.lng) }))
      .sort((a, b) => a.d - b.d)[0];
    if (cerca && cerca.d < 0.15 && !$('#r-zona').value) { $('#r-unidad').value = cerca.z.unidad_negocio_id; llenarZonas(cerca.z.id); }
  } catch (err) { st.textContent = err.message; estado.ubicacion = null; }
});

$('#r-foto').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  estado.foto = null; $('#r-foto-previa').classList.add('oculto');
  if (!f) return;
  try {
    estado.foto = await reducirFoto(f);
    $('#r-foto-previa').src = estado.foto; $('#r-foto-previa').classList.remove('oculto');
  } catch (err) { mostrarError($('#e-reporte'), err); e.target.value = ''; }
});

$('#f-reporte').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#e-reporte');
  if (!estado.tipo) { mostrarError(err, 'Elige qué tipo de falla quieres reportar.'); $('#tipos').scrollIntoView({ behavior: 'smooth' }); return; }
  const enDomicilio = !!estado.cliente && $('input[name=donde]:checked').value === 'suministro';
  const datos = {
    canal: window.matchMedia('(display-mode: standalone)').matches ? 'APP' : 'WEB',
    tipo_id: estado.tipo,
    usar_direccion_suministro: enDomicilio,
    zona_id: enDomicilio ? undefined : $('#r-zona').value,
    direccion: enDomicilio ? '' : $('#r-direccion').value,
    referencia: enDomicilio ? '' : $('#r-referencia').value,
    lat: !enDomicilio && estado.ubicacion ? estado.ubicacion.lat : null,
    lng: !enDomicilio && estado.ubicacion ? estado.ubicacion.lng : null,
    descripcion: $('#r-descripcion').value,
    foto: estado.foto,
    nombre: $('#r-nombre').value,
    telefono: $('#r-telefono').value,
    documento: estado.cliente ? undefined : $('#r-documento').value,
    suministro: estado.cliente ? undefined : $('#r-suministro').value,
    email: $('#r-email').value,
    consentimiento: $('#r-consentimiento').checked,
  };
  const btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Enviando…'; mostrarError(err);
  try {
    const r = await api('/api/publico/reportes', { metodo: 'POST', datos, token: estado.token || undefined });
    mostrarResultado(r, datos.telefono);
    $('#f-reporte').reset(); estado.tipo = null; estado.foto = null; estado.ubicacion = null;
    $('#r-foto-previa').classList.add('oculto'); $('#gps-estado').textContent = '';
    for (const x of $$('#tipos [data-tipo]')) x.setAttribute('aria-pressed', 'false');
    $('#alerta-cable').classList.add('oculto');
    pintarCliente();
    ir('resultado');
  } catch (ex) {
    if (ex.estado === 401) cerrarCliente();
    mostrarError(err, ex);
    err.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally { btn.disabled = false; btn.textContent = 'Enviar reporte'; }
});

function mostrarResultado(r, telefono) {
  $('#resultado').innerHTML = `
    <div class="aviso aviso-ok">${icono('ok')} <b>Tu reporte fue registrado.</b></div>
    <p class="muted sin-margen">Tu número de seguimiento es</p>
    <div class="codigo-grande">${esc(r.numero_seguimiento)}</div>
    <p>Guárdalo. Te lo enviamos también por SMS${telefono ? ` al celular terminado en ${esc(String(telefono).slice(-3))}` : ''}.</p>
    ${r.agrupado
      ? `<div class="aviso aviso-info"><b>Esta falla ya estaba reportada.</b> Tu aviso se sumó a la incidencia <b>${esc(r.incidencia)}</b>, que ya tiene ${r.cantidad_reportes} reporte(s) de vecinos. No necesitas volver a reportarla.</div>`
      : `<div class="aviso aviso-info">Se abrió la incidencia <b>${esc(r.incidencia)}</b> (${esc(r.tipo)}). El plazo de atención para este tipo de falla es de hasta <b>${r.plazo_horas} horas</b>.</div>`}
    <p>Estado actual: ${chipEstado(r.estado)}</p>
    <div class="acciones"><button class="btn btn-primario" type="button" id="btn-ver-estado">Ver estado</button><button class="btn btn-sec" type="button" data-ir="inicio">Volver al inicio</button></div>`;
  $('#btn-ver-estado').addEventListener('click', async () => {
    ir('consultar');
    $('#c-codigo').value = r.numero_seguimiento;
    $('#c-ultimos').value = String(telefono || '').slice(-4);
    consultar();
  });
}

// ------------------------------------------------------------- consulta
async function cargarMisReportes() {
  if (!estado.cliente) return;
  const cont = $('#mis-reportes');
  cont.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const lista = await api('/api/publico/mis-reportes', { token: estado.token });
    cont.innerHTML = lista.length
      ? `<p class="muted peq">Toca un reporte para ver su estado.</p><ul class="lista-reportes">${lista.map((r) => `
          <li data-codigo="${esc(r.codigo)}" tabindex="0" role="button"><span><b>${esc(r.tipo)}</b> · ${esc(r.zona)}<br><span class="mono peq">${esc(r.codigo)}</span> <span class="muted peq">${fecha(r.fecha)}</span></span>${chipEstado(r.estado)}</li>`).join('')}</ul>`
      : '<p class="muted">Aún no tienes reportes registrados con tu suministro.</p>';
    for (const li of $$('li[data-codigo]', cont)) {
      const abrirR = () => { $('#c-codigo').value = li.dataset.codigo; consultar(); };
      li.addEventListener('click', abrirR);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrirR(); });
    }
  } catch (e) { if (e.estado === 401) cerrarCliente(); mostrarError(cont, e); }
}

$('#f-consulta').addEventListener('submit', (e) => { e.preventDefault(); consultar(); });
async function consultar() {
  const err = $('#e-consulta'); mostrarError(err);
  const det = $('#detalle-consulta');
  try {
    const r = await api('/api/publico/consulta', { metodo: 'POST', datos: { codigo: $('#c-codigo').value, ultimos: $('#c-ultimos').value }, token: estado.token || undefined });
    const pasos = ['REGISTRADA', 'ASIGNADA', 'EN_ATENCION', 'SOLUCIONADA'];
    const fechas = Object.fromEntries(r.linea_tiempo.map((x) => [x.estado, x.fecha]));
    const idx = pasos.indexOf(r.estado);
    const textos = {
      REGISTRADA: 'Recibimos el reporte',
      ASIGNADA: `Asignada a ${esc(r.area)}`,
      EN_ATENCION: 'La cuadrilla está atendiendo la falla',
      SOLUCIONADA: 'Falla solucionada',
    };
    const linea = r.estado === 'ANULADA'
      ? `<li class="actual"><b>Reporte cerrado</b><span class="muted peq">${fecha(fechas.ANULADA)}</span></li>`
      : pasos.map((p, i) => `<li class="${i < idx ? 'hecho' : i === idx ? 'actual' : ''}"><b>${textos[p]}</b><span class="muted peq">${fechas[p] ? fecha(fechas[p]) : 'Pendiente'}</span></li>`).join('');
    det.innerHTML = `
      <h2>Reporte <span class="mono">${esc(r.numero_seguimiento)}</span></h2>
      <p>${chipEstado(r.estado)}</p>
      <dl class="dl">
        <dt>Falla</dt><dd>${esc(r.tipo)} · ${esc(r.zona)}</dd>
        <dt>Incidencia</dt><dd class="mono">${esc(r.incidencia)}</dd>
        <dt>Reportes</dt><dd>${r.reportes_de_la_falla} vecino(s) reportaron esta falla</dd>
        <dt>Reportado</dt><dd>${fecha(r.fecha_reporte)}</dd>
        ${r.estado !== 'SOLUCIONADA' && r.estado !== 'ANULADA' ? `<dt>Atención hasta</dt><dd>${fecha(r.fecha_limite)}</dd>` : ''}
        ${r.detalle_solucion ? `<dt>Solución</dt><dd>${esc(r.detalle_solucion)}</dd>` : ''}
      </dl>
      <ol class="linea">${linea}</ol>`;
    det.classList.remove('oculto');
    det.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { det.classList.add('oculto'); mostrarError(err, e); }
}

iniciar();
