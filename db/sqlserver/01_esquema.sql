/* =====================================================================
   ENSA Reporta · Esquema de base de datos para producción (SQL Server 2019+)
   Equivalente a src/schema.sql (SQLite, piloto). Fechas en UTC (datetime2).
   Ejecutar en una base nueva:  CREATE DATABASE EnsaReporta;  USE EnsaReporta;
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE TABLE dbo.unidad_negocio (
  id      INT          NOT NULL PRIMARY KEY,
  codigo  VARCHAR(10)  NOT NULL UNIQUE,
  nombre  NVARCHAR(80) NOT NULL
);

CREATE TABLE dbo.zona (
  id                 INT IDENTITY(1,1) PRIMARY KEY,
  unidad_negocio_id  INT           NOT NULL REFERENCES dbo.unidad_negocio(id),
  nombre             NVARCHAR(80)  NOT NULL,
  lat                DECIMAL(9,6)  NULL,
  lng                DECIMAL(9,6)  NULL,
  activo             BIT           NOT NULL DEFAULT 1
);

CREATE TABLE dbo.area (
  id      INT          NOT NULL PRIMARY KEY,
  codigo  VARCHAR(10)  NOT NULL UNIQUE,
  nombre  NVARCHAR(80) NOT NULL
);

CREATE TABLE dbo.tipo_incidencia (
  id                    INT           NOT NULL PRIMARY KEY,
  codigo                VARCHAR(20)   NOT NULL UNIQUE,
  nombre                NVARCHAR(80)  NOT NULL,
  descripcion           NVARCHAR(200) NULL,
  prioridad             VARCHAR(10)   NOT NULL CHECK (prioridad IN ('CRITICA','ALTA','MEDIA','BAJA')),
  plazo_horas           INT           NOT NULL,
  area_id               INT           NOT NULL REFERENCES dbo.area(id),
  radio_agrupacion_m    INT           NULL,          -- NULL = toda la zona
  ventana_agrupacion_h  INT           NOT NULL,
  activo                BIT           NOT NULL DEFAULT 1
);

CREATE TABLE dbo.usuario (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  usuario     VARCHAR(40)   NOT NULL UNIQUE,         -- en producción: UPN de Office 365 (Entra ID)
  nombre      NVARCHAR(120) NOT NULL,
  rol         VARCHAR(12)   NOT NULL CHECK (rol IN ('ADMIN','OPERADOR','SUPERVISOR','GERENCIA')),
  area_id     INT           NULL REFERENCES dbo.area(id),
  clave_hash  VARCHAR(200)  NULL,                    -- NULL cuando el acceso es solo por Entra ID
  activo      BIT           NOT NULL DEFAULT 1,
  creado_en   DATETIME2(3)  NOT NULL
);

CREATE TABLE dbo.suministro (
  numero       VARCHAR(12)   NOT NULL PRIMARY KEY,
  titular      NVARCHAR(150) NOT NULL,
  documento    VARCHAR(11)   NOT NULL,
  direccion    NVARCHAR(200) NOT NULL,
  zona_id      INT           NOT NULL REFERENCES dbo.zona(id),
  lat          DECIMAL(9,6)  NULL,
  lng          DECIMAL(9,6)  NULL,
  sed          VARCHAR(20)   NULL,
  telefono     VARCHAR(15)   NULL,
  actualizado  DATETIME2(3)  NOT NULL
);
CREATE INDEX ix_suministro_sed ON dbo.suministro (sed);

CREATE TABLE dbo.incidencia (
  id                 INT IDENTITY(1,1) PRIMARY KEY,
  codigo             VARCHAR(20)   NOT NULL UNIQUE,
  tipo_id            INT           NOT NULL REFERENCES dbo.tipo_incidencia(id),
  zona_id            INT           NOT NULL REFERENCES dbo.zona(id),
  direccion          NVARCHAR(420) NOT NULL,
  lat                DECIMAL(9,6)  NULL,
  lng                DECIMAL(9,6)  NULL,
  estado             VARCHAR(12)   NOT NULL CHECK (estado IN ('REGISTRADA','ASIGNADA','EN_ATENCION','SOLUCIONADA','ANULADA')),
  prioridad          VARCHAR(10)   NOT NULL,
  area_id            INT           NOT NULL REFERENCES dbo.area(id),
  cuadrilla          NVARCHAR(80)  NULL,
  fecha_registro     DATETIME2(3)  NOT NULL,
  fecha_limite       DATETIME2(3)  NOT NULL,
  fecha_asignacion   DATETIME2(3)  NULL,
  fecha_atencion     DATETIME2(3)  NULL,
  fecha_solucion     DATETIME2(3)  NULL,
  detalle_solucion   NVARCHAR(500) NULL,
  fusionada_en_id    INT           NULL REFERENCES dbo.incidencia(id),
  cantidad_reportes  INT           NOT NULL DEFAULT 0
);
CREATE INDEX ix_incidencia_abierta ON dbo.incidencia (tipo_id, zona_id, estado, fecha_registro);
CREATE INDEX ix_incidencia_fecha   ON dbo.incidencia (fecha_registro) INCLUDE (estado, fecha_limite, fecha_solucion);

CREATE TABLE dbo.reporte (
  id               INT IDENTITY(1,1) PRIMARY KEY,
  codigo           VARCHAR(20)   NOT NULL UNIQUE,
  incidencia_id    INT           NOT NULL REFERENCES dbo.incidencia(id),
  canal            VARCHAR(10)   NOT NULL CHECK (canal IN ('WEB','APP','TELEFONO','OFICINA','WHATSAPP')),
  nombre           NVARCHAR(120) NOT NULL,
  documento        VARCHAR(12)   NULL,
  telefono         VARCHAR(15)   NOT NULL,
  email            VARCHAR(120)  NULL,
  suministro       VARCHAR(12)   NULL,
  sed              VARCHAR(20)   NULL,
  autenticado      BIT           NOT NULL DEFAULT 0,
  direccion        NVARCHAR(200) NOT NULL,
  referencia       NVARCHAR(200) NULL,
  lat              DECIMAL(9,6)  NULL,
  lng              DECIMAL(9,6)  NULL,
  descripcion      NVARCHAR(500) NULL,
  foto             VARCHAR(60)   NULL,
  es_duplicado     BIT           NOT NULL DEFAULT 0,
  tipo_agrupacion  VARCHAR(10)   NULL CHECK (tipo_agrupacion IN ('AUTOMATICA','MANUAL')),
  consentimiento   BIT           NOT NULL DEFAULT 1,
  registrado_por   INT           NULL REFERENCES dbo.usuario(id),
  fecha            DATETIME2(3)  NOT NULL
);
CREATE INDEX ix_reporte_incidencia ON dbo.reporte (incidencia_id);
CREATE INDEX ix_reporte_fecha      ON dbo.reporte (fecha);
CREATE INDEX ix_reporte_suministro ON dbo.reporte (suministro);

CREATE TABLE dbo.historial (
  id               BIGINT IDENTITY(1,1) PRIMARY KEY,
  incidencia_id    INT           NOT NULL REFERENCES dbo.incidencia(id),
  estado_anterior  VARCHAR(12)   NULL,
  estado_nuevo     VARCHAR(12)   NOT NULL,
  comentario       NVARCHAR(500) NULL,
  usuario_id       INT           NULL REFERENCES dbo.usuario(id),
  fecha            DATETIME2(3)  NOT NULL
);
CREATE INDEX ix_historial_incidencia ON dbo.historial (incidencia_id);

CREATE TABLE dbo.notificacion (
  id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  reporte_id  INT           NOT NULL REFERENCES dbo.reporte(id),
  canal       VARCHAR(5)    NOT NULL CHECK (canal IN ('SMS','EMAIL')),
  destino     VARCHAR(120)  NOT NULL,
  mensaje     NVARCHAR(400) NOT NULL,
  estado      VARCHAR(10)   NOT NULL CHECK (estado IN ('PENDIENTE','ENVIADO','ERROR')),
  fecha       DATETIME2(3)  NOT NULL
);

CREATE TABLE dbo.auditoria (
  id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  usuario_id  INT           NULL REFERENCES dbo.usuario(id),
  accion      VARCHAR(40)   NOT NULL,
  entidad     VARCHAR(30)   NULL,
  entidad_id  INT           NULL,
  detalle     NVARCHAR(500) NULL,
  ip          VARCHAR(45)   NULL,
  fecha       DATETIME2(3)  NOT NULL
);
CREATE INDEX ix_auditoria_fecha ON dbo.auditoria (fecha);

-- Correlativos por año (INC-AAAA-NNNNNN, RP-AAAA-NNNNNN)
CREATE TABLE dbo.secuencia (
  nombre  VARCHAR(20) NOT NULL PRIMARY KEY,
  valor   INT         NOT NULL
);
GO

/* La aplicación solo necesita lectura y escritura de datos.
   La auditoría no se puede modificar ni borrar desde la cuenta de la aplicación. */
-- CREATE LOGIN ensa_reporta_app WITH PASSWORD = '<definir en bóveda de secretos>';
-- CREATE USER  ensa_reporta_app FOR LOGIN ensa_reporta_app;
-- ALTER ROLE db_datareader ADD MEMBER ensa_reporta_app;
-- ALTER ROLE db_datawriter ADD MEMBER ensa_reporta_app;
-- DENY UPDATE, DELETE ON dbo.auditoria TO ensa_reporta_app;
GO
