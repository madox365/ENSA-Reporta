'use strict';
// Catálogo inicial (propuesto, a validar con Atención al Cliente y las áreas técnicas: actividad 5 del roadmap)
// y datos de demostración para la sustentación.
const db = require('./db');
const inc = require('./servicios/incidencias');
const { hashClave, iso, fijarReloj, ahora } = require('./util');

const UNIDADES = [
  [1, 'CHI', 'Unidad de Negocio Chiclayo'],
  [2, 'SUC', 'Unidad de Negocio Sucursales'],
  [3, 'CAJ', 'Unidad de Negocio Cajamarca Centro'],
];
const ZONAS = [
  [1, 'Chiclayo (Cercado)', -6.7714, -79.8409], [1, 'José Leonardo Ortiz', -6.7536, -79.8360], [1, 'La Victoria', -6.7900, -79.8370],
  [1, 'Pimentel', -6.8367, -79.9342], [1, 'Pomalca', -6.7667, -79.7800], [1, 'Monsefú', -6.8778, -79.8714],
  [1, 'Reque', -6.8650, -79.8180], [1, 'Santa Rosa', -6.8800, -79.9200], [1, 'Tumán', -6.7470, -79.7030],
  [1, 'Chongoyape', -6.6400, -79.3900],
  [2, 'Lambayeque', -6.7011, -79.9061], [2, 'Ferreñafe', -6.6389, -79.7889], [2, 'Mórrope', -6.5400, -80.0100],
  [2, 'Túcume', -6.5100, -79.8580], [2, 'Íllimo', -6.4730, -79.8540], [2, 'Jayanca', -6.3900, -79.8200],
  [2, 'Motupe', -6.1519, -79.7142], [2, 'Olmos', -5.9850, -79.7460],
  [3, 'Chota', -6.5617, -78.6489], [3, 'Cutervo', -6.3800, -78.8170], [3, 'Bambamarca', -6.6800, -78.5200],
  [3, 'Santa Cruz', -6.6260, -78.9440],
];
const AREAS = [
  [1, 'OPE', 'Operaciones de Distribución (emergencias)'],
  [2, 'MAN', 'Mantenimiento de Redes'],
  [3, 'ALP', 'Alumbrado Público'],
  [4, 'ATC', 'Atención al Cliente'],
];
// id, código, nombre, descripción, prioridad, plazo (h), área, radio de agrupación (m, null = zona), ventana (h)
const TIPOS = [
  [1, 'CORTE', 'Corte de luz', 'No hay energía en la vivienda, la calle o el sector.', 'ALTA', 6, 1, 800, 12],
  [2, 'CABLE', 'Cable caído o expuesto', 'Cable en el suelo, colgando o con chispas. Peligro: no te acerques.', 'CRITICA', 3, 1, 150, 24],
  [3, 'POSTE', 'Poste dañado o inclinado', 'Poste chocado, rajado, inclinado o con riesgo de caer.', 'ALTA', 24, 2, 100, 72],
  [4, 'ALUMBRADO', 'Alumbrado público', 'Lámpara de la calle apagada, encendida de día o intermitente.', 'MEDIA', 72, 3, 120, 168],
  [5, 'TENSION', 'Luz baja o parpadeo', 'La luz baja, sube o parpadea; los artefactos no funcionan bien.', 'MEDIA', 24, 1, 300, 24],
];
const CLAVE_DEMO = 'Ensa2027demo';
const USUARIOS_DEMO = [
  ['admin.tic', 'Administrador TIC (demo)', 'ADMIN', null],
  ['operador.atc', 'Rosa Chavarry · Atención al Cliente (demo)', 'OPERADOR', 4],
  ['supervisor.ope', 'Carlos Damián · Operaciones (demo)', 'SUPERVISOR', 1],
  ['supervisor.man', 'Luis Bances · Mantenimiento de Redes (demo)', 'SUPERVISOR', 2],
  ['supervisor.alp', 'Ana Llontop · Alumbrado Público (demo)', 'SUPERVISOR', 3],
  ['gerencia', 'Gerencia Regional (demo)', 'GERENCIA', null],
];

