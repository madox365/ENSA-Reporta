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
  $('#r-franja').innerHTML = (estado.catalogo.franjas || []).map((f) => `<option value="${f.codigo}">${esc(f.nombre)}</option>`).join('');
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
  if (c) {
    $('#dir-suministro').textContent = `${c.direccion}, ${c.zona}`;
    $('#ubic-suministro').innerHTML = c.tiene_ubicacion
      ? `${icono('gps')} Ubicación cargada desde tu suministro`
      : 'Tu suministro no tiene ubicación registrada; usaremos la dirección.';
  }
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
    const r = await api('/api/publico/ingresar', { metodo: 'POST', datos: { suministro: $('#i-suministro').value } });
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
  estado.codigoTipo = b.dataset.codigo;
  actualizarAlcance();
  // Alumbrado, postes y cables suelen estar en la calle, no en el domicilio
  if (estado.cliente && ['ALUMBRADO', 'POSTE', 'CABLE'].includes(b.dataset.codigo)) {
    $('input[name=donde][value=otro]').checked = true; actualizarDonde();
  } else if (estado.cliente) {
    $('input[name=donde][value=suministro]').checked = true; actualizarDonde();
  }
});

// ¿A quién afecta? Solo para cortes y luz baja. Si es solo su casa y la cuadrilla debe entrar, se pide el horario.
function actualizarAlcance() {
  const aplica = ['CORTE', 'TENSION'].includes(estado.codigoTipo);
  $('#alcance').classList.toggle('oculto', !aplica);
  const sola = aplica && $('input[name=alcance]:checked').value === 'SOLO_MI_CASA';
  $('#acceso').classList.toggle('oculto', !sola);
  const entrar = sola && $('#r-acceso').checked;
  $('#franja-campo').classList.toggle('oculto', !entrar);
  const msg = $('#presencia-msg');
  msg.classList.toggle('oculto', !estado.codigoTipo);
  msg.textContent = entrar
    ? 'La cuadrilla te llamará antes de llegar. Elige un horario en que haya alguien en casa.'
    : 'No necesitas estar presente: la red eléctrica está en la calle. Te avisaremos cuando la cuadrilla vaya en camino.';
}
for (const el of $$('input[name=alcance], #r-acceso')) el.addEventListener('change', actualizarAlcance);

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
  if (['CORTE', 'TENSION'].includes(estado.codigoTipo)) {
    datos.alcance = $('input[name=alcance]:checked').value;
    datos.requiere_acceso = datos.alcance === 'SOLO_MI_CASA' && $('#r-acceso').checked;
    if (datos.requiere_acceso) datos.franja_horaria = $('#r-franja').value;
  }
  const btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Enviando…'; mostrarError(err);
  try {
    const r = await api('/api/publico/reportes', { metodo: 'POST', datos, token: estado.token || undefined });
    // Si dejó el celular vacío, el aviso va al celular registrado en su suministro
    mostrarResultado(r, datos.telefono || (estado.cliente && estado.cliente.telefono_registrado));
    $('#f-reporte').reset(); estado.tipo = null; estado.foto = null; estado.ubicacion = null;
    $('#r-foto-previa').classList.add('oculto'); $('#gps-estado').textContent = '';
    for (const x of $$('#tipos [data-tipo]')) x.setAttribute('aria-pressed', 'false');
    $('#alerta-cable').classList.add('oculto');
    estado.codigoTipo = null; actualizarAlcance();
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
    ${r.requiere_acceso
      ? `<div class="aviso aviso-alerta">La cuadrilla necesitará entrar a tu predio. Te llamaremos antes de llegar. Horario indicado: <b>${esc(r.franja_horaria)}</b>.</div>`
      : '<p class="peq muted">No necesitas estar presente. Te enviaremos un SMS cuando la cuadrilla vaya en camino, con la hora estimada de llegada.</p>'}
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
    pintarSeguimiento(r);
  } catch (e) { det.classList.add('oculto'); mostrarError(err, e); }
}

