/**
 * SERVIDOR BACKEND EJEMPLO - server.js
 * 
 * Este es un ejemplo de servidor Node.js que puede servir como backend
 * para la aplicación El Descubridor.
 * 
 * Instalación:
 *   npm install express cors body-parser
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

// Base de datos simulada (En producción usar MongoDB, PostgreSQL, etc.)
const db = {
  clientes: [
    {
      id: 1,
      nombre: 'Cliente Ejemplo',
      email: 'cliente@example.com',
      phone: '3001234567'
    }
  ],
  items: [
    {
      id: 1,
      nombre: 'Uniforme Escolar',
      codigo: 'UNI001',
      precio: 50000,
      stock: 10
    }
  ],
  sales: []
};

// ============================================
// RUTAS DE CLIENTES
// ============================================

app.get('/api/clients', (req, res) => {
  res.json({ success: true, data: db.clientes });
});

app.get('/api/clients/:id', (req, res) => {
  const cliente = db.clientes.find(c => c.id == req.params.id);
  if (cliente) {
    res.json({ success: true, data: cliente });
  } else {
    res.status(404).json({ success: false, message: 'Cliente no encontrado' });
  }
});

app.post('/api/clients', (req, res) => {
  const nuevoCliente = {
    id: Math.max(...db.clientes.map(c => c.id), 0) + 1,
    ...req.body
  };
  db.clientes.push(nuevoCliente);
  res.status(201).json({ success: true, data: nuevoCliente });
});

app.put('/api/clients/:id', (req, res) => {
  const idx = db.clientes.findIndex(c => c.id == req.params.id);
  if (idx !== -1) {
    db.clientes[idx] = { ...db.clientes[idx], ...req.body };
    res.json({ success: true, data: db.clientes[idx] });
  } else {
    res.status(404).json({ success: false, message: 'Cliente no encontrado' });
  }
});

app.delete('/api/clients/:id', (req, res) => {
  const idx = db.clientes.findIndex(c => c.id == req.params.id);
  if (idx !== -1) {
    const cliente = db.clientes.splice(idx, 1);
    res.json({ success: true, data: cliente[0] });
  } else {
    res.status(404).json({ success: false, message: 'Cliente no encontrado' });
  }
});

// ============================================
// RUTAS DE ARTÍCULOS
// ============================================

app.get('/api/items', (req, res) => {
  res.json({ success: true, data: db.items });
});

app.get('/api/items/:id', (req, res) => {
  const item = db.items.find(i => i.id == req.params.id);
  if (item) {
    res.json({ success: true, data: item });
  } else {
    res.status(404).json({ success: false, message: 'Artículo no encontrado' });
  }
});

app.post('/api/items', (req, res) => {
  const nuevoItem = {
    id: Math.max(...db.items.map(i => i.id), 0) + 1,
    ...req.body
  };
  db.items.push(nuevoItem);
  res.status(201).json({ success: true, data: nuevoItem });
});

app.put('/api/items/:id', (req, res) => {
  const idx = db.items.findIndex(i => i.id == req.params.id);
  if (idx !== -1) {
    db.items[idx] = { ...db.items[idx], ...req.body };
    res.json({ success: true, data: db.items[idx] });
  } else {
    res.status(404).json({ success: false, message: 'Artículo no encontrado' });
  }
});

app.delete('/api/items/:id', (req, res) => {
  const idx = db.items.findIndex(i => i.id == req.params.id);
  if (idx !== -1) {
    const item = db.items.splice(idx, 1);
    res.json({ success: true, data: item[0] });
  } else {
    res.status(404).json({ success: false, message: 'Artículo no encontrado' });
  }
});

// ============================================
// RUTAS DE VENTAS
// ============================================

app.get('/api/sales', (req, res) => {
  res.json({ success: true, data: db.sales });
});

app.post('/api/sales', (req, res) => {
  const nuevaVenta = {
    id: Math.max(...db.sales.map(s => s.id || 0), 0) + 1,
    fecha: new Date(),
    ...req.body
  };
  db.sales.push(nuevaVenta);
  res.status(201).json({ success: true, data: nuevaVenta });
});

// ============================================
// RUTAS DE UTILIDAD
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Servidor funcionando correctamente',
    timestamp: new Date(),
    clientes: db.clientes.length,
    articulos: db.items.length,
    ventas: db.sales.length
  });
});

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📊 Dashboard en http://localhost:${PORT}/api/health`);
});
