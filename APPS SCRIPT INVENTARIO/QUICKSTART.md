# ⚡ Inicio Rápido

¡Bienvenido! Aquí está todo lo que necesitas para empezar a usar **El Descubridor** en 5 minutos.

---

## 🌐 Opción 1: Online (Más Fácil) ⭐

**Abre directamente en tu navegador:**

### https://dorelly199475-web.github.io/EL-DESCUBRIDOR/

✅ Sin instalación
✅ Acceso inmediato
✅ Funciona en móviles
✅ Datos guardados localmente

**Eso es todo. Ya puedes empezar a usar la app.**

---

## 💻 Opción 2: En Tu Computadora (Desarrollo)

### Paso 1: Descargar Código
```bash
git clone https://github.com/dorelly199475-web/EL-DESCUBRIDOR.git
cd EL-DESCUBRIDOR
```

### Paso 2: Ejecutar Localmente

**Con Python (si lo tienes):**
```bash
python -m http.server 8000
```

**O con Node.js:**
```bash
npm install
npm start
```

### Paso 3: Abre en tu Navegador
```
http://localhost:8000
o
http://localhost:3000
```

---

## 🔐 Acceso

**Usuario de prueba:**
```
Usuario: admin
Contraseña: demo123
```

---

## 📱 Funcionalidades Principales

### 👥 Gestión de Clientes
- Crear estudiantes
- Guardar información de acudientes
- Buscar clientes rápidamente

### 📦 Inventario
- Registrar nuevos artículos
- Gestionar stock de uniformes
- Ver disponibilidad en tiempo real

### 💰 Ventas
- Vender uniformes
- Sistema de carrito de compras
- Múltiples formas de pago

### 📊 Reportes
- Cierre diario de caja
- Reportes por usuario
- Historial de devoluciones

### 🔄 Devoluciones
- Registrar devoluciones
- Ajustar inventario
- Consultar historial

---

## 🎓 Tutoriales Básicos

### Crear un Cliente Nuevo
1. Ve a **Gestión Clientes**
2. Haz clic en **Nuevo Cliente**
3. Completa los datos del estudiante y acudientes
4. Haz clic en **Guardar**

### Registrar un Artículo
1. Ve a **Gestión Artículos**
2. Completa el formulario con:
   - Nombre del artículo
   - Talla
   - Precio de costo
   - Precio de venta
   - Stock inicial
3. Haz clic en **Guardar Artículo**

### Realizar una Venta
1. Ve a **Ventas Uniformes**
2. Selecciona el cliente (o Consumidor Final)
3. Selecciona el artículo
4. Escribe la cantidad
5. Haz clic en **Colocar en el Carro de Compra**
6. Cuando termines, haz clic en **PROCESAR PAGO**

### Hacer Cierre de Caja
1. Ve a **Cierre de Caja**
2. Selecciona la fecha y el usuario
3. Haz clic en **Generar Cierre de Caja**
4. Descarga el PDF con los reportes

---

## ⚙️ Configuración Avanzada

### Conectar a un Backend (Base de Datos Real)

Si quieres guardar datos en un servidor:

```bash
cd APPS SCRIPT INVENTARIO
npm install express cors body-parser
node server.example.js
```

Luego edita `api.js`:
```javascript
const api = new APIClient('http://localhost:3000');
```

👉 [Ver guía completa de backend →](./BACKEND_SETUP.md)

### Hacer Deploy en Internet

Sube tu código a:
- **Vercel** (muy fácil)
- **Netlify** (arrastra y suelta)
- **GitHub Pages** (ya está configurado)
- **Tu propio servidor**

---

## 🐛 Problemas Comunes

### "Me muestra pantalla en blanco"
- Verifica que estés en la URL correcta
- Recarga la página (F5)
- Borra el caché (Ctrl+Shift+Del)

### "No me deja hacer login"
- Verifica usuario y contraseña
- Datos por defecto: `admin` / `demo123`

### "Los datos se perdieron"
- Los datos se guardan en el navegador (localStorage)
- Si limpias el caché, se pierden
- Para datos permanentes, necesitas un backend con BD

### "¿Cómo cambio los colores?"
- Edita `styles.css`
- Busca las variables CSS al inicio:
```css
:root {
  --primary-color: #2c3e50;
  --accent-color: #3498db;
  /* ... más colores ... */
}
```

---

## 📚 Documentación Completa

- **[README Detallado →](./README.md)**
- **[Guía de Backend →](./BACKEND_SETUP.md)**
- **[Archivo Original Google Apps Script →](./Código.gs)**

---

## 🆘 Necesito Ayuda

### Preguntas Frecuentes
- Ver [Issues en GitHub](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/issues)
- Crear una nueva [Discussion](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/discussions)

### Reportar un Bug
Si encuentras un error:
1. Abre [GitHub Issues](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/issues)
2. Describe el problema
3. Incluye captura de pantalla si es posible

### Contacto
📧 **Email:** cordova0092@gmail.com

---

## 🚀 Próximos Pasos

Después de familiarizarte con lo básico:

1. ✅ Crea varios clientes y artículos
2. ✅ Prueba el sistema de ventas
3. ✅ Genera un cierre de caja
4. ✅ Si necesitas datos permanentes → Configura un [Backend →](./BACKEND_SETUP.md)
5. ✅ ¡Comparte tus comentarios!

---

## 🎉 ¡Listo para Empezar!

**[Abre la aplicación aquí →](https://dorelly199475-web.github.io/EL-DESCUBRIDOR/)**

O si estás desarrollando localmente:
```bash
npm start
# Luego abre http://localhost:3000
```

**¡Que disfrutes usando El Descubridor!** 🎓📚
