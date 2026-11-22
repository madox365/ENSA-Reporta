// Utilidades compartidas por la vista del cliente y la del personal
'use strict';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Llamadas a la API. opciones.token → cabecera Bearer (cliente); opciones.csrf → cabecera CSRF (personal)
async function api(ruta, { metodo = 'GET', datos, token, csrf } = {}) {
  const cab = { Accept: 'application/json' };
  if (datos !== undefined) cab['Content-Type'] = 'application/json';
  if (token) cab.Authorization = `Bearer ${token}`;
  if (csrf) cab['X-CSRF-Token'] = csrf;
  let r;
  try {
    r = await fetch(ruta, { method: metodo, headers: cab, body: datos !== undefined ? JSON.stringify(datos) : undefined, credentials: 'same-origin' });
  } catch {
    throw Object.assign(new Error('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'), { estado: 0 });
  }
  const tipo = r.headers.get('Content-Type') || '';
  const cuerpo = tipo.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error((cuerpo && cuerpo.error) || `Error ${r.status}`), { estado: r.status });
  return cuerpo;
}

const ZONA_HORARIA = 'America/Lima';
function fecha(isoTxt, conHora = true) {
  if (!isoTxt) return '—';
  const o = { timeZone: ZONA_HORARIA, day: '2-digit', month: '2-digit', year: 'numeric' };
  if (conHora) Object.assign(o, { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Intl.DateTimeFormat('es-PE', o).format(new Date(isoTxt));
}
function duracion(horas) {
  if (horas == null || Number.isNaN(horas)) return '—';
  const min = Math.round(Math.abs(horas) * 60);
  const h = min / 60;
  if (min < 60) return `${min} min`;
  if (h < 48) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
  return `${Math.round(h / 24 * 10) / 10} días`;
}
const ESTADOS = { REGISTRADA: 'Registrada', ASIGNADA: 'Cuadrilla asignada', EN_CAMINO: 'En camino', EN_LUGAR: 'En el lugar', REPARANDO: 'Reparando', RESTABLECIDA: 'Restablecida', SOLUCIONADA: 'Solucionada', ANULADA: 'Anulada', VALIDADA: 'Validada', CANCELADA: 'Cancelada', RECHAZADA: 'Rechazada', DISPONIBLE: 'Disponible', EN_SERVICIO: 'En servicio', FUERA_DE_TURNO: 'Fuera de turno', INACTIVA: 'Inactiva' };
const ABIERTOS = ['REGISTRADA', 'ASIGNADA', 'EN_CAMINO', 'EN_LUGAR', 'REPARANDO'];
const CANALES = { WEB: 'Web', APP: 'App', TELEFONO: 'Teléfono', OFICINA: 'Oficina', WHATSAPP: 'WhatsApp' };
const chipEstado = (e) => `<span class="estado e-${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

// Iconos (SVG en línea, trazos propios)
const ICONOS = {
  rayo: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  CORTE: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/><path d="m4 4 16 16"/>',
  CABLE: '<path d="M4 4v6M20 4v6M4 10c3 0 4 3 6 6s4 4 6 2"/><path d="m15 13 2 2-2 2"/><path d="M12 6l1-2M17 6l-1-2"/>',
  POSTE: '<path d="M12 3v18M7 6h10M8 9h8M9 21h6"/><path d="m16 3 3 2"/>',
  ALUMBRADO: '<path d="M6 21V8a4 4 0 0 1 4-4h6"/><path d="M14 4h6l-1 3h-4z"/><path d="M15 10l-1 2M18 10l1 2"/><path d="M4 21h4"/>',
  TENSION: '<path d="M3 12h3l2-6 3 12 3-9 2 3h5"/>',
  reportar: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  ok: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  gps: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
  bandeja: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  tablero: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  campana: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 20a7 7 0 0 0-4-6.3"/>',
  escudo: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  salir: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  camion: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  mapa: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  herramienta: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  telefono: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
};
function icono(nombre, clase = 'i') {
  return `<svg class="${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ICONOS.rayo}</svg>`;
}
const LOGO = '<svg viewBox="0 0 662 740" aria-hidden="true"><path d="M0 368V133A133 133 0 0 1 133 0H331Z" fill="#43b02a"/><path d="M331 368 662 0V368Z" fill="#0072ce"/><path d="M0 372H331L0 740Z" fill="#0072ce"/><path d="M331 740 662 372V605A135 135 0 0 1 527 740Z" fill="#43b02a"/></svg>';

// Reduce la foto en el navegador antes de enviarla (máx. 1280 px, JPEG)
function reducirFoto(archivo, max = 1280, calidad = 0.75) {
  return new Promise((resolver, rechazar) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(archivo.type) && !/\.(jpe?g|png|webp)$/i.test(archivo.name)) {
      rechazar(new Error('Selecciona una imagen (JPG, PNG o WEBP).')); return;
    }
    const img = new Image();
    const url = URL.createObjectURL(archivo);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolver(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

function obtenerUbicacion() {
  return new Promise((resolver, rechazar) => {
    if (!navigator.geolocation) { rechazar(new Error('Tu dispositivo no permite obtener la ubicación.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
      () => rechazar(new Error('No se pudo obtener tu ubicación. Revisa que el GPS esté activo y que hayas dado permiso.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

function mostrarError(contenedor, err) {
  contenedor.innerHTML = err ? `<div class="aviso aviso-error" role="alert">${esc(err.message || err)}</div>` : '';
}
