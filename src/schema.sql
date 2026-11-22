-- ENSA Reporta · Esquema de base de datos (SQLite, versión piloto)
-- El script equivalente para SQL Server está en db/sqlserver/01_esquema.sql

CREATE TABLE IF NOT EXISTS unidad_negocio (
  id        INTEGER PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zona (
  id                 INTEGER PRIMARY KEY,
  unidad_negocio_id  INTEGER NOT NULL REFERENCES unidad_negocio(id),
  nombre             TEXT NOT NULL,
  lat                REAL,
  lng                REAL,
  activo             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS area (
  id        INTEGER PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tipo_incidencia (
  id              INTEGER PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  prioridad       TEXT NOT NULL CHECK (prioridad IN ('CRITICA','ALTA','MEDIA','BAJA')),
  plazo_horas     INTEGER NOT NULL,           -- plazo de atención (registro → solución)
  area_id         INTEGER NOT NULL REFERENCES area(id),
  radio_agrupacion_m INTEGER,                 -- NULL = toda la zona
  ventana_agrupacion_h INTEGER NOT NULL,      -- antigüedad máxima de la incidencia abierta para agrupar
  activo          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuario (
  id          INTEGER PRIMARY KEY,
  usuario     TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL CHECK (rol IN ('ADMIN','OPERADOR','DESPACHADOR','SUPERVISOR','JEFE_CUADRILLA','GERENCIA')),
  area_id     INTEGER REFERENCES area(id),
  clave_hash  TEXT NOT NULL,
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);

-- Padrón de suministros: copia periódica (exportación) del sistema comercial Optimus NGC.
-- Permite al cliente ingresar con su número de suministro y agrupar cortes por subestación (SED).
CREATE TABLE IF NOT EXISTS suministro (
  numero        TEXT PRIMARY KEY,
  titular       TEXT NOT NULL,
  documento     TEXT NOT NULL,              -- DNI o RUC del titular
  direccion     TEXT NOT NULL,
  zona_id       INTEGER NOT NULL REFERENCES zona(id),
  lat           REAL,
  lng           REAL,
  sed           TEXT,                       -- subestación de distribución
  telefono      TEXT,
  actualizado   TEXT NOT NULL
);

-- Incidencia = una falla en campo. Puede tener uno o varios reportes de clientes.
CREATE TABLE IF NOT EXISTS incidencia (
  id                INTEGER PRIMARY KEY,
  codigo            TEXT NOT NULL UNIQUE,
  tipo_id           INTEGER NOT NULL REFERENCES tipo_incidencia(id),
  zona_id           INTEGER NOT NULL REFERENCES zona(id),
  direccion         TEXT NOT NULL,
  lat               REAL,
  lng               REAL,
  -- Flujo: REGISTRADA → ASIGNADA (orden de trabajo) → EN_CAMINO → EN_LUGAR → REPARANDO
  --        → RESTABLECIDA (la cuadrilla repuso el servicio) → SOLUCIONADA (el supervisor validó). ANULADA en cualquier momento previo.
  estado            TEXT NOT NULL CHECK (estado IN ('REGISTRADA','ASIGNADA','EN_CAMINO','EN_LUGAR','REPARANDO','RESTABLECIDA','SOLUCIONADA','ANULADA')),
  prioridad         TEXT NOT NULL,
  area_id           INTEGER NOT NULL REFERENCES area(id),
  orden_actual_id   INTEGER,                    -- orden de trabajo vigente
  fecha_registro    TEXT NOT NULL,
  fecha_limite      TEXT NOT NULL,
  fecha_asignacion  TEXT,
  fecha_atencion    TEXT,                       -- llegada de la cuadrilla al lugar
  fecha_solucion    TEXT,                       -- servicio restablecido (base del KPI de atención)
  fecha_validacion  TEXT,
  detalle_solucion  TEXT,
  reaperturas       INTEGER NOT NULL DEFAULT 0,
  fusionada_en_id   INTEGER REFERENCES incidencia(id),
  cantidad_reportes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_incidencia_abierta ON incidencia (tipo_id, zona_id, estado, fecha_registro);
CREATE INDEX IF NOT EXISTS ix_incidencia_fecha ON incidencia (fecha_registro);

-- Reporte = lo que registra un cliente (o el personal de atención por él). Tiene su número de seguimiento.
CREATE TABLE IF NOT EXISTS reporte (
  id               INTEGER PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,      -- número de seguimiento entregado al cliente
  incidencia_id    INTEGER NOT NULL REFERENCES incidencia(id),
  canal            TEXT NOT NULL CHECK (canal IN ('WEB','APP','TELEFONO','OFICINA','WHATSAPP')),
  nombre           TEXT NOT NULL,
  documento        TEXT,
  telefono         TEXT NOT NULL,
  email            TEXT,
  suministro       TEXT,
  sed              TEXT,
  autenticado      INTEGER NOT NULL DEFAULT 0, -- 1 = el cliente ingresó con suministro + DNI
  direccion        TEXT NOT NULL,
  referencia       TEXT,
  lat              REAL,
  lng              REAL,
  descripcion      TEXT,
  foto             TEXT,                       -- nombre de archivo en data/fotos
  es_duplicado     INTEGER NOT NULL DEFAULT 0,
  tipo_agrupacion  TEXT CHECK (tipo_agrupacion IN ('AUTOMATICA','MANUAL')),
  alcance          TEXT CHECK (alcance IN ('SOLO_MI_CASA','VARIAS_CASAS','NO_SE')),  -- cortes y luz baja
  requiere_acceso  INTEGER NOT NULL DEFAULT 0, -- la cuadrilla debe entrar al predio (medidor interior o medición)
  franja_horaria   TEXT,                       -- disponibilidad del cliente cuando requiere acceso
  confirmacion     TEXT CHECK (confirmacion IN ('SI','NO')),  -- ¿volvió la luz? respuesta del cliente
  fecha_confirmacion TEXT,
  consentimiento   INTEGER NOT NULL DEFAULT 1,
  registrado_por   INTEGER REFERENCES usuario(id),
  fecha            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_reporte_incidencia ON reporte (incidencia_id);
CREATE INDEX IF NOT EXISTS ix_reporte_fecha ON reporte (fecha);

-- Empresas contratistas de ENSA (servicios tercerizados de emergencias, mantenimiento y alumbrado público)
CREATE TABLE IF NOT EXISTS empresa_contratista (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT NOT NULL,
  ruc         TEXT,
  servicio    TEXT NOT NULL,               -- objeto del contrato
  contrato    TEXT,                        -- número de contrato o proceso
  vigencia_hasta TEXT,
  activo      INTEGER NOT NULL DEFAULT 1
);

-- Cuadrillas de campo: propias de ENSA o de una empresa contratista
CREATE TABLE IF NOT EXISTS cuadrilla (
  id                 INTEGER PRIMARY KEY,
  codigo             TEXT NOT NULL UNIQUE,
  nombre             TEXT NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('PROPIA','CONTRATISTA')),
  empresa_id         INTEGER REFERENCES empresa_contratista(id),
  area_id            INTEGER NOT NULL REFERENCES area(id),       -- especialidad: qué tipos de falla atiende
  unidad_negocio_id  INTEGER NOT NULL REFERENCES unidad_negocio(id),
  zona_base_id       INTEGER REFERENCES zona(id),
  jefe_usuario_id    INTEGER REFERENCES usuario(id),
  integrantes        INTEGER NOT NULL DEFAULT 3,
  vehiculo           TEXT,
  en_turno           INTEGER NOT NULL DEFAULT 1,
  lat                REAL,                     -- última ubicación reportada (solo personal de ENSA)
  lng                REAL,
  fecha_ubicacion    TEXT,
  activo             INTEGER NOT NULL DEFAULT 1,
  CHECK (tipo = 'PROPIA' OR empresa_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS cuadrilla_ubicacion (
  id            INTEGER PRIMARY KEY,
  cuadrilla_id  INTEGER NOT NULL REFERENCES cuadrilla(id),
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  fecha         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ubicacion_cuadrilla ON cuadrilla_ubicacion (cuadrilla_id, fecha);

-- Causas de la falla (las registra el jefe de cuadrilla al cerrar)
CREATE TABLE IF NOT EXISTS causa (
  id               INTEGER PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  nombre           TEXT NOT NULL,
  responsabilidad  TEXT NOT NULL CHECK (responsabilidad IN ('ENSA','CLIENTE','TERCEROS','NATURALEZA'))
);

-- Orden de trabajo: lo que el Centro de Control (o el supervisor) emite a una cuadrilla (MAPRO P12.01 / P12.02)
CREATE TABLE IF NOT EXISTS orden_trabajo (
  id                  INTEGER PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,           -- OT-AAAA-NNNNNN
  incidencia_id       INTEGER NOT NULL REFERENCES incidencia(id),
  cuadrilla_id        INTEGER NOT NULL REFERENCES cuadrilla(id),
  estado              TEXT NOT NULL CHECK (estado IN ('ASIGNADA','EN_CAMINO','EN_LUGAR','REPARANDO','RESTABLECIDA','VALIDADA','CANCELADA','RECHAZADA')),
  instrucciones       TEXT,
  asignada_por        INTEGER REFERENCES usuario(id),
  fecha_asignacion    TEXT NOT NULL,
  fecha_en_camino     TEXT,
  eta                 TEXT,                           -- hora estimada de llegada
  eta_manual          INTEGER NOT NULL DEFAULT 0,
  distancia_km        REAL,
  fecha_llegada       TEXT,
  fecha_reparando     TEXT,
  fecha_restablecida  TEXT,
  causa_id            INTEGER REFERENCES causa(id),
  trabajo_realizado   TEXT,
  foto_cierre         TEXT,
  validado_por        INTEGER REFERENCES usuario(id),
  fecha_validacion    TEXT,
  observacion         TEXT,                           -- motivo de rechazo o cancelación
  devoluciones        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ot_cuadrilla ON orden_trabajo (cuadrilla_id, estado);
CREATE INDEX IF NOT EXISTS ix_ot_incidencia ON orden_trabajo (incidencia_id);

CREATE TABLE IF NOT EXISTS historial (
  id               INTEGER PRIMARY KEY,
  incidencia_id    INTEGER NOT NULL REFERENCES incidencia(id),
  estado_anterior  TEXT,
  estado_nuevo     TEXT NOT NULL,
  comentario       TEXT,
  usuario_id       INTEGER REFERENCES usuario(id),
  fecha            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_historial_incidencia ON historial (incidencia_id);

CREATE TABLE IF NOT EXISTS notificacion (
  id          INTEGER PRIMARY KEY,
  reporte_id  INTEGER NOT NULL REFERENCES reporte(id),
  canal       TEXT NOT NULL CHECK (canal IN ('SMS','EMAIL')),
  destino     TEXT NOT NULL,
  mensaje     TEXT NOT NULL,
  estado      TEXT NOT NULL CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR')),
  fecha       TEXT NOT NULL
);

-- Encuesta de satisfacción, totalmente opcional: el cliente califica con estrellas (1 a 5) la atención en general
-- y/o la rapidez, cuando su servicio fue restablecido. Una por reporte. Se guarda la cuadrilla que atendió
-- para medir la calidad del servicio de cada una (propias y contratistas).
CREATE TABLE IF NOT EXISTS encuesta (
  id                INTEGER PRIMARY KEY,
  reporte_id        INTEGER NOT NULL UNIQUE REFERENCES reporte(id),
  incidencia_id     INTEGER NOT NULL REFERENCES incidencia(id),
  orden_trabajo_id  INTEGER REFERENCES orden_trabajo(id),
  cuadrilla_id      INTEGER REFERENCES cuadrilla(id),
  general           INTEGER CHECK (general BETWEEN 1 AND 5),
  rapidez           INTEGER CHECK (rapidez BETWEEN 1 AND 5),
  fecha             TEXT NOT NULL,
  CHECK (general IS NOT NULL OR rapidez IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_encuesta_incidencia ON encuesta (incidencia_id);
CREATE INDEX IF NOT EXISTS ix_encuesta_cuadrilla ON encuesta (cuadrilla_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuario(id),
  accion      TEXT NOT NULL,
  entidad     TEXT,
  entidad_id  INTEGER,
  detalle     TEXT,
  ip          TEXT,
  fecha       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_auditoria_fecha ON auditoria (fecha);

CREATE TABLE IF NOT EXISTS secuencia (
  nombre  TEXT PRIMARY KEY,
  valor   INTEGER NOT NULL
);
