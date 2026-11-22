# ENSA Reporta

Sistema de gestión de incidencias del servicio para clientes de Electronorte S.A. (ENSA).
Proyecto **P01** de la cartera del PETI · OTI 2 Calidad de suministro habilitada por TI · OTI 4 Experiencia digital del cliente.

Una sola aplicación web adaptable (PWA) con dos vistas:

- **Clientes** (`/`): reportan cortes de luz, cables caídos, postes dañados, alumbrado público y luz baja, desde el celular o la computadora. Pueden ingresar solo con su **número de suministro** (se cargan del padrón su dirección, ubicación y celular), y reciben un número de seguimiento.
- **Personal** (`/personal`): bandeja de incidencias, registro de reportes telefónicos, despacho de órdenes de trabajo a cuadrillas, validación del cierre, tablero de indicadores y administración.
- **Jefe de cuadrilla** (`/personal`, desde el celular): recibe sus órdenes de trabajo, marca *en camino* (con hora estimada de llegada), *en el lugar*, *reparando* y *servicio restablecido* con la causa, el trabajo realizado y una foto. Comparte su ubicación solo con el personal de ENSA.

## Proceso de atención (MAPRO P12.01 / P12.02)

1. El cliente reporta (web, app, teléfono, oficina o WhatsApp). Si es un corte o luz baja indica si afecta solo a su casa y, si la cuadrilla debe entrar, en qué horario habrá alguien.
2. El **Centro de Control de Operaciones** (cortes, cables, luz baja) o el **supervisor del área** (alumbrado público, postes) emite una **orden de trabajo** a una cuadrilla elegida de la lista: propia de ENSA o de una empresa contratista, disponible y cercana.
3. El **jefe de cuadrilla** registra el avance desde su celular. El cliente ve cada paso y la hora estimada de llegada, nunca la ubicación de la cuadrilla.
4. Al restablecer el servicio se avisa a todos los clientes que reportaron. El cliente responde *¿volvió tu luz?*; si dice que no, la incidencia se reabre.
5. El **supervisor del área** valida el cierre o lo devuelve a la cuadrilla.

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
| `operador.atc` | Atención al Cliente: registra reportes telefónicos, fusiona duplicados, anula improcedentes |
| `despacho.cco` | Centro de Control de Operaciones: emite órdenes de trabajo de cortes, cables caídos y luz baja |
| `supervisor.ope` | Supervisor de Operaciones: valida los cierres de emergencias |
| `supervisor.alp` | Supervisor de Alumbrado Público: programa y valida las órdenes de alumbrado |
| `supervisor.man` | Supervisor de Mantenimiento de Redes: programa y valida las órdenes de postes |
| `jefe.emch01` … `jefe.mrca01` | Jefes de cuadrilla (uno por cada una de las 14 cuadrillas; por ejemplo `jefe.lech01`, `jefe.apch01`) |
| `gerencia` | Gerencia Regional: solo tablero |
| `admin.tic` | Jefatura de TIC: catálogo, usuarios, auditoría |

### Suministros de demostración (para "Ingresar con mi suministro")

| Suministro | Titular (DNI/RUC, solo referencia) | Dirección | Subestación |
|---|---|---|---|
| 10234567 | 45678912 | Calle Elías Aguirre 845, Chiclayo | SED-CHI-1101 |
| 10234568 | 41234567 | Calle San José 1020, Chiclayo | SED-CHI-1101 |
| 10345678 | 40987654 | Av. Augusto B. Leguía 330, Lambayeque | SED-SUC-2207 |
| 10456789 | 20601234567 | Av. Grau 512, José Leonardo Ortiz | SED-CHI-1340 |

Los dos primeros comparten subestación: si ambos reportan un corte, el sistema los agrupa en una sola incidencia.

### Cuadrillas de demostración

14 cuadrillas en las tres unidades de negocio: de emergencias (`EM-…`), líneas energizadas (`LE-CH01`), alumbrado público (`AP-…`) y mantenimiento de redes (`MR-…`). Unas son propias de ENSA y otras de tres empresas contratistas **ficticias**, marcadas "(demo)". El usuario de cada jefe es `jefe.` + el código sin guion, en minúsculas (`EM-CH01` → `jefe.emch01`).

Al iniciar, la demostración ya tiene trabajo en curso fuera del Cercado de Chiclayo: un corte por despachar en La Victoria, alumbrado por programar en Pimentel, un cable caído con la cuadrilla en camino en José Leonardo Ortiz y un corte restablecido por validar en Lambayeque. La cuadrilla `EM-CH01` queda libre para probar el caso del cliente con el suministro `10234567`.

Al despachar, el sistema sugiere primero las cuadrillas de la especialidad que atiende ese tipo de falla (emergencias para cortes, luz baja y cables; alumbrado público; mantenimiento de redes para postes), luego por disponibilidad y distancia.

Al final, el cliente puede responder una **encuesta de satisfacción totalmente opcional** con estrellas (1 a 5): atención en general y rapidez de la atención. Puede ignorarla, cerrarla con "Ahora no" o calificar solo una de las dos. Se ofrece una sola vez por reporte, después de la pregunta "¿Volvió tu luz?" y hasta 7 días después del restablecimiento. El tablero muestra la satisfacción promedio, el porcentaje de clientes satisfechos (4 o 5 estrellas en atención general; meta propuesta ≥ 80%), la distribución de estrellas, la rapidez promedio y la satisfacción por cuadrilla (propias y contratistas).

Si un cliente responde que no volvió la luz: cuando ningún vecino de la misma falla confirmó, la incidencia se reabre; si otros ya confirmaron, se abre una incidencia nueva solo para su predio. Si la cuadrilla cerró con causa de instalación interna del cliente, no se le pregunta.

Si ya tenía una base de la versión anterior, al iniciar se guarda como `data/ensa-reporta.db.anterior-…` y se crea una nueva.

## Comandos

| Comando | Para qué |
|---|---|
| `npm start` | Inicia el sistema |
| `npm test` | Ejecuta las 24 pruebas automatizadas |
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
    incidencias.js       registro, agrupación de duplicados, seguimiento del cliente, anulación, fusión
    despacho.js          cuadrillas, órdenes de trabajo, avance en campo, hora estimada, validación
    clientes.js          ingreso con número de suministro
    indicadores.js       KPI del PETI y exportación CSV
    notificaciones.js    avisos por SMS y correo
    administracion.js    usuarios y catálogo
    auditoria.js         registro de eventos
public/                  interfaz (HTML, CSS, JS) y PWA; js/despacho.js: despacho, cuadrillas y app del jefe
db/sqlserver/            script de base de datos para producción (SQL Server)
scripts/                 reinicio de demo, importación de suministros y respaldo
test/                    pruebas automatizadas
docs/                    documentación del proyecto
```

## Documentación

Ver la carpeta `docs/` (documento de requerimientos, arquitectura y diseño, manual de usuario, plan y casos de prueba, manual de instalación y operación, guion de demostración).
