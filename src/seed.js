'use strict';
// Catálogo inicial (propuesto, a validar con Atención al Cliente y las áreas técnicas: actividad 5 del roadmap)
// y datos de demostración para la sustentación.
const db = require('./db');
const inc = require('./servicios/incidencias');
const despacho = require('./servicios/despacho');
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
  ['despacho.cco', 'Jorge Puicón · Centro de Control de Operaciones (demo)', 'DESPACHADOR', 1],
  ['supervisor.ope', 'Carlos Damián · Operaciones (demo)', 'SUPERVISOR', 1],
  ['supervisor.man', 'Luis Bances · Mantenimiento de Redes (demo)', 'SUPERVISOR', 2],
  ['supervisor.alp', 'Ana Llontop · Alumbrado Público (demo)', 'SUPERVISOR', 3],
  ['gerencia', 'Gerencia Regional (demo)', 'GERENCIA', null],
];

// Causas de falla que registra el jefe de cuadrilla (responsabilidad: ENSA, cliente, terceros o naturaleza)
const CAUSAS = [
  [1, 'FUS', 'Fusible quemado en la subestación (SED)', 'ENSA'],
  [2, 'CON', 'Conductor roto, flojo o desconectado', 'ENSA'],
  [3, 'ACO', 'Falla en la acometida o conexión del medidor', 'ENSA'],
  [4, 'TRA', 'Sobrecarga o falla del transformador', 'ENSA'],
  [5, 'LAM', 'Lámpara o equipo de alumbrado dañado', 'ENSA'],
  [6, 'FOT', 'Fotocélula o contactor de alumbrado', 'ENSA'],
  [7, 'POD', 'Poste deteriorado', 'ENSA'],
  [8, 'CHO', 'Poste o red dañada por choque de vehículo', 'TERCEROS'],
  [9, 'ROB', 'Robo de conductor o equipos', 'TERCEROS'],
  [10, 'VEG', 'Contacto con árboles o vegetación', 'NATURALEZA'],
  [11, 'LLU', 'Lluvias o descargas atmosféricas', 'NATURALEZA'],
  [12, 'CLI', 'Falla en la instalación interna del cliente', 'CLIENTE'],
  [13, 'OTR', 'Otra causa', 'ENSA'],
];

