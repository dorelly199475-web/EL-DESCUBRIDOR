# Sistema de Gestión de Inventario - El Descubridor
## Conversión a JavaScript Puro

### Descripción
Proyecto de gestión de inventario y punto de venta convertido de Google Apps Script a JavaScript estándar.

### Estructura de Archivos

```
APPS SCRIPT INVENTARIO/
├── index.html           # Archivo principal HTML (interfaz)
├── styles.css           # Estilos CSS (antes en styles.html)
├── app.js              # Lógica de aplicación y UI
├── api.js              # Cliente API, modelos de datos y utilidades
├── Código.gs           # Archivo original Google Apps Script (legacy)
└── README.md           # Este archivo
```

### Archivos Creados

#### 1. **styles.css**
- Contiene todos los estilos CSS
- Variables CSS para temas personalizables
- Animaciones y responsividad
- Separado de HTML para mejor mantenibilidad

#### 2. **app.js**
Módulo principal de la aplicación con:
- `UserService`: Gestión de usuarios con localStorage
- `acquireLockWithRetry()`: Sistema de locks para concurrencia
- `logConcurrencyIssue()`: Registro de problemas de concurrencia
- Funciones de navegación y manejo de eventos
- Gestión del login y sesiones

#### 3. **api.js**
Módulo de API y datos con:
- `APIClient`: Cliente HTTP para comunicación
- Modelos de datos: `Client`, `Item`, `Sale`
- `Utils`: Funciones de utilidad (formateo, notificaciones, etc.)

#### 4. **index.html**
- Interfaz de usuario limpia
- Referencia a estilos externos: `<link rel="stylesheet" href="styles.css">`
- Referencia a scripts externos: `<script src="app.js"></script>` y `<script src="api.js"></script>`
- Plantilla HTML5 semántica

### Cambios Principales

| Aspecto | Google Apps Script | JavaScript Puro |
|--------|------------------|-----------------|
| **Storage** | PropertiesService | localStorage |
| **HTTP** | google.script.run | Fetch API |
| **Locks** | LockService | localStorage (simulado) |
| **Async** | Callbacks | Promises |
| **Almacenamiento de Usuario** | Servidor | localStorage |

### Funcionalidades Implementadas

✅ Sistema de login con localStorage
✅ Gestión de usuarios
✅ Gestión de clientes
✅ Gestión de inventario
✅ Sistema de ventas
✅ Sistema de concurrencia con reintentos
✅ Búsqueda inteligente (Select2)
✅ Alertas con SweetAlert2
✅ Interfaz responsiva

### Instalación y Uso

1. **Colocar archivos en servidor web**
   - Necesitas un servidor web o deploy local (no funciona con file://)
   - Los archivos CSS y JS deben estar en la misma carpeta que index.html

2. **Configurar endpoint de API**
   - Editar `api.js` y actualizar `baseURL` en `APIClient`
   - Por defecto usa la raíz del servidor

3. **Abrir en navegador**
   - `http://localhost:8000/index.html`
   - O la URL donde hayas deployado los archivos

### Dependencias Externas

- [jQuery 3.6.0](https://code.jquery.com/)
- [Select2 4.1.0](https://select2.org/)
- [SweetAlert2](https://sweetalert2.github.io/)
- [Material Icons](https://fonts.google.com/icons)

### Scripts Necesarios para Backend

Si implementas un backend, necesitarás endpoints API como:

```
GET  /api/clients
POST /api/clients
PUT  /api/clients/{id}
DELETE /api/clients/{id}

GET  /api/items
POST /api/items
PUT  /api/items/{id}
DELETE /api/items/{id}

GET  /api/sales
POST /api/sales
PUT  /api/sales/{id}
DELETE /api/sales/{id}
```

### Archivos Originales Conservados

- `Código.gs`: Código Google Apps Script original (legacy)
- `styles.html`: Contenía CSS en formato HTML (reemplazado por styles.css)

### Próximos Pasos

1. Conectar a un backend (Node.js, Python, PHP, etc.)
2. Implementar persistencia en base de datos
3. Agregar autenticación más robusta
4. Implementar reportes y exportación de datos
5. Agregar validaciones del lado del servidor
6. Mejorar seguridad con tokens JWT

### Desarrollo

Para modificar el código:
1. **Estilos**: Edita `styles.css`
2. **Interfaz**: Edita `index.html`
3. **Lógica UI**: Edita `app.js`
4. **Modelos y API**: Edita `api.js`

### Notas

- El código usa localStorage para persistencia temporal
- Para producción, se recomienda conectar a una base de datos real
- La seguridad actual es básica - implementar autenticación segura para producción
- Los datos se pierden al limpiar el caché del navegador
