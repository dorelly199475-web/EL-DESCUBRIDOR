# 🔧 Guía de Instalación del Backend

## Requisitos Previos

- **Node.js 14+** - Descarga desde [nodejs.org](https://nodejs.org)
- **npm** - Se instala automáticamente con Node.js
- **Git** - Para clonar el repositorio

---

## Instalación Rápida

### 1️⃣ Clonar el Repositorio
```bash
git clone https://github.com/dorelly199475-web/EL-DESCUBRIDOR.git
cd EL-DESCUBRIDOR
```

### 2️⃣ Instalar Dependencias
```bash
npm install
```

### 3️⃣ Iniciar el Servidor
```bash
npm start
# o
node server.example.js
```

El servidor estará disponible en: **http://localhost:3000**

---

## Verificar que el Servidor Funciona

### Health Check
```bash
curl http://localhost:3000/api/health
```

Deberías recibir:
```json
{
  "success": true,
  "status": "OK",
  "clientes": 1,
  "articulos": 1,
  "ventas": 0
}
```

---

## Credenciales de Prueba

```
Usuario: admin
Contraseña: demo123
Token: demo-token-123
```

---

## Endpoints Disponibles

### Autenticación
```
POST   /api/auth/login        → Iniciar sesión
GET    /api/auth/verify       → Verificar token
GET    /api/health            → Health check
```

### Clientes
```
GET    /api/clients           → Obtener todos
POST   /api/clients           → Crear nuevo
GET    /api/clients/:id       → Obtener uno
PUT    /api/clients/:id       → Actualizar
DELETE /api/clients/:id       → Eliminar
```

### Artículos/Inventario
```
GET    /api/items             → Obtener todos
POST   /api/items             → Crear nuevo
GET    /api/items/:id         → Obtener uno
PUT    /api/items/:id         → Actualizar
DELETE /api/items/:id         → Eliminar
```

### Ventas
```
GET    /api/sales             → Obtener todas
POST   /api/sales             → Registrar venta
GET    /api/reports/diario    → Reporte diario
GET    /api/reports/inventario → Reporte inventario
```

---

## Usando el Backend con la Aplicación Web

### 1. Actualizar la URL en `api.js`

Abre `api.js` y cambia:

```javascript
// Línea 7
const api = new APIClient('http://localhost:3000');
```

### 2. Usar el Token

Todos los requests (excepto login) necesitan incluir el token:

```javascript
// En api.js
async post(endpoint, data) {
  const response = await fetch(`${this.baseURL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer demo-token-123'  // ← Agregar esto
    },
    body: JSON.stringify(data)
  });
  // ...
}
```

### 3. Probar con Postman

Si tienes Postman instalado:

1. **Abre Postman**
2. **POST request** a `http://localhost:3000/api/auth/login`
3. **Headers:**
   ```
   Content-Type: application/json
   ```
4. **Body (JSON):**
   ```json
   {
     "usuario": "admin",
     "password": "demo123"
   }
   ```
5. Haz clic en **Send**

Deberías recibir un token para usar en otros requests.

---

## Próximos Pasos

### Integración con Base de Datos Real

El servidor actual usa una base de datos en memoria. Para producción:

#### Opción 1: MongoDB (Recomendado)
```bash
npm install mongoose
```

Edita `server.example.js`:
```javascript
const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://usuario:contraseña@cluster.mongodb.net/eldescubridor');

// Define tus esquemas y modelos
const clienteSchema = new mongoose.Schema({
  nombre: String,
  ciclo: String,
  email: String,
  createdAt: { type: Date, default: Date.now }
});

const Cliente = mongoose.model('Cliente', clienteSchema);
```

#### Opción 2: PostgreSQL
```bash
npm install pg
```

#### Opción 3: Firebase (Google)
```bash
npm install firebase-admin
```

---

## Variables de Entorno

Crea un archivo `.env`:

```
PORT=3000
NODE_ENV=development
DATABASE_URL=mongodb+srv://...
JWT_SECRET=tu_secreto_muy_seguro_aqui
```

Luego en `server.example.js`:
```javascript
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
```

---

## Deploy en Producción

### Opción 1: Heroku

```bash
# 1. Instalar Heroku CLI
# 2. Iniciar sesión
heroku login

# 3. Crear app
heroku create el-descubridor

# 4. Subir código
git push heroku main

# 5. Ver logs
heroku logs --tail
```

### Opción 2: DigitalOcean

1. Crear un droplet Ubuntu
2. Instalar Node.js
3. Clonar el repositorio
4. Instalar PM2 para management
5. Configurar nginx como reverse proxy

### Opción 3: AWS (Elastic Beanstalk)

```bash
npm install -g eb

eb init
eb create el-descubridor-env
eb deploy
```

---

## Troubleshooting

### Error: "Port already in use"
```bash
# Encontrar qué usa el puerto 3000
lsof -i :3000

# O cambiar el puerto
PORT=4000 npm start
```

### Error: "CORS blocked"
Verifica que `cors()` esté habilitado en `server.example.js`:
```javascript
const cors = require('cors');
app.use(cors());
```

### Error: "Token inválido"
Usa el token correcto:
```
demo-token-123
```

### Error de conexión a base de datos
Verifica la variable `DATABASE_URL` en `.env`

---

## Monitoreo en Desarrollo

Instala Nodemon para reiniciar automáticamente:

```bash
npm install -D nodemon

# En package.json
"scripts": {
  "dev": "nodemon server.example.js"
}

# Ejecuta
npm run dev
```

---

## ¿Necesitas ayuda?

- 📧 Email: cordova0092@gmail.com
- 🐛 Issues: [GitHub Issues](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/dorelly199475-web/EL-DESCUBRIDOR/discussions)