// Empresas contratistas y cuadrillas de DEMOSTRACIÓN (nombres ficticios). Los servicios corresponden a los
// contratos que ENSA terceriza: atención de emergencias y mantenimiento de redes y alumbrado público.
const EMPRESAS_DEMO = [
  [1, 'Emergencias Eléctricas del Norte S.A.C. (demo)', 'Atención de emergencias: interrupciones masivas de baja tensión y denuncias por riesgos eléctricos', 'Demo · ref. CP-SM-12-2024-ELECTRONORTE', '2027-12-31'],
  [2, 'Mantenimiento y Alumbrado Lambayeque S.A.C. (demo)', 'Mantenimiento de redes de distribución y alumbrado público · UU.NN. Chiclayo y Cajamarca Centro', 'Demo', '2027-12-31'],
  [3, 'Servicios Técnicos Sucursales S.A.C. (demo)', 'Mantenimiento en MT, subestaciones, BT, alumbrado público y actividades técnico-comerciales 2024-2027 · UU.NN. Sucursales', 'Demo · ref. servicio 2024-2027 Sucursales', '2027-12-31'],
];
// código, nombre, tipo, empresa, área (1 OPE, 2 MAN, 3 ALP), unidad, zona base, jefe, placa
const CUADRILLAS_DEMO = [
  ['EM-CH01', 'Emergencias Chiclayo 1', 'CONTRATISTA', 1, 1, 1, 'Chiclayo (Cercado)', 'Wilmer Ñiquén', 'M1A-701'],
  ['EM-CH02', 'Emergencias Chiclayo 2', 'CONTRATISTA', 1, 1, 1, 'José Leonardo Ortiz', 'Segundo Capuñay', 'M1A-702'],
  ['LE-CH01', 'Líneas energizadas Chiclayo', 'PROPIA', null, 1, 1, 'La Victoria', 'Víctor Mondragón', 'EGX-310'],
  ['AP-CH01', 'Alumbrado Público Chiclayo 1', 'CONTRATISTA', 2, 3, 1, 'Chiclayo (Cercado)', 'César Effio', 'T3K-118'],
  ['AP-CH02', 'Alumbrado Público Chiclayo 2', 'CONTRATISTA', 2, 3, 1, 'Pimentel', 'Miguel Távara', 'T3K-119'],
  ['MR-CH01', 'Mantenimiento de Redes Chiclayo', 'CONTRATISTA', 2, 2, 1, 'José Leonardo Ortiz', 'Pedro Cieza', 'T3K-120'],
  ['EM-SU01', 'Emergencias Lambayeque', 'CONTRATISTA', 1, 1, 2, 'Lambayeque', 'Juan Sánchez', 'M1A-705'],
  ['EM-SU02', 'Emergencias Motupe-Olmos', 'CONTRATISTA', 3, 1, 2, 'Motupe', 'Luis Díaz', 'A4B-221'],
  ['AP-SU01', 'Alumbrado Público Sucursales', 'CONTRATISTA', 3, 3, 2, 'Ferreñafe', 'Jorge Santisteban', 'A4B-222'],
  ['MR-SU01', 'Mantenimiento de Redes Sucursales', 'CONTRATISTA', 3, 2, 2, 'Lambayeque', 'Elena Gonzales', 'A4B-223'],
  ['EM-CA01', 'Emergencias Chota', 'PROPIA', null, 1, 3, 'Chota', 'Wilmer Tantaleán', 'EGX-401'],
  ['EM-CA02', 'Emergencias Cutervo', 'PROPIA', null, 1, 3, 'Cutervo', 'José Fernández', 'EGX-402'],
  ['AP-CA01', 'Alumbrado Público Cajamarca Centro', 'CONTRATISTA', 2, 3, 3, 'Chota', 'Yolanda Vásquez', 'T3K-130'],
  ['MR-CA01', 'Mantenimiento de Redes Cajamarca Centro', 'PROPIA', null, 2, 3, 'Bambamarca', 'Víctor Ramírez', 'EGX-403'],
];
const usuarioJefe = (codigo) => `jefe.${codigo.toLowerCase().replace('-', '')}`;
const FOTO_DEMO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAB4AKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDtKKKK0ICiiigAooooAKKKQkAZJwBQAtFU5L0DIjXPuahN3MTkMB7AV5tTNcPB2Tv6HTHCVJeRpUVmi7mB+/n2wKlS+P8Ay0T8VpU82w83Z3Xr/wAC45YOovMu0UisHUMpyD3pa9JNNXRzNWCiiimIKKKKACiiigAooooAKKKKACiiigAqpflgigZ2k81bpGUOpVhkHtWGJoutSlTTtc0pTUJqTMeip7uAW0TTM48teuRz1xVNbmBlyJUx7nFfJ1MJWpu0os9eNaEtmS0VGbiAAnzU49GFWLOMXiGSJxsB2k4Oc0qeFrVHaMWOVWEd2T2Bbey87cZ/Gr1MjjWNAqDj+dPr6rB0JUKKhJ3Z5Faoqk3JBRRRXUZBRRRQAUUUUAFFFFAEFzeWtpt+1XMMG/O3zJAucdcZqD+2NL/6CVn/AN/1/wAaNR0mx1Ty/t0Hm+VnZ87LjOM9CPQVS/4RPQv+fH/yK/8A8VS1GXf7Y0v/AKCVn/3/AF/xo/tjS/8AoJWf/f8AX/GqX/CJ6F/z4/8AkV//AIqj/hE9C/58f/Ir/wDxVGoaF3+2NL/6CVn/AN/1/wAaP7Y0v/oJWf8A3/X/ABql/wAInoX/AD4/+RX/APiqP+ET0L/nx/8AIr//ABVGoaC6vqumyaZMkeoWjMduAsykn5h71zX2u1/5+Yf++xW1qnhnRrfT5ZYrPa64wfNc9x71z/8AZVl/zw/8fb/GpY0Tfa7X/n5h/wC+xW/oOp6fFZOst/aoxkJw0yg9B71zX9lWX/PD/wAfb/GtrRfDmkXVo8k9puYSEA+Y44wPQ0IGbv8AbGl/9BKz/wC/6/40f2xpf/QSs/8Av+v+NUv+ET0L/nx/8iv/APFUf8InoX/Pj/5Ff/4qq1FoXf7Y0v8A6CVn/wB/1/xo/tjS/wDoJWf/AH/X/GqX/CJ6F/z4/wDkV/8A4qj/AIRPQv8Anx/8iv8A/FUahoXf7Y0v/oJWf/f9f8alt7+yupDHbXdvM4GSscgYgeuAazf+ET0L/nx/8iv/APFVa0/Q9N02dp7K28qRl2E72bjIPc+wo1A0aKKKYgooooAKKKKACiiigAooooAo61/yCpv+A/8AoQrlK6vWv+QVN/wH/wBCFcpUyKQV0fh3/jwf/rqf5Cucro/Dv/Hg/wD11P8AIUo7gzWoooqyQooooAKKKKACiiigAooooAKKKKACiiigAooooAo61/yCpv8AgP8A6EK5Sur1r/kFTf8AAf8A0IVylTIpBXR+Hf8Ajwf/AK6n+QrnK6Pw7/x4P/11P8hSjuDNaiiirJCiiigAooooAKKKKACiiigAooooAKKKKACiiigCjrX/ACCpv+A/+hCuUrq9a/5BU3/Af/QhXKVMikFdH4d/48H/AOup/kK5yuj8O/8AHg//AF1P8hSjuDNaiiirJCiiigAooooAKKKKACiiigAooooAKKKKACiiigCjrX/IKm/4D/6EK5Sus1dHk0yZI1ZmO3AUZJ+YVzX2K7/59Z/+/ZqZFIgro/Dv/Hg//XU/yFYf2K7/AOfWf/v2a39BikisnWWNkYyE4YYPQUluDNOiiirJCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';

