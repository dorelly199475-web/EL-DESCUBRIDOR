/**
 * SERVIDOR BACKEND - server.js
 * 
 * Sistema de gestión de inventario El Descubridor
 * Backend completo con autenticación y CRUD
 * 
 * Instalación:
 *   npm install express cors body-parser dotenv
 * 
 * Uso:
 *   node server.js
 * 
 * El servidor escuchará en http://localhost:3000
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============================================
// BASE DE DATOS SIMULADA (Usar MongoDB/PostgreSQL en producción)
// ============================================
const db = {
  usuarios: [
    {
      id: 1,
      nombre: 'Admin',
      usuario: 'admin',
      correo: 'admin@eldescubridor.com',
      rol: 'admin'
    }
  ],
  clientes: [
    {
      id: 1,
      codigo: 'EST001',
      nombre: 'Juan Pérez',
      email: 'juan@example.com',
      ciclo: 'Primero',
      phone: '3001234567'
    }
  ],
  items: [
    {
      id: 1,
      nombre: 'Uniforme Escolar',
      codigo: 'UNI001',
      talla: 'M',
      precio_costo: 30000,
      precio_venta: 50000,
      stock: 10,
      imagen: ''
    }
  ],
  ventas: [],
  transacciones: []
};

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN SIMPLE
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }
  
  // Verificación simple (En producción usar JWT)
  if (token === 'demo-token-123') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Token inválido' });
  }
};

// ============================================
// RUTAS PÚBLICAS - AUTENTICACIÓN
// ============================================

app.post('/api/auth/login', (req, res) => {
  const { usuario, password } = req.body;
  
  const user = db.usuarios.find(u => u.usuario === usuario);
  
  if (user && password === 'demo123') {
    res.json({
      success: true,
      message: 'Login exitoso',
      user: {
        id: user.id,
        nombre: user.nombre,
        correo: user.correo,
        rol: user.rol
      },
      token: 'demo-token-123'
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Usuario o contraseña inválidos'
    });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Token válido' });
});

// ============================================
// RUTAS PROTEGIDAS - CLIENTES
// ============================================

app.get('/api/clients', authenticateToken, (req, res) => {
  res.json({ success: true, data: db.clientes });
});

app.get('/api/clients/:id', authenticateToken, (req, res) => {
  const cliente = db.clientes.find(c => c.id == req.params.id);
  if (cliente) {
    res.json({ success: true, data: cliente });
  } else {
    res.status(404).json({ success: false, message: 'Cliente no encontrado' });
  }
});

app.post('/api/clients', authenticateToken, (req, res) => {
  const nuevoCliente = {
    id: Math.max(...db.clientes.map(c => c.id || 0), 0) + 1,
    ...req.body,
    fecha_creacion: new Date()
  };
  
  if (!req.body.nombre || !req.body.ciclo) {
    return res.status(400).json({ 
      success: false, 
      message: 'Nombre y ciclo son obligatorios' 
    });
  }
  
  db.clientes.push(nuevoCliente);
  res.status(201).json({ 
    success: true, 
    message: 'Cliente creado',
    data: nuevoCliente 
  });
});

app.put('/api/clients/:id', authenticateToken, (req, res) => {
  const idx = db.clientes.findIndex(c => c.id == req.params.id);
  if (idx !== -1) {
    db.clientes[idx] = { ...db.clientes[idx], ...req.body };
    res.json({ 
      success: true, 
      message: 'Cliente actualizado',
      data: db.clientes[idx] 
    });
  } else {
    res.status(404).json({ success: false, message: 'Cliente no encontrado' });
  }
});

app.delete('/api/clients/:id', authenticateToken, (req, res) => {
  const idx = db.clientes.findIndex(c => c.id == req.params.id);
  if (idx !== -1) {
    const cliente = db.clientes.splice(idx, 1);
    res.json({ 
      success: true, 
      message: 'Cliente eliminado',
      data: cliente[0] 
    });
  } else {
    res.status(404).json({ success: false, message: 'Cliente no encontrado' });
  }
});

// ============================================
// RUTAS PROTEGIDAS - ARTÍCULOS
// ============================================

app.get('/api/items', authenticateToken, (req, res) => {
  res.json({ success: true, data: db.items });
});

app.get('/api/items/:id', authenticateToken, (req, res) => {
  const item = db.items.find(i => i.id == req.params.id);
  if (item) {
    res.json({ success: true, data: item });
  } else {
    res.status(404).json({ success: false, message: 'Artículo no encontrado' });
  }
});

app.post('/api/items', authenticateToken, (req, res) => {
  const nuevoItem = {
    id: Math.max(...db.items.map(i => i.id || 0), 0) + 1,
    ...req.body,
    fecha_creacion: new Date()
  };
  
  if (!req.body.nombre || !req.body.precio_venta) {
    return res.status(400).json({ 
      success: false, 
      message: 'Nombre y precio de venta son obligatorios' 
    });
  }
  
  db.items.push(nuevoItem);
  res.status(201).json({ 
    success: true, 
    message: 'Artículo creado',
    data: nuevoItem 
  });
});

app.put('/api/items/:id', authenticateToken, (req, res) => {
  const idx = db.items.findIndex(i => i.id == req.params.id);
  if (idx !== -1) {
    db.items[idx] = { ...db.items[idx], ...req.body };
    res.json({ 
      success: true, 
      message: 'Artículo actualizado',
      data: db.items[idx] 
    });
  } else {
    res.status(404).json({ success: false, message: 'Artículo no encontrado' });
  }
});

app.delete('/api/items/:id', authenticateToken, (req, res) => {
  const idx = db.items.findIndex(i => i.id == req.params.id);
  if (idx !== -1) {
    const item = db.items.splice(idx, 1);
    res.json({ 
      success: true, 
      message: 'Artículo eliminado',
      data: item[0] 
    });
  } else {
    res.status(404).json({ success: false, message: 'Artículo no encontrado' });
  }
});

// ============================================
// RUTAS PROTEGIDAS - VENTAS
// ============================================

app.get('/api/sales', authenticateToken, (req, res) => {
  res.json({ success: true, data: db.ventas });
});

app.post('/api/sales', authenticateToken, (req, res) => {
  const nuevaVenta = {
    id: Math.max(...db.ventas.map(s => s.id || 0), 0) + 1,
    fecha: new Date(),
    usuario: req.body.usuario || 'Sistema',
    ...req.body
  };
  
  if (!req.body.cliente_id || !req.body.items || req.body.items.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Cliente e items son obligatorios' 
    });
  }
  
  // Actualizar stock
  req.body.items.forEach(item => {
    const articuloIdx = db.items.findIndex(a => a.id === item.item_id);
    if (articuloIdx !== -1) {
      db.items[articuloIdx].stock -= item.cantidad;
    }
  });
  
  db.ventas.push(nuevaVenta);
  
  res.status(201).json({ 
    success: true, 
    message: 'Venta registrada',
    data: nuevaVenta 
  });
});

// ============================================
// RUTAS PROTEGIDAS - REPORTES
// ============================================

app.get('/api/reports/diario', authenticateToken, (req, res) => {
  const hoy = new Date().toDateString();
  const ventasHoy = db.ventas.filter(v => 
    new Date(v.fecha).toDateString() === hoy
  );
  
  const totalVentas = ventasHoy.reduce((sum, v) => sum + (v.total || 0), 0);
  
  res.json({ 
    success: true, 
    data: {
      fecha: hoy,
      cantidad_ventas: ventasHoy.length,
      total: totalVentas,
      ventas: ventasHoy
    }
  });
});

app.get('/api/reports/inventario', authenticateToken, (req, res) => {
  const bajo_stock = db.items.filter(i => i.stock <= 5);
  
  res.json({ 
    success: true, 
    data: {
      total_articulos: db.items.length,
      stock_bajo: bajo_stock.length,
      articulos_bajo_stock: bajo_stock,
      valor_inventario: db.items.reduce((sum, i) => 
        sum + (i.precio_costo * i.stock), 0
      )
    }
  });
});

// ============================================
// RUTAS DE UTILIDAD
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Servidor funcionando correctamente',
    status: 'OK',
    timestamp: new Date(),
    estadisticas: {
      usuarios: db.usuarios.length,
      clientes: db.clientes.length,
      articulos: db.items.length,
      ventas: db.ventas.length,
      usuario_demo: {
        usuario: 'admin',
        password: 'demo123',
        token: 'demo-token-123'
      }
    }
  });
});

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Ruta no encontrada',
    path: req.originalUrl 
  });
});

// Manejo global de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor',
    error: err.message 
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║         🚀 SERVIDOR EL DESCUBRIDOR INICIADO                   ║
╚════════════════════════════════════════════════════════════════╝

📍 URL: http://localhost:${PORT}
🏥 Health Check: http://localhost:${PORT}/api/health

🔐 CREDENCIALES DE PRUEBA:
   Usuario: admin
   Password: demo123
   Token: demo-token-123

📊 ENDPOINTS DISPONIBLES:
   POST   /api/auth/login        (Login)
   GET    /api/auth/verify       (Verificar token)
   
   GET    /api/clients           (Listar clientes)
   POST   /api/clients           (Crear cliente)
   GET    /api/clients/:id       (Obtener cliente)
   PUT    /api/clients/:id       (Actualizar cliente)
   DELETE /api/clients/:id       (Eliminar cliente)
   
   GET    /api/items             (Listar artículos)
   POST   /api/items             (Crear artículo)
   GET    /api/items/:id         (Obtener artículo)
   PUT    /api/items/:id         (Actualizar artículo)
   DELETE /api/items/:id         (Eliminar artículo)
   
   GET    /api/sales             (Listar ventas)
   POST   /api/sales             (Registrar venta)
   
   GET    /api/reports/diario    (Reporte diario)
   GET    /api/reports/inventario (Reporte inventario)

⚠️  NOTA: Este es un servidor de demostración.
    Para producción:
    - Usar base de datos real (MongoDB, PostgreSQL)
    - Implementar JWT para autenticación
    - Agregar validaciones más robustas
    - Configurar HTTPS

🛑 Presiona Ctrl+C para detener el servidor
  `);
});

