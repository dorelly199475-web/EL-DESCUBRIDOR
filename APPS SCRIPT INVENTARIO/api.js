/* ==================================================
   API CLIENT - Comunicación con servidor
   ================================================== */

class APIClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  /**
   * Realiza una solicitud GET
   */
  async get(endpoint) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error en GET:', error);
      throw error;
    }
  }

  /**
   * Realiza una solicitud POST
   */
  async post(endpoint, data) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error en POST:', error);
      throw error;
    }
  }

  /**
   * Realiza una solicitud PUT
   */
  async put(endpoint, data) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error en PUT:', error);
      throw error;
    }
  }

  /**
   * Realiza una solicitud DELETE
   */
  async delete(endpoint) {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error en DELETE:', error);
      throw error;
    }
  }
}

// Instancia global del cliente API
const api = new APIClient();

/* ==================================================
   MODELOS DE DATOS
   ================================================== */

class Client {
  constructor(id, nombre, email, phone = null) {
    this.id = id;
    this.nombre = nombre;
    this.email = email;
    this.phone = phone;
  }

  static async getAll() {
    return api.get('/api/clients');
  }

  static async getById(id) {
    return api.get(`/api/clients/${id}`);
  }

  async save() {
    if (this.id) {
      return api.put(`/api/clients/${this.id}`, this);
    } else {
      return api.post('/api/clients', this);
    }
  }

  async delete() {
    return api.delete(`/api/clients/${this.id}`);
  }
}

class Item {
  constructor(id, nombre, codigo, precio, stock = 0) {
    this.id = id;
    this.nombre = nombre;
    this.codigo = codigo;
    this.precio = precio;
    this.stock = stock;
  }

  static async getAll() {
    return api.get('/api/items');
  }

  static async getById(id) {
    return api.get(`/api/items/${id}`);
  }

  async save() {
    if (this.id) {
      return api.put(`/api/items/${this.id}`, this);
    } else {
      return api.post('/api/items', this);
    }
  }

  async delete() {
    return api.delete(`/api/items/${this.id}`);
  }
}

class Sale {
  constructor(id, clientId, items = [], total = 0, date = null) {
    this.id = id;
    this.clientId = clientId;
    this.items = items;
    this.total = total;
    this.date = date || new Date();
  }

  static async getAll() {
    return api.get('/api/sales');
  }

  static async getById(id) {
    return api.get(`/api/sales/${id}`);
  }

  async save() {
    if (this.id) {
      return api.put(`/api/sales/${this.id}`, this);
    } else {
      return api.post('/api/sales', this);
    }
  }

  async delete() {
    return api.delete(`/api/sales/${this.id}`);
  }
}

/* ==================================================
   UTILIDADES
   ================================================== */

class Utils {
  /**
   * Formatea una fecha
   */
  static formatDate(date) {
    return new Intl.DateTimeFormat('es-ES').format(date);
  }

  /**
   * Formatea moneda
   */
  static formatCurrency(amount) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP'
    }).format(amount);
  }

  /**
   * Genera un ID único
   */
  static generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Muestra notificación
   */
  static showNotification(title, message, icon = 'info') {
    Swal.fire({
      icon: icon,
      title: title,
      text: message,
      timer: 3000
    });
  }
}