function sembrarCatalogo() {
  if (!db.uno('SELECT COUNT(*) AS n FROM causa').n) {
    for (const c of CAUSAS) db.ejecutar('INSERT INTO causa (id, codigo, nombre, responsabilidad) VALUES (?,?,?,?)', ...c);
  }
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
  // Generador aparte para las encuestas: así no altera el resto de la simulación
  const rndE = prng(4045);
  const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ponderado = (pares) => { let x = rnd() * pares.reduce((a, p) => a + p[1], 0); for (const [v, w] of pares) { if ((x -= w) <= 0) return v; } return pares[0][0]; };
  const zonas = db.todos('SELECT * FROM zona');
  sembrarPadron(rnd, elegir, zonas);
  const padronPorZona = new Map(zonas.map((z) => [z.id, db.todos('SELECT * FROM suministro WHERE zona_id = ? AND numero >= ?', z.id, '11000000')]));
  const usuarios = Object.fromEntries(db.todos('SELECT * FROM usuario').map((u) => [u.usuario, u]));
  const supervisorDe = { 1: usuarios['supervisor.ope'], 2: usuarios['supervisor.man'], 3: usuarios['supervisor.alp'] };
  const despachador = usuarios['despacho.cco'];

  // Contratistas, cuadrillas y sus jefes
  for (const e of EMPRESAS_DEMO) db.ejecutar('INSERT INTO empresa_contratista (id, nombre, servicio, contrato, vigencia_hasta) VALUES (?,?,?,?,?)', ...e);
  for (const [codigo, nombre, tipoC, empresa, area, un, zonaBase, jefe, placa] of CUADRILLAS_DEMO) {
    const u = db.ejecutar('INSERT INTO usuario (usuario, nombre, rol, area_id, clave_hash, activo, creado_en) VALUES (?,?,?,?,?,1,?)',
      usuarioJefe(codigo), `${jefe} · Jefe de cuadrilla ${codigo} (demo)`, 'JEFE_CUADRILLA', area, hashClave(CLAVE_DEMO), iso());
    const z = zonas.find((x) => x.nombre === zonaBase);
    db.ejecutar(`INSERT INTO cuadrilla (codigo, nombre, tipo, empresa_id, area_id, unidad_negocio_id, zona_base_id, jefe_usuario_id, integrantes, vehiculo, en_turno, lat, lng, fecha_ubicacion)
                 VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, codigo, nombre, tipoC, empresa, area, un, z.id, Number(u.lastInsertRowid),
    tipoC === 'PROPIA' ? 4 : 3, placa, z.lat + (rnd() - 0.5) * 0.01, z.lng + (rnd() - 0.5) * 0.01, iso());
  }
  const cuadrillas = db.todos('SELECT * FROM cuadrilla');
  const jefeDe = Object.fromEntries(cuadrillas.map((c) => [c.id, db.uno('SELECT * FROM usuario WHERE id = ?', c.jefe_usuario_id)]));

  const fin = ahora();
  const inicio = new Date(fin.getTime() - 45 * 864e5);
  const persona = () => ({
    nombre: `${elegir(NOMBRES)} ${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`,
    telefono: `9${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`,
    documento: rnd() < 0.6 ? String(10000000 + Math.floor(rnd() * 79999999)) : null,
    suministro: rnd() < 0.4 ? String(10000000 + Math.floor(rnd() * 9000000)) : null,
    email: rnd() < 0.25 ? `cliente${Math.floor(rnd() * 9999)}@correo.pe` : null,
  });

  // Cola de eventos simulados en orden cronológico
  const cola = [];
  const agendar = (ev) => {
    let lo = 0, hi = cola.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cola[m].t <= ev.t) lo = m + 1; else hi = m; }
    cola.splice(lo, 0, ev);
  };
  const min = (a, b) => (a + rnd() * (b - a)) * 60e3;
  const DURACION = { CORTE: [30, 150], CABLE: [30, 90], TENSION: [30, 120], POSTE: [60, 240], ALUMBRADO: [20, 60] };
  const CAUSAS_TIPO = { CORTE: [1, 1, 2, 3, 4, 10, 11, 12], CABLE: [2, 9, 10, 8], TENSION: [4, 3, 2], POSTE: [7, 8, 8], ALUMBRADO: [5, 5, 6, 9] };
  const TRABAJO = {
    FUS: 'Se cambió el fusible de la SED y se repuso el servicio.', CON: 'Se reparó y empalmó el conductor.', ACO: 'Se ajustó la conexión de la acometida al medidor.',
    TRA: 'Se reguló el tap y se balancearon cargas del transformador.', LAM: 'Se cambió la lámpara LED.', FOT: 'Se cambió la fotocélula.',
    POD: 'Se aseguró el poste y se programó su reemplazo.', CHO: 'Se retiró el poste dañado y se instaló uno provisional.', ROB: 'Se repuso el conductor robado.',
    VEG: 'Se podó la vegetación y se repuso la línea.', LLU: 'Se reemplazó el pararrayos y se repuso la línea.', CLI: 'La red de ENSA está operativa; la falla es interna del predio.', OTR: 'Se reparó la falla.',
  };

  // 1) Reportes de clientes a lo largo de 45 días
  for (let t = inicio.getTime(); t < fin.getTime() - 0.4 * 3600e3;) {
    t += (0.6 + rnd() * 2.6) * 3600e3; // una falla nueva cada 0.6 a 3.2 horas
    const tipo = ponderado([[4, 44], [1, 24], [5, 12], [3, 11], [2, 9]]);
    const PESOS = { 'Chiclayo (Cercado)': 14, 'José Leonardo Ortiz': 10, 'La Victoria': 9, Lambayeque: 6, Ferreñafe: 4, Pimentel: 4, Chota: 3, Cutervo: 3 };
    const zonaP = ponderado(zonas.map((z) => [z, PESOS[z.nombre] || (z.unidad_negocio_id === 1 ? 2.5 : z.unidad_negocio_id === 2 ? 1.6 : 1.1)]));
    const n = ponderado([[1, 50], [2, 22], [3, 13], [4, 7], [6, 5], [9, 3]]);
    // Deja libre el Cercado de Chiclayo de cortes recientes: así la demostración del caso 1 abre una incidencia nueva
    const zona = [1, 5].includes(tipo) && zonaP.nombre === 'Chiclayo (Cercado)' && t > fin.getTime() - 30 * 3600e3
      ? zonas.find((z) => z.nombre === 'La Victoria') : zonaP;
    agendar({ t, tipo: 'falla', datos: { tipo, zona, n } });
  }

  // 2) Simulación: reportes, despacho, avance en campo, validación y confirmación de clientes
  const tipoDe = Object.fromEntries(db.todos('SELECT * FROM tipo_incidencia').map((x) => [x.id, x]));
  const quienDespacha = (i) => (i.area_id === 1 ? despachador : supervisorDe[i.area_id]);
  // En las últimas horas la simulación no usa EM-CH01: queda libre para la prueba del cliente en el Cercado de Chiclayo
  const reservada = db.uno("SELECT id FROM cuadrilla WHERE codigo = 'EM-CH01'");
  const elegirCuadrilla = (i) => {
    const libreParaDemo = (c) => !(reservada && c.id === reservada.id && Date.parse(iso()) > fin.getTime() - 14 * 3600e3);
    const cand = despacho.candidatos(i.id).filter((c) => c.estado !== 'FUERA_DE_TURNO' && libreParaDemo(c));
    return cand.length ? cand[0] : null;
  };
  const seguir = (ev, paso, demora, extra = {}) => agendar({ ...ev, ...extra, paso, t: ev.t + demora });

  while (cola.length) {
    const ev = cola.shift();
    if (ev.t > fin.getTime()) continue;
    fijarReloj(new Date(ev.t));
    try {
      if (ev.tipo === 'falla') {
        const { tipo, zona, n } = ev.datos;
        const lat = zona.lat + (rnd() - 0.5) * 0.02, lng = zona.lng + (rnd() - 0.5) * 0.02;
        const calle = `${elegir(CALLES)} ${100 + Math.floor(rnd() * 1500)}`;
        let primero = null;
        for (let k = 0; k < n; k++) {
          const tk = ev.t + k * (5 + rnd() * 40) * 60e3;
          if (tk > fin.getTime()) break;
          fijarReloj(new Date(tk));
          const conGps = rnd() < 0.7;
          const canal = ponderado([['WEB', 45], ['APP', 25], ['TELEFONO', 22], ['OFICINA', 5], ['WHATSAPP', 3]]);
          const interno = ['TELEFONO', 'OFICINA', 'WHATSAPP'].includes(canal);
          const escapa = k > 0 && rnd() < 0.04;
          const individual = n === 1 && [1, 5].includes(tipo) && rnd() < 0.3;
          const acceso = individual && rnd() < 0.4;
          const r = inc.registrarReporte({
            tipo_id: tipo, zona_id: zona.id,
            direccion: escapa ? `Frente a ${elegir(['la bodega', 'el colegio', 'el parque', 'la iglesia', 'el mercado'])} ${elegir(CALLES)}` : calle,
            referencia: rnd() < 0.5 ? elegir(['Cerca al parque', 'Frente al colegio', 'Al costado de la bodega', 'Esquina con el mercado', 'Media cuadra del grifo']) : null,
            lat: conGps && !escapa ? lat + (rnd() - 0.5) * 0.0006 : null, lng: conGps && !escapa ? lng + (rnd() - 0.5) * 0.0006 : null,
            descripcion: rnd() < 0.5 ? elegir(['Desde hace una hora', 'Ya es la segunda vez esta semana', 'Hay niños cerca, urgente', 'Toda la cuadra está sin luz', 'Se escuchó una explosión']) : null,
            consentimiento: true, ...persona(),
            ...(rnd() < 0.35 && [1, 5].includes(tipo) ? { suministro: elegir(padronPorZona.get(zona.id)).numero } : {}),
            ...([1, 5].includes(tipo) ? { alcance: individual ? 'SOLO_MI_CASA' : elegir(['VARIAS_CASAS', 'VARIAS_CASAS', 'NO_SE']), requiere_acceso: acceso, franja_horaria: acceso ? elegir(['AHORA', 'HOY_TARDE', 'MANANA_MANANA']) : null } : {}),
          }, { canal, usuarioId: interno ? usuarios['operador.atc'].id : null });
          const id = db.uno('SELECT id FROM incidencia WHERE codigo = ?', r.incidencia).id;
          if (k === 0) primero = id;
          else if (escapa && id !== primero) agendar({ t: tk + min(5, 20), tipo: 'fusionar', id, destino: primero });
        }
        const t = tipoDe[tipo];
        if (rnd() < 0.015) { agendar({ t: ev.t + min(10, 40), tipo: 'anular', id: primero }); continue; }
        // Emergencias se despachan en minutos; alumbrado y postes se programan en horas
        const espera = t.area_id === 1 ? min(5, 35) : min(30, 8 * 60);
        // ~10% se atrasa (cuadrillas ocupadas, falta de material o de acceso): sale del plazo
        const atraso = rnd() < 0.1 ? t.plazo_horas * 3600e3 * (0.9 + rnd() * 0.6) : 0;
        agendar({ t: ev.t + espera, tipo: 'paso', paso: 'asignar', id: primero, codigoTipo: t.codigo, atraso });
      } else if (ev.tipo === 'fusionar') {
        const d = db.uno('SELECT codigo FROM incidencia WHERE id = ?', ev.destino);
        try { inc.fusionar(ev.id, d.codigo, usuarios['operador.atc']); } catch {
          try { inc.anular(ev.id, `Duplicado de ${d.codigo}, ya atendida`, usuarios['operador.atc']); } catch { /* ya cerrada */ }
        }
      } else if (ev.tipo === 'anular') {
        inc.anular(ev.id, 'Reporte no corresponde: instalación interna del cliente', usuarios['operador.atc']);
      } else if (ev.tipo === 'confirmar') {
        const rep = db.uno('SELECT * FROM reporte WHERE id = ?', ev.reporteId);
        inc.confirmar(rep.codigo, String(rep.telefono).slice(-4), null, ev.respuesta);
        // Cerca de la mitad de los que confirman responde la encuesta opcional de satisfacción
        if (ev.respuesta === 'SI' && rndE() < 0.48) agendar({ t: ev.t + (1 + rndE() * 19) * 60e3, tipo: 'encuesta', reporteId: rep.id });
        // Tras un "No" se despacha la incidencia reabierta o, si otros vecinos ya tenían luz, la nueva de su predio
        const ahoraEn = db.uno('SELECT incidencia_id FROM reporte WHERE id = ?', rep.id).incidencia_id;
        if (ev.respuesta === 'NO') agendar({ t: ev.t + min(15, 45), tipo: 'paso', paso: 'asignar', id: ahoraEn, codigoTipo: ev.codigoTipo, atraso: 0, reintento: true });
      } else if (ev.tipo === 'encuesta') {
        const rep = db.uno('SELECT * FROM reporte WHERE id = ?', ev.reporteId);
        const i = db.uno(`SELECT i.*, ot.cuadrilla_id FROM incidencia i LEFT JOIN orden_trabajo ot ON ot.id = i.orden_actual_id WHERE i.id = ?`, rep.incidencia_id);
        // La nota depende de si se atendió en plazo, de cuánto demoró y de la cuadrilla que atendió
        const enPlazo = i.fecha_solucion && i.fecha_solucion <= i.fecha_limite;
        const horas = (Date.parse(i.fecha_solucion) - Date.parse(i.fecha_registro)) / 3600e3;
        const estiloCuadrilla = [0.3, 0, -0.4, 0.2, -0.2, 0.4, -0.6, 0.1][(i.cuadrilla_id || 0) % 8];
        const base = (enPlazo ? 4.3 : 2.6) - Math.min(1, horas / 24) * 0.5 + estiloCuadrilla;
        const nota = (x) => Math.max(1, Math.min(5, Math.round(x + (rndE() - 0.5) * 1.6)));
        // La encuesta es opcional: cada cliente califica lo que quiere (al menos una de las dos)
        const conGeneral = rndE() < 0.92;
        inc.responderEncuesta(rep.codigo, String(rep.telefono).slice(-4), null, {
          general: conGeneral ? nota(base) : null,
          rapidez: !conGeneral || rndE() < 0.8 ? nota(base - 0.2) : null,
        });
      } else if (ev.tipo === 'paso') {
        const i = db.uno('SELECT * FROM incidencia WHERE id = ?', ev.id);
        if (!i || ['ANULADA'].includes(i.estado)) continue;
        if (ev.paso === 'asignar') {
          if (i.estado !== 'REGISTRADA') continue;
          const c = elegirCuadrilla(i);
          if (!c) { seguir(ev, 'asignar', min(20, 40)); continue; }
          const ot = despacho.asignar(i.id, { cuadrilla_id: c.id }, quienDespacha(i));
          seguir(ev, 'en_camino', min(2, 10) + ev.atraso, { ot: ot.id, cuadrilla: c.id });
        } else if (ev.paso === 'en_camino') {
          // Si la cuadrilla aún atiende otra orden, sale cuando termine
          const ocupada = db.uno("SELECT 1 FROM orden_trabajo WHERE cuadrilla_id = ? AND id <> ? AND estado IN ('EN_CAMINO','EN_LUGAR','REPARANDO')", ev.cuadrilla, ev.ot);
          if (ocupada) { seguir(ev, 'en_camino', min(15, 30)); continue; }
          const ot = despacho.avanzar(ev.ot, 'en_camino', {}, jefeDe[ev.cuadrilla]);
          const viaje = Math.max(5 * 60e3, Date.parse(ot.eta) - ev.t) * (0.8 + rnd() * 0.5);
          seguir(ev, 'en_lugar', viaje);
        } else if (ev.paso === 'en_lugar') {
          despacho.avanzar(ev.ot, 'en_lugar', {}, jefeDe[ev.cuadrilla]);
          seguir(ev, 'reparando', min(3, 15));
        } else if (ev.paso === 'reparando') {
          despacho.avanzar(ev.ot, 'reparando', {}, jefeDe[ev.cuadrilla]);
          const [a, b] = DURACION[ev.codigoTipo];
          seguir(ev, 'restablecer', min(a, b));
        } else if (ev.paso === 'restablecer') {
          const causaId = elegir(CAUSAS_TIPO[ev.codigoTipo]);
          const causa = CAUSAS.find((x) => x[0] === causaId);
          despacho.avanzar(ev.ot, 'restablecer', { causa_id: causaId, trabajo_realizado: TRABAJO[causa[1]], foto: FOTO_DEMO }, jefeDe[ev.cuadrilla]);
          // La cuadrilla queda donde fue la falla
          const p = db.uno('SELECT COALESCE(i.lat, z.lat) AS lat, COALESCE(i.lng, z.lng) AS lng FROM incidencia i JOIN zona z ON z.id = i.zona_id WHERE i.id = ?', ev.id);
          db.ejecutar('UPDATE cuadrilla SET lat = ?, lng = ?, fecha_ubicacion = ? WHERE id = ?', p.lat, p.lng, iso(), ev.cuadrilla);
          seguir(ev, 'validar', min(30, 10 * 60));
          for (const rep of db.todos('SELECT id FROM reporte WHERE incidencia_id = ?', ev.id)) {
            const x = rnd();
            if (causa[3] === 'CLIENTE') continue; // falla interna del cliente: no se le pregunta si volvió la luz
            if (x < 0.32) agendar({ t: ev.t + min(15, 12 * 60), tipo: 'confirmar', reporteId: rep.id, respuesta: 'SI', codigoTipo: ev.codigoTipo });
            else if (x < 0.335 && !ev.reintento) agendar({ t: ev.t + min(20, 6 * 60), tipo: 'confirmar', reporteId: rep.id, respuesta: 'NO', codigoTipo: ev.codigoTipo });
          }
        } else if (ev.paso === 'validar') {
          if (i.estado !== 'RESTABLECIDA') continue;
          despacho.validar(i.id, { aprobar: true }, supervisorDe[i.area_id]);
        }
      }
    } catch { /* la incidencia cambió de estado en paralelo (fusión, anulación o reapertura) */ }
  }
  fijarReloj(null);
  sembrarTrabajoEnCurso({ zonas, persona, padronPorZona, usuarios, despachador, supervisorDe, jefeDe });
  // Las cuadrillas en turno reportan su ubicación cada pocos minutos desde el celular del jefe
  for (const c of db.todos('SELECT * FROM cuadrilla WHERE en_turno = 1')) {
    db.ejecutar('UPDATE cuadrilla SET fecha_ubicacion = ? WHERE id = ?', new Date(Date.now() - (1 + rnd() * 12) * 60e3).toISOString(), c.id);
  }
}

// 3) Trabajo en curso para la demostración: al entrar, cada rol ya tiene algo que atender.
// Se usan zonas fuera del Cercado de Chiclayo para no mezclarse con el caso de prueba del cliente (suministro 10234567).
function sembrarTrabajoEnCurso({ zonas, persona, padronPorZona, usuarios, despachador, supervisorDe, jefeDe }) {
  const zona = (nombre) => zonas.find((z) => z.nombre === nombre);
  const haceMin = (m) => fijarReloj(new Date(Date.now() - m * 60e3));
  const reportar = (tipo, z, n, extra = {}) => {
    let codigo = null;
    const p = padronPorZona.get(z.id) || [];
    const base = p.length ? p[0] : { direccion: 'Calle principal 120', lat: z.lat, lng: z.lng };
    for (let k = 0; k < n; k++) {
      // Vecinos de la misma cuadra: el sistema los agrupa en una sola incidencia
      const r = inc.registrarReporte({
        tipo_id: tipo, zona_id: z.id, direccion: k ? `${base.direccion.replace(/\d+\s*$/, '')}${100 + k * 12}` : base.direccion,
        lat: base.lat + k * 0.0002, lng: base.lng + k * 0.0002, consentimiento: true, ...persona(),
        ...(k === 0 && base.numero && [1, 5].includes(tipo) ? { suministro: base.numero } : {}),
        ...([1, 5].includes(tipo) ? { alcance: 'VARIAS_CASAS' } : {}), ...extra,
      }, { canal: k % 2 ? 'TELEFONO' : 'WEB', usuarioId: k % 2 ? usuarios['operador.atc'].id : null });
      codigo = codigo || r.incidencia;
    }
    return db.uno('SELECT * FROM incidencia WHERE codigo = ?', codigo);
  };
  const despachar = (i, quien) => {
    const libres = despacho.candidatos(i.id).filter((x) => x.estado === 'DISPONIBLE' && x.misma_unidad && x.codigo !== 'EM-CH01');
    const c = libres.find((x) => x.recomendada) || libres[0];
    if (!c) return null;
    const ot = despacho.asignar(i.id, { cuadrilla_id: c.id }, quien);
    return { ot, jefe: jefeDe[c.id] };
  };
  try {
    // Por despachar (CCO): corte que afecta a varias casas en La Victoria
    haceMin(18); reportar(1, zona('La Victoria'), 3);
    // Por programar (supervisor de Alumbrado Público): lámpara apagada en Pimentel
    haceMin(95); reportar(4, zona('Pimentel'), 2);
    // Cuadrilla en camino: cable caído en José Leonardo Ortiz
    haceMin(30); const cable = reportar(2, zona('José Leonardo Ortiz'), 2);
    haceMin(24); const d1 = despachar(cable, despachador);
    if (d1) { haceMin(20); despacho.avanzar(d1.ot.id, 'en_camino', {}, d1.jefe); }
    // Por validar (supervisor de Operaciones): corte en Lambayeque ya restablecido
    haceMin(150); const corte = reportar(1, zona('Lambayeque'), 2);
    haceMin(140); const d2 = despachar(corte, despachador);
    if (d2) {
      haceMin(132); despacho.avanzar(d2.ot.id, 'en_camino', {}, d2.jefe);
      haceMin(110); despacho.avanzar(d2.ot.id, 'en_lugar', {}, d2.jefe);
      haceMin(105); despacho.avanzar(d2.ot.id, 'reparando', {}, d2.jefe);
      haceMin(60); despacho.avanzar(d2.ot.id, 'restablecer', { causa_id: 1, trabajo_realizado: 'Se cambió el fusible de la SED y se repuso el servicio.', foto: FOTO_DEMO }, d2.jefe);
    }
  } catch (e) {
    console.warn('No se pudo sembrar todo el trabajo en curso de la demostración:', e.message);
  } finally {
    fijarReloj(null);
  }
}

module.exports = { sembrarCatalogo, sembrarDemo, CLAVE_DEMO, TIPOS, SUMINISTROS_DEMO, CUADRILLAS_DEMO, usuarioJefe, FOTO_DEMO };
