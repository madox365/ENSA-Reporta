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
  rol         TEXT NOT NULL CHECK (rol IN ('ADMIN','OPERADOR','SUPERVISOR','GERENCIA')),
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
  estado            TEXT NOT NULL CHECK (estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION','SOLUCIONADA','ANULADA')),
  prioridad         TEXT NOT NULL,
  area_id           INTEGER NOT NULL REFERENCES area(id),
  cuadrilla         TEXT,
  fecha_registro    TEXT NOT NULL,
  fecha_limite      TEXT NOT NULL,
  fecha_asignacion  TEXT,
  fecha_atencion    TEXT,
  fecha_solucion    TEXT,
  detalle_solucion  TEXT,
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
  consentimiento   INTEGER NOT NULL DEFAULT 1,
  registrado_por   INTEGER REFERENCES usuario(id),
  fecha            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_reporte_incidencia ON reporte (incidencia_id);
CREATE INDEX IF NOT EXISTS ix_reporte_fecha ON reporte (fecha);

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