// Seguimiento paso a paso, como en un envío por courier. La ubicación de la cuadrilla nunca se muestra.
function pintarSeguimiento(r, aviso = null) {
  const det = $('#detalle-consulta');
  const fechas = {};
  for (const x of r.linea_tiempo) fechas[x.estado] = x.fecha; // la última vez que pasó por cada estado
  const orden = ['REGISTRADA', 'ASIGNADA', 'EN_CAMINO', 'EN_LUGAR', 'REPARANDO', 'RESTABLECIDA'];
  const actual = r.estado === 'SOLUCIONADA' ? orden.length - 1 : orden.indexOf(r.estado);
  const cu = r.cuadrilla;
  const hhmm = (isoTxt) => fecha(isoTxt).slice(-5);
  const textos = {
    REGISTRADA: ['Recibimos tu reporte', r.reabierta && r.estado === 'REGISTRADA' ? 'Nos indicaste que la falla continúa: volvemos a atenderla con prioridad.' : `Registrado en la incidencia ${esc(r.incidencia)}.`],
    ASIGNADA: ['Cuadrilla asignada', cu ? `Cuadrilla ${esc(cu.codigo)} · ${esc(cu.responsable)}` : esc(r.area)],
    EN_CAMINO: ['En camino', cu && cu.hora_estimada_llegada ? `Llegada estimada: <b>${hhmm(cu.hora_estimada_llegada)}</b>` : ''],
    EN_LUGAR: ['La cuadrilla llegó', 'Está revisando la falla.'],
    REPARANDO: ['Reparando', 'La cuadrilla está trabajando en la falla.'],
    RESTABLECIDA: ['Servicio restablecido', r.causa ? `Causa: ${esc(r.causa.nombre)}` : ''],
  };
  const linea = r.estado === 'ANULADA'
    ? `<li class="actual"><b>Reporte cerrado</b><span class="muted peq">${fecha(fechas.ANULADA)}</span></li>`
    : orden.map((p, i) => `<li class="${i < actual ? 'hecho' : i === actual ? 'actual' : ''}"><b>${textos[p][0]}</b>
        ${i <= actual && textos[p][1] ? `<span class="peq">${textos[p][1]}</span>` : ''}
        <span class="muted peq">${i <= actual && fechas[p] ? fecha(fechas[p]) : i > actual ? 'Pendiente' : ''}</span></li>`).join('');
  const enCamino = r.estado === 'EN_CAMINO' && cu && cu.hora_estimada_llegada;
  det.innerHTML = `
    <h2>Reporte <span class="mono">${esc(r.numero_seguimiento)}</span></h2>
    <p>${chipEstado(r.estado)}</p>
    ${aviso ? `<div class="aviso aviso-info">${esc(aviso)}</div>` : ''}
    ${enCamino ? `<div class="aviso aviso-info">${icono('camion')} La cuadrilla <b>${esc(cu.codigo)}</b> va en camino. Llegada estimada: <span class="eta-grande">${hhmm(cu.hora_estimada_llegada)}</span></div>` : ''}
    ${r.causa && r.causa.responsabilidad === 'CLIENTE' ? '<div class="aviso aviso-alerta">La red de ENSA funciona bien: la falla está en la instalación interna del predio. Te recomendamos llamar a un electricista.</div>' : ''}
    ${r.puede_confirmar ? `<div class="tarjeta"><b>¿Volvió tu luz?</b><p class="peq muted sin-margen">Tu respuesta nos ayuda a cerrar bien la atención.</p>
      <div class="confirmar-luz"><button class="btn btn-primario" type="button" data-resp="SI">Sí, ya tengo luz</button><button class="btn btn-sec" type="button" data-resp="NO">No, sigue la falla</button></div></div>` : ''}
    ${r.confirmacion === 'SI' ? '<p class="peq">Gracias por confirmar que volvió el servicio.</p>' : ''}
    ${r.puede_encuestar && !encuestaOmitida.has(r.numero_seguimiento) ? formularioEncuesta() : ''}
    ${r.encuesta && !aviso ? '<p class="peq">Gracias por responder la encuesta.</p>' : ''}
    <dl class="dl">
      <dt>Falla</dt><dd>${esc(r.tipo)} · ${esc(r.zona)}</dd>
      <dt>Reportes</dt><dd>${r.reportes_de_la_falla} vecino(s) reportaron esta falla</dd>
      <dt>Reportado</dt><dd>${fecha(r.fecha_reporte)}</dd>
      ${cu ? `<dt>Atiende</dt><dd>Cuadrilla ${esc(cu.codigo)} · ${esc(cu.responsable)}</dd>` : ''}
      ${!['RESTABLECIDA', 'SOLUCIONADA', 'ANULADA'].includes(r.estado) ? `<dt>Atención hasta</dt><dd>${fecha(r.fecha_limite)}</dd>` : ''}
      <dt>¿Debes estar?</dt><dd>${r.requiere_presencia ? `Sí, la cuadrilla necesita entrar · ${esc(r.franja_horaria || '')}` : 'No, la falla se atiende desde la calle'}</dd>
      ${r.detalle_solucion ? `<dt>Solución</dt><dd>${esc(r.detalle_solucion)}</dd>` : ''}
    </dl>
    <ol class="linea">${linea}</ol>`;
  det.classList.remove('oculto');
  for (const b of $$('[data-resp]', det)) {
    b.addEventListener('click', async () => {
      // Un "No" reabre la falla y envía otra cuadrilla: se confirma para evitar toques por error
      if (b.dataset.resp === 'NO' && !window.confirm('¿Sigues sin luz? Enviaremos una cuadrilla a revisar de nuevo.')) return;
      try {
        const nuevo = await api('/api/publico/confirmar', { metodo: 'POST', token: estado.token || undefined,
          datos: { codigo: r.numero_seguimiento, ultimos: $('#c-ultimos').value, respuesta: b.dataset.resp } });
        // Si otros vecinos ya tienen luz, su falla se atiende aparte, solo en su predio
        pintarSeguimiento(nuevo, b.dataset.resp === 'NO' && nuevo.incidencia !== r.incidencia
          ? `Tus vecinos ya tienen luz, así que la falla parece estar solo en tu predio. Abrimos la incidencia ${nuevo.incidencia} para atenderte.` : null);
      } catch (e) { mostrarError($('#e-consulta'), e); }
    });
  }
  const fe = $('#f-encuesta', det);
  if (fe) {
    for (const g of $$('.estrellas', fe)) {
      g.addEventListener('change', () => {
        const v = Number(new FormData(fe).get(g.dataset.campo));
        $(`[data-texto="${g.dataset.campo}"]`, fe).textContent = TEXTO_ESTRELLAS[v] || '';
        mostrarError($('#e-encuesta', fe), null);
      });
    }
    $('[data-omitir]', fe).addEventListener('click', () => { omitirEncuesta(r.numero_seguimiento); fe.remove(); });
    fe.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const datos = Object.fromEntries(new FormData(fe).entries());
      if (!datos.general && !datos.rapidez) { mostrarError($('#e-encuesta', fe), new Error('Marca al menos una calificación, o pulsa "Ahora no" si no deseas responder.')); return; }
      const b = $('button[type=submit]', fe); b.disabled = true;
      try {
        const nuevo = await api('/api/publico/encuesta', { metodo: 'POST', token: estado.token || undefined,
          datos: { ...datos, codigo: r.numero_seguimiento, ultimos: $('#c-ultimos').value } });
        pintarSeguimiento(nuevo, '¡Gracias! Tu opinión nos ayuda a mejorar el servicio.');
      } catch (e) { b.disabled = false; mostrarError($('#e-encuesta', fe), e); }
    });
  }
  det.scrollIntoView({ behavior: 'smooth' });
}

