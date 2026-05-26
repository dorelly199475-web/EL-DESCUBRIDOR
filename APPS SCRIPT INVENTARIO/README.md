# 📦 Sistema de Gestión de Inventario - El Descubridor
## Conversión a JavaScript Puro

**Sistema completo de inventario y punto de venta (POS) con frontend moderno y backend configurable**

### 🎯 Descripción
Proyecto de gestión de inventario y punto de venta convertido de Google Apps Script a JavaScript estándar. Aplicación web completa con:
- ✅ Autenticación de usuarios
- ✅ Gestión de clientes y estudiantes
- ✅ Inventario de uniformes y artículos
- ✅ Sistema de ventas y puntos de venta
- ✅ Cierre de caja diario
- ✅ Reportes y devoluciones
- ✅ Interfaz responsiva y moderna

### 🌐 Demo Online
**[Abre la aplicación aquí](https://dorelly199475-web.github.io/EL-DESCUBRIDOR/)**

> *La aplicación está hosteada en GitHub Pages. Sin necesidad de servidor.*

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

### 🚀 Instalación y Uso

#### Opción 1: Online (GitHub Pages) ⭐ RECOMENDADO
La aplicación está desplegada en vivo sin necesidad de instalación:

```
https://dorelly199475-web.github.io/EL-DESCUBRIDOR/
```

**Ventajas:**
- ✅ No requiere instalación
- ✅ Accesible desde cualquier dispositivo
- ✅ Actualizaciones automáticas
- ✅ SSL incluido

---

#### Opción 2: Servidor Local (Desarrollo)

**Requisitos:**
- Node.js y npm instalados
- O Python 3 instalado

**Con Python (más simple):**
```bash
cd "ruta/a/APPS SCRIPT INVENTARIO"
python -m http.server 8000
```
Luego abre: `http://localhost:8000`

**Con Node.js:**
```bash
npm install
npm start
```

---

#### Opción 3: Deploy Propio

Puedes hacer deploy en:
- **Vercel**: `vercel deploy`
- **Netlify**: Arrastra la carpeta
- **Heroku**: Con un backend Node.js
- **Tu servidor web**: Copia los archivos vía FTP

### Dependencias Externas

- [jQuery 3.6.0](https://code.jquery.com/)
- [Select2 4.1.0](https://select2.org/)
- [SweetAlert2](https://sweetalert2.github.io/)
- [Material Icons](https://fonts.google.com/icons)

### 🔧 Configuración del Backend

#### Opción 1: Backend Node.js (Incluido)

**Instalación:**
```bash
npm install express cors body-parser
```

**Ejecutar:**
```bash
node server.example.js
```

El servidor correrá en `http://localhost:3000`

**Endpoints disponibles:**
```
GET    /api/clients          → Obtener todos los clientes
GET    /api/clients/:id      → Obtener cliente específico
POST   /api/clients          → Crear cliente
PUT    /api/clients/:id      → Actualizar cliente
DELETE /api/clients/:id      → Eliminar cliente

GET    /api/items            → Obtener artículos
POST   /api/items            → Crear artículo
PUT    /api/items/:id        → Actualizar artículo
DELETE /api/items/:id        → Eliminar artículo

GET    /api/sales            → Obtener ventas
POST   /api/sales            → Registrar venta

GET    /api/health           → Health check del servidor
```

---

#### Opción 2: Conectar a Backend Existente

Edita el archivo `api.js` y actualiza la URL base:

```javascript
// En api.js, línea 7
const api = new APIClient('https://tu-servidor.com');
```

**Asegúrate que tu backend tenga:**
- CORS habilitado
- Los mismos endpoints que el ejemplo
- Autenticación (opcional)

---

#### Opción 3: Usar Google Sheets (Legacy)

Si deseas volver a Google Apps Script:
1. Copia el código de `Código.gs` (archivo original)
2. Pégalo en Apps Script de Google Sheets
3. Deploy como App Web
4. Cambia la URL en `api.js`

### Archivos Originales Conservados

- `Código.gs`: Código Google Apps Script original (legacy)
- `styles.html`: Contenía CSS en formato HTML (reemplazado por styles.css)

### 📚 Documentación y Guías

#### Para Principiantes
- [Introducción a Git y GitHub](https://github.com/dorelly199475-web/EL-DESCUBRIDOR)
- [Cómo usar la aplicación](./GUIA_USO.md)
- [Estructura del código](./ESTRUCTURA.md)

#### Para Desarrolladores
- [Configurar un backend con Node.js](./docs/BACKEND_SETUP.md)
- [Conectar una base de datos](./docs/DATABASE.md)
- [Agregar nuevas funcionalidades](./docs/EXTENSION.md)

---

### 🛣️ Roadmap (Próximos Pasos)

**Fase 1 (Actual):**
- ✅ Frontend en JavaScript puro
- ✅ Deploy en GitHub Pages
- ✅ Backend Node.js de ejemplo

**Fase 2 (Próximo):**
- 🔄 Integración con base de datos (MongoDB o PostgreSQL)
- 🔄 Autenticación con JWT
- 🔄 Sistema de roles y permisos

**Fase 3 (Futuro):**
- 📱 Aplicación móvil (React Native)
- 📊 Dashboards avanzados
- 🔐 Autenticación de dos factores
- 💾 Backup automático a la nube

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

---

## 🤝 Contribuciones

¿Quieres mejorar este proyecto?

1. Fork el repositorio
2. Crea una rama (`git checkout -b feature/mi-mejora`)
3. Haz cambios y commit (`git commit -m "Agrego mejora"`)
4. Push a la rama (`git push origin feature/mi-mejora`)
5. Abre un Pull Request

---

## 📞 Soporte

- **Reportar bugs**: [GitHub Issues](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/issues)
- **Sugerir mejoras**: [GitHub Discussions](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/discussions)
- **Contacto**: cordova0092@gmail.com

---

## 📄 Licencia

Este proyecto está bajo la licencia **MIT**. Puedes usarlo libremente en proyectos personales y comerciales.

---

## 👨‍💻 Autor

**Equipo de Sistemas El Descubridor**
- GitHub: [@dorelly199475-web](https://github.com/dorelly199475-web)
- Año: 2025-2026

---

**⭐ Si te gusta este proyecto, dale una estrella en GitHub para mostrar tu apoyo!**
