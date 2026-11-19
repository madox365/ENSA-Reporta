# ENSA Reporta

Sistema de gestión de incidencias del servicio para clientes de Electronorte S.A. (ENSA).
Proyecto **P01** de la cartera del PETI · OTI 2 Calidad de suministro habilitada por TI · OTI 4 Experiencia digital del cliente.

Una sola aplicación web adaptable (PWA) con dos vistas:

- **Clientes** (`/`): reportan cortes de luz, cables caídos, postes dañados, alumbrado público y luz baja, desde el celular o la computadora. Pueden ingresar con su **número de suministro y el DNI del titular**, y reciben un número de seguimiento.
- **Personal** (`/personal`): bandeja de incidencias, registro de reportes telefónicos, asignación a cuadrillas, cierre, tablero de indicadores y administración.

## Requisitos

- **Node.js 22.13 o superior** (LTS). Descarga: https://nodejs.org (versión "LTS").
- No necesita instalar una base de datos: la versión piloto usa SQLite, incluido en Node.js.

## Cómo ejecutarlo (Windows, macOS o Linux)

```bash
cd ENSA_Reporta
npm install        # solo la primera vez
npm start
```

Abra en el navegador:

| Vista | Dirección |
|---|---|
| Clientes | http://localhost:3000/ |
| Personal | http://localhost:3000/personal |

La primera vez se crea la base `data/ensa-reporta.db` con el catálogo y **45 días de datos de demostración**.

### Usuarios de demostración (contraseña `Ensa2027demo`)

| Usuario | Rol |
|---|---|
| `operador.atc` | Atención al Cliente: registra reportes telefónicos, asigna, fusiona duplicados |
| `supervisor.ope` | Supervisor de Operaciones: cortes, cables caídos, luz baja |
| `supervisor.alp` | Supervisor de Alumbrado Público |
| `supervisor.man` | Supervisor de Mantenimiento de Redes: postes |
| `gerencia` | Gerencia Regional: solo tablero |
| `admin.tic` | Jefatura de TIC: catálogo, usuarios, auditoría |

### Suministros de demostración (para "Ingresar con mi suministro")

| Suministro | DNI/RUC del titular | Dirección | Subestación |
|---|---|---|---|
| 10234567 | 45678912 | Calle Elías Aguirre 845, Chiclayo | SED-CHI-1101 |
| 10234568 | 41234567 | Calle San José 1020, Chiclayo | SED-CHI-1101 |
| 10345678 | 40987654 | Av. Augusto B. Leguía 330, Lambayeque | SED-SUC-2207 |
| 10456789 | 20601234567 | Av. Grau 512, José Leonardo Ortiz | SED-CHI-1340 |

Los dos primeros comparten subestación: si ambos reportan un corte, el sistema los agrupa en una sola incidencia.

## Comandos

| Comando | Para qué |
|---|---|
| `npm start` | Inicia el sistema |
| `npm test` | Ejecuta las 15 pruebas automatizadas |
| `npm run reiniciar-demo` | Borra la base de demostración (se recrea al iniciar) |
| `npm run importar-suministros -- archivo.csv` | Carga el padrón de suministros exportado de Optimus NGC |
| `npm run respaldo` | Copia de respaldo de la base y las fotos en `respaldos/` |

## Configuración (variables de entorno)

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | 3000 | Puerto HTTP |
| `DB_PATH` | `data/ensa-reporta.db` | Archivo de base de datos |
| `FOTOS_PATH` | `data/fotos` | Carpeta de fotos de los reportes |
| `DEMO` | (activo) | `0` para no cargar usuarios ni datos de prueba |
| `TEL_EMERGENCIAS` | 0-801-71003 | Central telefónica mostrada al cliente |
| `NOTIF_MODE` | registro | `registro` deja los avisos en la bandeja; en producción, adaptadores de SMS y correo |
| `SESSION_HOURS` | 8 | Duración de la sesión del personal |
| `TRUST_PROXY` | (inactivo) | `1` si se publica detrás de un proxy inverso con HTTPS |

## Estructura

```
src/
  server.js              inicio del servidor
  app.js                 rutas de la API y seguridad HTTP
  auth.js                sesiones del personal (CSRF, bloqueo por intentos)
  db.js / schema.sql     acceso a datos y esquema (SQLite)
  seed.js                catálogo inicial y datos de demostración
  servicios/
    incidencias.js       registro, agrupación de duplicados, estados, fusión
    clientes.js          ingreso con suministro + DNI
    indicadores.js       KPI del PETI y exportación CSV
    notificaciones.js    avisos por SMS y correo
    administracion.js    usuarios y catálogo
    auditoria.js         registro de eventos
public/                  interfaz (HTML, CSS, JS) y PWA
db/sqlserver/            script de base de datos para producción (SQL Server)
scripts/                 reinicio de demo, importación de suministros y respaldo
test/                    pruebas automatizadas
docs/                    documentación del proyecto
```

## Documentación

Ver la carpeta `docs/` (documento de requerimientos, arquitectura y diseño, manual de usuario, plan y casos de prueba, manual de instalación y operación, guion de demostración).