// Encuesta opcional de satisfacción con estrellas (1 a 5)
const TEXTO_ESTRELLAS = { 1: 'Muy mala', 2: 'Mala', 3: 'Regular', 4: 'Buena', 5: 'Excelente' };
// "Ahora no" se recuerda en este dispositivo para no volver a ofrecerla al recargar
const CLAVE_OMITIDAS = 'ensa-encuestas-omitidas';
const encuestaOmitida = new Set((() => {
  try { return JSON.parse(localStorage.getItem(CLAVE_OMITIDAS)) || []; } catch { return []; }
})());
function omitirEncuesta(codigo) {
  encuestaOmitida.add(codigo);
  try { localStorage.setItem(CLAVE_OMITIDAS, JSON.stringify([...encuestaOmitida].slice(-50))); } catch { /* sin almacenamiento: vale solo en esta visita */ }
}
// Estrellas en orden 1 → 5 para que las flechas del teclado avancen en el mismo sentido que se ven
function filaEstrellas(campo, titulo) {
  const opciones = [1, 2, 3, 4, 5].map((n) => `<input type="radio" id="e-${campo}-${n}" name="${campo}" value="${n}"><label for="e-${campo}-${n}" title="${TEXTO_ESTRELLAS[n]}">★<span class="sr">${n} estrella(s): ${TEXTO_ESTRELLAS[n]}</span></label>`).join('');
  return `<div class="encuesta-fila"><span class="encuesta-titulo">${titulo}</span>
    <span class="estrellas" role="radiogroup" aria-label="${titulo}" data-campo="${campo}">${opciones}</span><span class="peq muted" data-texto="${campo}"></span></div>`;
}
// Totalmente opcional: el cliente puede ignorarla o cerrarla; si responde, califica lo que quiera
function formularioEncuesta() {
  return `<form class="tarjeta encuesta" id="f-encuesta" novalidate>
    <b>¿Cómo te atendimos? <span class="muted peq">(opcional)</span></b>
    <p class="peq muted sin-margen">Si quieres, califícanos con estrellas. No es obligatorio.</p>
    ${filaEstrellas('general', 'Atención en general')}
    ${filaEstrellas('rapidez', 'Rapidez de la atención')}
    <div id="e-encuesta"></div>
    <div class="confirmar-luz"><button class="btn btn-primario" type="submit">Enviar</button><button class="btn btn-sec" type="button" data-omitir>Ahora no</button></div>
  </form>`;
}

iniciar();