function sembrarCatalogo() {
  if (db.uno('SELECT COUNT(*) AS n FROM unidad_negocio').n) return;
  db.transaccion(() => {
    for (const [id, cod, nom] of UNIDADES) db.ejecutar('INSERT INTO unidad_negocio (id, codigo, nombre) VALUES (?,?,?)', id, cod, nom);
    for (const [un, nom, lat, lng] of ZONAS) db.ejecutar('INSERT INTO zona (unidad_negocio_id, nombre, lat, lng) VALUES (?,?,?,?)', un, nom, lat, lng);
    for (const [id, cod, nom] of AREAS) db.ejecutar('INSERT INTO area (id, codigo, nombre) VALUES (?,?,?)', id, cod, nom);
    for (const t of TIPOS) {
      db.ejecutar(`INSERT INTO tipo_incidencia (id, codigo, nombre, descripcion, prioridad, plazo_horas, area_id, radio_agrupacion_m, ventana_agrupacion_h)
                   VALUES (?,?,?,?,?,?,?,?,?)`, ...t);
    }
  });
}

// Generador pseudoaleatorio con semilla, para que la demo sea siempre igual
function prng(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NOMBRES = ['María', 'José', 'Juan', 'Rosa', 'Carmen', 'Luis', 'Ana', 'Jorge', 'Milagros', 'Pedro', 'Elena', 'Víctor', 'Lucía', 'César', 'Yolanda', 'Miguel', 'Fiorella', 'Segundo', 'Gladys', 'Wilmer'];
const APELLIDOS = ['Chapoñán', 'Llontop', 'Santisteban', 'Ramírez', 'Vásquez', 'Bances', 'Damián', 'Puicón', 'Chavarry', 'Sánchez', 'Ñiquén', 'Effio', 'Díaz', 'Cieza', 'Tantaleán', 'Mondragón', 'Gonzales', 'Fernández', 'Capuñay', 'Távara'];
const CALLES = ['Av. José Balta', 'Calle Elías Aguirre', 'Av. Luis Gonzales', 'Calle San José', 'Av. Bolognesi', 'Calle Torres Paz', 'Av. Sáenz Peña', 'Av. Grau', 'Calle Los Pinos', 'Av. Augusto B. Leguía', 'Calle Huáscar', 'Calle Tacna', 'Av. Chiclayo', 'Calle Manuel María Izaga', 'Av. Salaverry', 'Calle Vicente de la Vega', 'Calle Arica', 'Av. Mariscal Nieto', 'Calle Las Palmeras', 'Calle Los Laureles'];

// Suministros de ejemplo para la demostración (en producción: importación desde Optimus NGC)
const SUMINISTROS_DEMO = [
  ['10234567', 'María Chapoñán Llontop', '45678912', 'Calle Elías Aguirre 845', 'Chiclayo (Cercado)', -6.77185, -79.84012, 'SED-CHI-1101', '987654321'],
  ['10234568', 'José Santisteban Puicón', '41234567', 'Calle San José 1020', 'Chiclayo (Cercado)', -6.77420, -79.83790, 'SED-CHI-1101', '976543210'],
  ['10345678', 'Rosa Vásquez Effio', '40987654', 'Av. Augusto B. Leguía 330', 'Lambayeque', -6.70250, -79.90480, 'SED-SUC-2207', '965432109'],
  ['10456789', 'Bodega El Norteño S.A.C.', '20601234567', 'Av. Grau 512', 'José Leonardo Ortiz', -6.75410, -79.83550, 'SED-CHI-1340', '954321098'],
];

function sembrarPadron(rnd, elegir, zonas) {
  if (db.uno('SELECT COUNT(*) AS n FROM suministro').n) return;
  const ahoraIso = iso();
  const ins = (n, tit, doc, dir, zonaId, lat, lng, sed, tel) => db.ejecutar(
    'INSERT INTO suministro (numero, titular, documento, direccion, zona_id, lat, lng, sed, telefono, actualizado) VALUES (?,?,?,?,?,?,?,?,?,?)',
    n, tit, doc, dir, zonaId, lat, lng, sed, tel, ahoraIso);
  db.transaccion(() => {
    for (const [n, tit, doc, dir, zona, lat, lng, sed, tel] of SUMINISTROS_DEMO) {
      ins(n, tit, doc, dir, db.uno('SELECT id FROM zona WHERE nombre = ?', zona).id, lat, lng, sed, tel);
    }
    let correl = 11000000;
    for (const z of zonas) {
      const un = ['', 'CHI', 'SUC', 'CAJ'][z.unidad_negocio_id];
      const cantidad = z.unidad_negocio_id === 1 ? 40 : 20;
      for (let k = 0; k < cantidad; k++) {
        const sed = `SED-${un}-${String(z.id * 100 + Math.floor(k / 8)).padStart(4, '0')}`;
        ins(String(correl++), `${elegir(NOMBRES)} ${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`, String(10000000 + Math.floor(rnd() * 79999999)),
          `${elegir(CALLES)} ${100 + Math.floor(rnd() * 1500)}`, z.id, z.lat + (rnd() - 0.5) * 0.02, z.lng + (rnd() - 0.5) * 0.02, sed,
          `9${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`);
      }
    }
  });
}

function sembrarDemo() {
  if (!db.uno('SELECT COUNT(*) AS n FROM usuario').n) {
    for (const [usuario, nombre, rol, area] of USUARIOS_DEMO) {
      db.ejecutar('INSERT INTO usuario (usuario, nombre, rol, area_id, clave_hash, activo, creado_en) VALUES (?,?,?,?,?,1,?)',
        usuario, nombre, rol, area, hashClave(CLAVE_DEMO), iso());
    }
  }
  if (db.uno('SELECT COUNT(*) AS n FROM incidencia').n) return;
  const rnd = prng(2027);
  const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ponderado = (pares) => { let x = rnd() * pares.reduce((a, p) => a + p[1], 0); for (const [v, w] of pares) { if ((x -= w) <= 0) return v; } return pares[0][0]; };
  const zonas = db.todos('SELECT * FROM zona');
  sembrarPadron(rnd, elegir, zonas);
  const padronPorZona = new Map(zonas.map((z) => [z.id, db.todos('SELECT * FROM suministro WHERE zona_id = ? AND numero >= ?', z.id, '11000000')]));
  const usuarios = Object.fromEntries(db.todos('SELECT * FROM usuario').map((u) => [u.usuario, u]));
  const supervisorDe = { 1: usuarios['supervisor.ope'], 2: usuarios['supervisor.man'], 3: usuarios['supervisor.alp'] };
  const cuadrillas = { 1: ['Cuadrilla Emergencias 01', 'Cuadrilla Emergencias 02', 'Cuadrilla Emergencias 03'], 2: ['Cuadrilla Redes MT 01', 'Cuadrilla Redes BT 02'], 3: ['Cuadrilla AP Chiclayo', 'Cuadrilla AP Sucursales', 'Cuadrilla AP Cajamarca'] };
  const fin = ahora();
  const inicio = new Date(fin.getTime() - 45 * 864e5);
  const persona = () => ({
    nombre: `${elegir(NOMBRES)} ${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`,
    telefono: `9${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`,
    documento: rnd() < 0.6 ? String(10000000 + Math.floor(rnd() * 79999999)) : null,
    suministro: rnd() < 0.4 ? String(10000000 + Math.floor(rnd() * 9000000)) : null,
    email: rnd() < 0.25 ? `cliente${Math.floor(rnd() * 9999)}@correo.pe` : null,
  });
  const eventos = []; // acciones futuras (asignar, iniciar, solucionar) ordenadas por hora

  // 1) Reportes de clientes a lo largo de 45 días
  const planes = [];
  for (let t = inicio.getTime(); t < fin.getTime() - 2 * 3600e3;) {
    t += (0.6 + rnd() * 2.6) * 3600e3; // una falla nueva cada 0.6 a 3.2 horas
    const tipo = ponderado([[4, 44], [1, 24], [5, 12], [3, 11], [2, 9]]);
    const PESOS = { 'Chiclayo (Cercado)': 14, 'José Leonardo Ortiz': 10, 'La Victoria': 9, Lambayeque: 6, Ferreñafe: 4, Pimentel: 4, Chota: 3, Cutervo: 3 };
    const zona = ponderado(zonas.map((z) => [z, PESOS[z.nombre] || (z.unidad_negocio_id === 1 ? 2.5 : z.unidad_negocio_id === 2 ? 1.6 : 1.1)]));
    const n = ponderado([[1, 50], [2, 22], [3, 13], [4, 7], [6, 5], [9, 3]]);
    // Deja libre el Cercado de Chiclayo de cortes recientes: así la demostración del caso 1 abre una incidencia nueva
    const zonaFinal = [1, 5].includes(tipo) && zona.nombre === 'Chiclayo (Cercado)' && t > fin.getTime() - 30 * 3600e3
      ? zonas.find((z) => z.nombre === 'La Victoria') : zona;
    planes.push({ t, tipo, zona: zonaFinal, n });
  }
  for (const plan of planes) {
    const lat = plan.zona.lat + (rnd() - 0.5) * 0.02, lng = plan.zona.lng + (rnd() - 0.5) * 0.02;
    const calle = `${elegir(CALLES)} ${100 + Math.floor(rnd() * 1500)}`;
    let primero = null;
    for (let k = 0; k < plan.n; k++) {
      const tk = plan.t + k * (5 + rnd() * 40) * 60e3;
      if (tk > fin.getTime()) break;
      fijarReloj(new Date(tk));
      const conGps = rnd() < 0.7;
      const canal = ponderado([['WEB', 45], ['APP', 25], ['TELEFONO', 22], ['OFICINA', 5], ['WHATSAPP', 3]]);
      const interno = ['TELEFONO', 'OFICINA', 'WHATSAPP'].includes(canal);
      // ~4% de los duplicados llegan sin GPS y con otra referencia: el sistema no los agrupa y el personal los fusiona
      const escapa = k > 0 && rnd() < 0.04;
      const r = inc.registrarReporte({
        tipo_id: plan.tipo, zona_id: plan.zona.id,
        direccion: escapa ? `Frente a ${elegir(['la bodega', 'el colegio', 'el parque', 'la iglesia', 'el mercado'])} ${elegir(CALLES)}` : calle,
        referencia: rnd() < 0.5 ? elegir(['Cerca al parque', 'Frente al colegio', 'Al costado de la bodega', 'Esquina con el mercado', 'Media cuadra del grifo']) : null,
        lat: conGps && !escapa ? lat + (rnd() - 0.5) * 0.0006 : null, lng: conGps && !escapa ? lng + (rnd() - 0.5) * 0.0006 : null,
        descripcion: rnd() < 0.5 ? elegir(['Desde hace una hora', 'Ya es la segunda vez esta semana', 'Hay niños cerca, urgente', 'Toda la cuadra está sin luz', 'Se escuchó una explosión']) : null,
        consentimiento: true, ...persona(),
        ...(rnd() < 0.35 && [1, 5].includes(plan.tipo) ? { suministro: elegir(padronPorZona.get(plan.zona.id)).numero } : {}),
      }, { canal, usuarioId: interno ? usuarios['operador.atc'].id : null });
      const id = db.uno('SELECT id FROM incidencia WHERE codigo = ?', r.incidencia).id;
      if (k === 0) primero = id;
      else if (escapa && id !== primero) eventos.push({ t: tk + (5 + rnd() * 15) * 60e3, tipo: 'fusionar', id, destino: primero });
    }
    const tipo = db.uno('SELECT * FROM tipo_incidencia WHERE id = ?', plan.tipo);
    // Tiempos de atención: ~90% dentro del plazo
    const fraccion = rnd() < 0.9 ? 0.25 + rnd() * 0.7 : 1.05 + rnd() * 0.8;
    const total = tipo.plazo_horas * fraccion;
    const tAsig = plan.t + Math.min(total * 0.15, 1.5) * 3600e3 * (0.4 + rnd());
    const tIni = tAsig + total * 0.25 * 3600e3 * (0.5 + rnd());
    const tSol = plan.t + total * 3600e3;
    if (rnd() < 0.015) { eventos.push({ t: tAsig, tipo: 'anular', id: primero }); continue; }
    eventos.push({ t: tAsig, tipo: 'asignar', id: primero, area: tipo.area_id });
    eventos.push({ t: Math.max(tIni, tAsig + 60e3), tipo: 'iniciar', id: primero, area: tipo.area_id });
    eventos.push({ t: Math.max(tSol, tIni + 120e3), tipo: 'solucionar', id: primero, area: tipo.area_id });
  }

  // 2) Atención de las incidencias, en orden cronológico, hasta la hora actual
  eventos.sort((a, b) => a.t - b.t);
  for (const ev of eventos) {
    if (ev.t > fin.getTime()) continue;
    fijarReloj(new Date(ev.t));
    const i = db.uno('SELECT * FROM incidencia WHERE id = ?', ev.id);
    if (!i) continue;
    try {
      if (ev.tipo === 'fusionar') {
        const d = db.uno('SELECT codigo FROM incidencia WHERE id = ?', ev.destino);
        try { inc.fusionar(ev.id, d.codigo, usuarios['operador.atc']); } catch {
          // La incidencia original ya se cerró: el duplicado se anula indicando a cuál corresponde
          inc.cambiarEstado(ev.id, 'anular', { comentario: `Duplicado de ${d.codigo}, ya atendida` }, usuarios['operador.atc']);
        }
      } else if (ev.tipo === 'anular') {
        inc.cambiarEstado(ev.id, 'anular', { comentario: 'Reporte no corresponde: instalación interna del cliente' }, usuarios['operador.atc']);
      } else if (ev.tipo === 'asignar') {
        inc.cambiarEstado(ev.id, 'asignar', { area_id: ev.area, cuadrilla: elegir(cuadrillas[ev.area]) }, usuarios['operador.atc']);
      } else if (ev.tipo === 'iniciar') {
        inc.cambiarEstado(ev.id, 'iniciar', {}, supervisorDe[i.area_id]);
      } else if (ev.tipo === 'solucionar') {
        const det = {
          CORTE: 'Se repuso fusible de la subestación y se restableció el servicio.',
          CABLE: 'Se retiró el cable caído y se reconectó la acometida.',
          POSTE: 'Se aseguró el poste y se programó su cambio.',
          ALUMBRADO: 'Se cambió la lámpara y la fotocélula.',
          TENSION: 'Se ajustó el tap del transformador y se ajustaron conexiones.',
        }[db.uno('SELECT codigo FROM tipo_incidencia WHERE id = ?', i.tipo_id).codigo];
        inc.cambiarEstado(ev.id, 'solucionar', { detalle_solucion: det }, supervisorDe[i.area_id]);
      }
    } catch { /* la incidencia ya cambió de estado (fusionada o anulada) */ }
  }
  fijarReloj(null);
}

module.exports = { sembrarCatalogo, sembrarDemo, CLAVE_DEMO, TIPOS, SUMINISTROS_DEMO };
