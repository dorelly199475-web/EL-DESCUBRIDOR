/* ===================================================
   CONFIGURACIÓN DE LA BASE DE DATOS
   =================================================== */
// Pega aquí la URL de tu implementación de Google Apps Script (Web App)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby6acTXKWlKu7tmvlsjPVe_qsSG3ybievXhxpJVoT2LqqIaPZamijnfHMlUKRofefA0/exec"; 

/* ===================================================
   COMPATIBILITY SHIM FOR google.script.run
   =================================================== */
class GoogleScriptRun {
  constructor() {
    this._success = () => { };
    this._failure = (err) => console.error(err);
  }
  withSuccessHandler(handler) {
    this._success = handler;
    return this;
  }
  withFailureHandler(handler) {
    this._failure = handler;
    return this;
  }
}

const googleScriptRunProxyHandler = {
  get(target, prop) {
    if (prop === 'withSuccessHandler') {
      return function (handler) {
        target._success = handler;
        return new Proxy(target, googleScriptRunProxyHandler);
      };
    }
    if (prop === 'withFailureHandler') {
      return function (handler) {
        target._failure = handler;
        return new Proxy(target, googleScriptRunProxyHandler);
      };
    }

    return function (...args) {
      const successHandler = target._success;
      const failureHandler = target._failure;

      target._success = () => { };
      target._failure = (err) => console.error(err);

      fetch(GOOGLE_SCRIPT_URL || '/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ functionName: prop, args: args })
      })
        .then(res => {
          if (!res.ok) {
            return res.json().then(e => { throw new Error(e.message || 'Error del servidor'); });
          }
          return res.json();
        })
        .then(result => {
          if (result && result.isHtmlPdf) {
            Swal.fire({
              title: 'Generando PDF...',
              text: 'Por favor espere un momento',
              allowOutsideClick: false,
              didOpen: () => { Swal.showLoading(); }
            });

            const element = document.createElement('div');
            element.innerHTML = result.html;
            // Apply some print styling styles in the hidden element
            element.style.position = 'absolute';
            element.style.left = '-9999px';
            document.body.appendChild(element);

            const opt = {
              margin: result.options?.margin || 5,
              filename: result.fileName || 'documento.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true },
              jsPDF: result.options?.jsPDF || { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            html2pdf().from(element).set(opt).output('blob').then(blob => {
              document.body.removeChild(element);
              Swal.close();

              const reader = new FileReader();
              reader.readAsDataURL(blob);
              reader.onloadend = function () {
                const base64data = reader.result.split(',')[1];
                successHandler({
                  success: true,
                  pdfBase64: base64data,
                  fileName: result.fileName
                });
              };
            }).catch(err => {
              if (document.body.contains(element)) {
                document.body.removeChild(element);
              }
              Swal.close();
              failureHandler(err);
            });
          } else {
            successHandler(result);
          }
        })
        .catch(err => {
          failureHandler(err);
        });
    };
  }
};

const google = {
  script: {
    get run() {
      return new Proxy(new GoogleScriptRun(), googleScriptRunProxyHandler);
    }
  }
};
window.google = google;

/* ===================================================
   VARIABLES GLOBALES Y CACHÉ
   =================================================== */
var cache = {
  clientes: null,
  articulos: null,
  usuarios: null,
  timestamp: {
    clientes: null,
    articulos: null,
    usuarios: null
  },
  loaded: {
    clientes: false,
    articulos: false,
    usuarios: false,
    config: false
  }
};

var globalArticles = [];
var globalClients = [];
var globalUsuarios = [];
var cart = [];
var cartMisc = [];
var currentUser = null;
var currentClientFixed = null;
var CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Variables para el cierre de caja
var cierreFechaActual = '';
var cierreUsuarioActual = '';

/* ===================================================
   LOGIN Y AUTENTICACIÓN
   =================================================== */
function togglePasswordVisibility() {
  var passwordInput = document.getElementById('login-password');
  var toggleIcon = document.querySelector('.toggle-password');

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    toggleIcon.innerText = 'visibility';
  } else {
    passwordInput.type = 'password';
    toggleIcon.innerText = 'visibility_off';
  }
}

/* ===================================================
   INICIALIZACIÓN DE SELECT2 (BÚSQUEDA INTELIGENTE)
   =================================================== */
function initializeSelect2() {
  // Destruir instancias anteriores si existen
  if ($('#purchase-item-select').hasClass('select2-hidden-accessible')) {
    $('#purchase-item-select').select2('destroy');
  }
  if ($('#sale-client-select').hasClass('select2-hidden-accessible')) {
    $('#sale-client-select').select2('destroy');
  }
  if ($('#sale-item-select').hasClass('select2-hidden-accessible')) {
    $('#sale-item-select').select2('destroy');
  }
  if ($('#misc-item-select').hasClass('select2-hidden-accessible')) {
    $('#misc-item-select').select2('destroy');
  }

  // Inicializar Select2 en selector de artículos de compras
  $('#purchase-item-select').select2({
    placeholder: 'Buscar artículo...',
    allowClear: true,
    language: {
      noResults: function () {
        return "No se encontraron resultados";
      },
      searching: function () {
        return "Buscando...";
      }
    }
  }).on('change', function () {
    updatePurchaseCost();
  });

  // Inicializar Select2 en selector de clientes de ventas
  $('#sale-client-select').select2({
    placeholder: 'Buscar cliente...',
    allowClear: true,
    language: {
      noResults: function () {
        return "No se encontraron resultados";
      },
      searching: function () {
        return "Buscando...";
      }
    }
  });

  // Inicializar Select2 en selector de artículos de ventas
  $('#sale-item-select').select2({
    placeholder: 'Buscar artículo...',
    allowClear: true,
    language: {
      noResults: function () {
        return "No se encontraron resultados";
      },
      searching: function () {
        return "Buscando...";
      }
    }
  }).on('change', function () {
    updateSalePrice();
  });

  // Inicializar Select2 en selector de artículos de miscelánea
  $('#misc-item-select').select2({
    placeholder: 'Buscar artículo...',
    allowClear: true,
    language: {
      noResults: function () {
        return "No se encontraron resultados";
      },
      searching: function () {
        return "Buscando...";
      }
    }
  }).on('change', function () {
    updateMiscPrice();
  });

  console.log('✅ Select2 inicializado en todos los selectores');
}

function handleLogin(e) {
  e.preventDefault();
  var usuario = document.getElementById('login-usuario').value;
  var password = document.getElementById('login-password').value;

  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(handleLoginResponse)
    .withFailureHandler(handleError)
    .verificarLogin(usuario, password);
}

function handleLoginResponse(response) {
  hideGlobalSpinner();
  if (response.success) {
    currentUser = response.correo;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('sys-user-display').innerText = response.correo;
    document.getElementById('user-display-sidebar').innerText = response.nombre || response.correo;

    loadInitialData();
  } else {
    Swal.fire('Error', response.message, 'error');
  }
}

function handleLogout() {
  Swal.fire({
    title: '¿Cerrar sesión?',
    text: "Se perderá cualquier trabajo no guardado",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, cerrar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      google.script.run
        .withSuccessHandler(function () {
          location.reload();
        })
        .cerrarSesion();
    }
  });
}

/* ===================================================
   INICIALIZACIÓN
   =================================================== */
window.onload = function () {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';

  // Establecer fecha de hoy por defecto en el cierre
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('cierre-fecha').value = today;
};

function loadInitialData() {
  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(handleInitialData)
    .withFailureHandler(handleError)
    .getInitialData();
}

function handleInitialData(data) {
  hideGlobalSpinner();
  if (data.success) {
    document.getElementById('stat-clientes').innerText = data.clientesCount;
    document.getElementById('stat-articulos').innerText = data.articulosCount;
    document.getElementById('badge-clients').innerText = data.clientesCount;
    document.getElementById('badge-items').innerText = data.articulosCount;
    cache.loaded.config = true;

    loadUsuarios();
  } else if (data.needsLogin) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
  }
}

function handleError(error) {
  hideGlobalSpinner();
  console.error('Error:', error);
  Swal.fire('Error', 'Error al cargar datos: ' + error.message, 'error');
}

/* ===================================================
   NAVEGACIÓN
   =================================================== */
function navigate(id) {
  document.querySelectorAll('.section-view').forEach(el =>
    el.classList.remove('active-section')
  );
  document.querySelectorAll('.nav-links li').forEach(el =>
    el.classList.remove('active')
  );

  document.getElementById('view-' + id).classList.add('active-section');
  document.getElementById('btn-' + id).classList.add('active');

  switch (id) {
    case 'config':
      loadUsuarios();
      break;
    case 'clients':
      loadClientsIfNeeded();
      break;
    case 'items':
      loadArticlesIfNeeded();
      break;
    case 'purchases':
      loadArticlesIfNeeded();
      break;
    case 'sales':
      loadSalesData();
      break;
    case 'misc':
      loadMiscData();
      break;
    case 'reports':
      loadUsuariosForCierre();
      document.getElementById('cierre-resultado').style.display = 'none';
      break;


    case 'pendientes':
      loadPendientes();
      break;
    case 'entregas':
      loadEntregas();
      break;

    case 'devoluciones':
      loadVentasParaDevoluciones();
      break;
    case 'devoluciones-aplicadas':
      loadDevolucionesAplicadas();
      break;


  }
}

/* ===================================================
   GESTIÓN DE USUARIOS
   =================================================== */
function loadUsuarios() {
  google.script.run
    .withSuccessHandler(handleUsuariosData)
    .withFailureHandler(handleError)
    .getUsuarios();
}

function handleUsuariosData(response) {
  if (response.success) {
    globalUsuarios = response.data;
    renderUsuariosTable(response.data);
  }
}

function renderUsuariosTable(data) {
  var tbody = document.querySelector('#usuarios-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay usuarios registrados</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.forEach(function (u) {
    var row = document.createElement('tr');
    row.innerHTML = `
            <td>${u.ID_USUARIO || 'N/A'}</td>
            <td>${u.NOMBRE_USUARIO || ''}</td>
            <td>${u.USUARIO || ''}</td>
            <td>${u.CORREO || ''}</td>
            <td>
              <button class="btn-icon" onclick="editUsuario('${u.ID_USUARIO}')" title="Editar">
                <span class="material-icons">edit</span>
              </button>
            </td>
          `;
    tbody.appendChild(row);
  });
}

function showUsuarioModal(id) {
  var title = id ? 'Editar Usuario' : 'Nuevo Usuario';
  var usuario = id ? globalUsuarios.find(u => u.ID_USUARIO == id) : null;

  Swal.fire({
    title: title,
    html: `
            <input id="swal-nombre" class="swal2-input" placeholder="Nombre Completo" 
                   value="${usuario ? usuario.NOMBRE_USUARIO : ''}" required>
            <input id="swal-usuario" class="swal2-input" placeholder="Usuario" 
                   value="${usuario ? usuario.USUARIO : ''}" required>
            <input id="swal-correo" type="email" class="swal2-input" placeholder="Correo" 
                   value="${usuario ? usuario.CORREO : ''}" required>
            <input id="swal-password" type="password" class="swal2-input" 
                   placeholder="${id ? 'Contraseña (dejar en blanco para no cambiar)' : 'Contraseña'}" 
                   ${id ? '' : 'required'}>
          `,
    focusConfirm: false,
    showCancelButton: true,
    cancelButtonText: 'Cancelar',
    confirmButtonText: id ? 'Actualizar' : 'Guardar',
    preConfirm: () => {
      var nombre = document.getElementById('swal-nombre').value;
      var user = document.getElementById('swal-usuario').value;
      var correo = document.getElementById('swal-correo').value;
      var password = document.getElementById('swal-password').value;

      if (!nombre || !user || !correo || (!id && !password)) {
        Swal.showValidationMessage('Todos los campos son obligatorios');
        return false;
      }

      return {
        id: id,
        nombre: nombre,
        usuario: user,
        correo: correo,
        password: password
      };
    }
  }).then((result) => {
    if (result.isConfirmed) {
      showGlobalSpinner();
      var action = id ? 'updateUsuario' : 'saveUsuario';
      google.script.run
        .withSuccessHandler(function (res) {
          hideGlobalSpinner();
          if (res.success) {
            Swal.fire('Éxito', res.message, 'success');
            loadUsuarios();
          } else {
            Swal.fire('Error', res.message, 'error');
          }
        })
        .withFailureHandler(handleError)
      [action](result.value);
    }
  });
}

function editUsuario(id) {
  showUsuarioModal(id);
}

/* ===================================================
   MÓDULO CLIENTES
   =================================================== */
function loadClientsIfNeeded() {
  var now = Date.now();
  if (cache.clientes &&
    cache.timestamp.clientes &&
    (now - cache.timestamp.clientes < CACHE_DURATION)) {
    renderClientsTable(cache.clientes);
    return;
  }

  google.script.run
    .withSuccessHandler(handleClientsData)
    .withFailureHandler(handleError)
    .getClientes();
}

function handleClientsData(response) {
  if (response.success) {
    cache.clientes = response.data;
    cache.timestamp.clientes = Date.now();
    cache.loaded.clientes = true;
    globalClients = response.data;

    var select = document.getElementById('sale-client-select');
    if (select) {
      select.innerHTML = '<option value="">Consumidor Final</option>';

      response.data.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.CODIGO || c.ID_CLIENTE || '';
        opt.innerText = c.ESTUDIANTE || c.NOMBRE || 'Sin nombre';
        select.appendChild(opt);
      });

      initializeSelect2();
    }

    renderClientsTable(response.data);
  }
}

function renderClientsTable(data) {
  var tbody = document.querySelector('#clients-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay clientes registrados</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.forEach(function (c) {
    var row = document.createElement('tr');
    row.innerHTML = `
            <td>${c.CODIGO || 'N/A'}</td>
            <td>${c.ESTUDIANTE || ''}</td>
            <td>${c.CICLO || ''}</td>
            <td>${c.ACUDIENTE_1 || ''}</td>
            <td>${c.ACUDIENTE_2 || ''}</td>
            <td>
              <button class="btn-icon" onclick="editClient('${c.CODIGO}')" title="Editar">
                <span class="material-icons">edit</span>
              </button>
            </td>
          `;
    tbody.appendChild(row);
  });
}

function showClientModal(codigo) {
  var title = codigo ? 'Editar Cliente' : 'Nuevo Cliente';
  var isEdit = !!codigo;

  if (isEdit) {
    showGlobalSpinner();
    google.script.run
      .withSuccessHandler(function (response) {
        hideGlobalSpinner();
        if (response.success) {
          openClientFormModal(title, response.data, true);
        } else {
          Swal.fire('Error', response.message, 'error');
        }
      })
      .withFailureHandler(handleError)
      .getClienteById(codigo);
  } else {
    openClientFormModal(title, null, false);
  }
}

function openClientFormModal(title, cliente, isEdit) {
  Swal.fire({
    title: title,
    html: `
            <div style="max-height:500px; overflow-y:auto; text-align:left;">
              <div class="form-group">
                <label>Código</label>
                <input id="swal-codigo" class="swal2-input" placeholder="Código" 
                       value="${cliente ? cliente.CODIGO : ''}" ${isEdit ? 'readonly' : ''}>
              </div>
              <div class="form-group">
                <label>Estudiante *</label>
                <input id="swal-estudiante" class="swal2-input" placeholder="Nombre Estudiante" 
                       value="${cliente ? cliente.ESTUDIANTE : ''}" required>
              </div>
              <div class="form-group">
                <label>Grado</label>
                <input id="swal-grado" class="swal2-input" placeholder="Grado" 
                       value="${cliente ? cliente.GRADO : ''}">
              </div>
              <div class="form-group">
                <label>Ciclo *</label>
                <input id="swal-ciclo" class="swal2-input" placeholder="Ciclo" 
                       value="${cliente ? cliente.CICLO : ''}" required>
              </div>
              <hr>
              <h4>Acudiente 1</h4>
              <div class="form-group">
                <label>Nombre Acudiente 1 *</label>
                <input id="swal-acud1" class="swal2-input" placeholder="Nombre Acudiente 1" 
                       value="${cliente ? cliente.ACUDIENTE_1 : ''}" required>
              </div>
              <div class="form-group">
                <label>Cédula Acudiente 1</label>
                <input id="swal-ced1" class="swal2-input" placeholder="Cédula" 
                       value="${cliente ? cliente.CEDULA_ACUD_1 : ''}">
              </div>
              <div class="form-group">
                <label>Celular Acudiente 1</label>
                <input id="swal-cel1" class="swal2-input" placeholder="Celular" 
                       value="${cliente ? cliente.CELULAR_ACUD_1 : ''}">
              </div>
              <div class="form-group">
                <label>Dirección Acudiente 1</label>
                <input id="swal-dir1" class="swal2-input" placeholder="Dirección" 
                       value="${cliente ? cliente.DIRECCION_ACUD_1 : ''}">
              </div>
              <div class="form-group">
                <label>Correo Acudiente 1</label>
                <input id="swal-corr1" type="email" class="swal2-input" placeholder="Correo" 
                       value="${cliente ? cliente.CORREO_ACUD_1 : ''}">
              </div>
              <hr>
              <h4>Acudiente 2 (Opcional)</h4>
              <div class="form-group">
                <label>Nombre Acudiente 2</label>
                <input id="swal-acud2" class="swal2-input" placeholder="Nombre Acudiente 2" 
                       value="${cliente ? cliente.ACUDIENTE_2 : ''}">
              </div>
              <div class="form-group">
                <label>Cédula Acudiente 2</label>
                <input id="swal-ced2" class="swal2-input" placeholder="Cédula" 
                       value="${cliente ? cliente.CEDULA_ACUD_2 : ''}">
              </div>
              <div class="form-group">
                <label>Celular Acudiente 2</label>
                <input id="swal-cel2" class="swal2-input" placeholder="Celular" 
                       value="${cliente ? cliente.CELULAR_ACUD_2 : ''}">
              </div>
              <div class="form-group">
                <label>Dirección Acudiente 2</label>
                <input id="swal-dir2" class="swal2-input" placeholder="Dirección" 
                       value="${cliente ? cliente.DIRECCION_ACUD_2 : ''}">
              </div>
              <div class="form-group">
                <label>Correo Acudiente 2</label>
                <input id="swal-corr2" type="email" class="swal2-input" placeholder="Correo" 
                       value="${cliente ? cliente.CORREO_ACUD_2 : ''}">
              </div>
            </div>
          `,
    width: '600px',
    showCancelButton: true,
    cancelButtonText: 'Cancelar',
    confirmButtonText: isEdit ? 'Actualizar' : 'Guardar',
    preConfirm: () => {
      var estudiante = document.getElementById('swal-estudiante').value;
      var ciclo = document.getElementById('swal-ciclo').value;
      var acud1 = document.getElementById('swal-acud1').value;

      if (!estudiante || !ciclo || !acud1) {
        Swal.showValidationMessage('Estudiante, Ciclo y Acudiente 1 son obligatorios');
        return false;
      }

      return {
        codigo: document.getElementById('swal-codigo').value,
        estudiante: estudiante,
        grado: document.getElementById('swal-grado').value,
        ciclo: ciclo,
        acudiente1: acud1,
        cedula1: document.getElementById('swal-ced1').value,
        celular1: document.getElementById('swal-cel1').value,
        direccion1: document.getElementById('swal-dir1').value,
        correo1: document.getElementById('swal-corr1').value,
        acudiente2: document.getElementById('swal-acud2').value,
        cedula2: document.getElementById('swal-ced2').value,
        celular2: document.getElementById('swal-cel2').value,
        direccion2: document.getElementById('swal-dir2').value,
        correo2: document.getElementById('swal-corr2').value
      };
    }
  }).then((result) => {
    if (result.isConfirmed) {
      showGlobalSpinner();
      var action = isEdit ? 'updateCliente' : 'saveCliente';
      // CRÍTICO: Validar que tengamos usuario activo
      if (!currentUser) {
        Swal.fire('Error', 'No hay sesión activa. Por favor recargue la página.', 'error');
        return;
      }

      console.log('📤 CLIENTE - Enviando con usuario:', currentUser);

      google.script.run
        .withSuccessHandler(function (res) {
          hideGlobalSpinner();
          if (res.success) {
            Swal.fire('Éxito', res.message, 'success');
            invalidateCache('clientes');
            loadClientsIfNeeded();
          } else {
            Swal.fire('Error', res.message, 'error');
          }
        })
        .withFailureHandler(handleError)
      [action](result.value, currentUser); // ← CAMBIO CRÍTICO: PASAMOS currentUser 


    }
  });
}

function editClient(codigo) {
  showClientModal(codigo);
}

function filterClients() {
  var txt = document.getElementById('client-search').value.toLowerCase();
  if (!txt) {
    renderClientsTable(cache.clientes || globalClients);
    return;
  }

  var filtered = (cache.clientes || globalClients).filter(c =>
    String(c.CODIGO || '').toLowerCase().includes(txt) ||
    String(c.ESTUDIANTE || '').toLowerCase().includes(txt) ||
    String(c.CICLO || '').toLowerCase().includes(txt) ||
    String(c.ACUDIENTE_1 || '').toLowerCase().includes(txt)
  );
  renderClientsTable(filtered);
}

/* ===================================================
   MÓDULO ARTÍCULOS
   =================================================== */
function loadArticlesIfNeeded() {
  var now = Date.now();
  if (cache.articulos &&
    cache.timestamp.articulos &&
    (now - cache.timestamp.articulos < CACHE_DURATION)) {
    globalArticles = cache.articulos;
    populateSelects();
    renderItemsTable(cache.articulos);
    return;
  }

  google.script.run
    .withSuccessHandler(handleArticlesData)
    .withFailureHandler(handleError)
    .getArticulos();
}

function handleArticlesData(response) {
  if (response.success) {
    cache.articulos = response.data;
    cache.timestamp.articulos = Date.now();
    cache.loaded.articulos = true;
    globalArticles = response.data;

    populateSelects();
    renderItemsTable(response.data);
  }
}

function renderItemsTable(data) {
  var tbody = document.querySelector('#items-mini-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  data.forEach(function (a) {
    var row = document.createElement('tr');
    var stock = Number(a.CANTIDAD || 0);
    var stockClass = stock === 0 ? 'stock-zero' : (stock < 5 ? 'stock-low' : '');

    row.innerHTML = `
  <td>${a.ARTICULO || ''}</td>
  <td>${a.TALLA || ''}</td>
  <td class="${stockClass}">${stock}</td>
  <td style="color: #e74c3c; font-weight: 600;">$${Number(a.PRECIO_COSTO || 0).toLocaleString()}</td>
  <td style="color: #27ae60; font-weight: 600;">$${Number(a.PRECIO_VENTA || 0).toLocaleString()}</td>
`;


    tbody.appendChild(row);
  });
}

function populateSelects() {
  if (globalArticles.length === 0) {
    return;
  }

  var uniqueNames = [...new Set(globalArticles.map(a => String(a.ARTICULO || '').trim()))].filter(n => n !== '');

  var opts = '<option value="">Seleccione...</option>' +
    uniqueNames.map(n => `<option value="${n}">${n}</option>`).join('');

  document.getElementById('purchase-item-select').innerHTML = opts;
  document.getElementById('sale-item-select').innerHTML = opts;
  document.getElementById('misc-item-select').innerHTML = opts;

  initializeSelect2();
}

function handleSaveItem(e) {
  e.preventDefault();
  var form = document.getElementById('form-item');
  var data = {
    nombre: form.nombre.value,
    imagen: form.imagen.value,
    talla: form.talla.value,
    cantidad: form.cantidad.value,
    precioCosto: form.precioCosto.value,
    precioVenta: form.precioVenta.value,
    stock: form.stock.value
  };

  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(function (res) {
      hideGlobalSpinner();
      if (res.success) {
        Swal.fire('Éxito', res.message, 'success');
        form.reset();
        invalidateCache('articulos');
        loadArticlesIfNeeded();
      } else {
        Swal.fire('Error', res.message, 'error');
      }
    })
    .withFailureHandler(handleError)
    .saveArticulo(data);
}

function filterItemsTable() {
  var txt = document.getElementById('item-filter').value.toLowerCase();
  if (!txt) {
    renderItemsTable(cache.articulos || globalArticles);
    return;
  }

  var filtered = (cache.articulos || globalArticles).filter(a =>
    String(a.ARTICULO || '').toLowerCase().includes(txt) ||
    String(a.TALLA || '').toLowerCase().includes(txt)
  );
  renderItemsTable(filtered);
}

/* ===================================================
   MÓDULO COMPRAS
   =================================================== */
function updatePurchaseCost() {
  var articuloNombre = document.getElementById('purchase-item-select').value;
  var cantidad = parseInt(document.getElementById('purchase-qty').value || 0);

  // Limpiar displays
  document.getElementById('purchase-size-display').value = '-';
  document.getElementById('purchase-unit-cost-input').value = '';
  document.getElementById('purchase-cost').value = '';
  document.getElementById('purchase-item-image').style.display = 'none';
  document.getElementById('purchase-no-image').style.display = 'block';
  document.getElementById('purchase-item-info').style.display = 'none';

  if (!articuloNombre) {
    return;
  }

  if (globalArticles.length === 0) {
    document.getElementById('purchase-no-image').innerText = 'ERROR: No hay artículos cargados';
    Swal.fire('Error', 'No hay artículos cargados en memoria. Recarga la página.', 'error');
    return;
  }

  // Buscar SOLO por nombre del artículo
  var item = globalArticles.find(function (a) {
    return String(a.ARTICULO || '').trim() === articuloNombre.trim();
  });

  if (item) {
    var precioCosto = Number(item.PRECIO_COSTO || 0);
    var costoTotal = precioCosto * cantidad;

    // Mostrar talla del artículo
    document.getElementById('purchase-size-display').value = item.TALLA || '-';
    document.getElementById('purchase-unit-cost-input').value = precioCosto;
    document.getElementById('purchase-cost').value = costoTotal;

    // Mostrar información del artículo
    document.getElementById('purchase-info-name').innerText = item.ARTICULO;
    document.getElementById('purchase-info-talla').innerText = item.TALLA;
    document.getElementById('purchase-info-stock').innerText = item.CANTIDAD || 0;
    document.getElementById('purchase-item-info').style.display = 'block';

    // Mostrar imagen si existe
    if (item.IMAGEN_ARTICULO && item.IMAGEN_ARTICULO.trim() !== '') {
      document.getElementById('purchase-item-image').src = item.IMAGEN_ARTICULO;
      document.getElementById('purchase-item-image').style.display = 'block';
      document.getElementById('purchase-no-image').style.display = 'none';
    } else {
      document.getElementById('purchase-no-image').innerText = 'Este artículo no tiene imagen';
      document.getElementById('purchase-no-image').style.display = 'block';
    }
  } else {
    document.getElementById('purchase-no-image').innerText = 'Artículo no encontrado en inventario';
    document.getElementById('purchase-no-image').style.display = 'block';

    Swal.fire({
      icon: 'error',
      title: 'Artículo No Encontrado',
      html: `
              <p>No se encontró: <strong>${articuloNombre}</strong></p>
              <p style="font-size:0.9em; color:#666;">
                Verifica que el nombre en la hoja ARTICULOS coincida exactamente
              </p>
            `
    });
  }
}

function handlePurchase(e) {
  e.preventDefault();
  var data = {
    articuloNombre: document.getElementById('purchase-item-select').value,
    cantidad: document.getElementById('purchase-qty').value
  };

  if (!data.articuloNombre) {
    Swal.fire('Error', 'Debe seleccionar un artículo', 'warning');
    return;
  }

  // CRÍTICO: Validar que tengamos usuario activo
  if (!currentUser) {
    Swal.fire('Error', 'No hay sesión activa. Por favor recargue la página.', 'error');
    return;
  }

  showGlobalSpinner();
  console.log('📤 COMPRA - Enviando con usuario:', currentUser);

  google.script.run
    .withSuccessHandler(function (res) {
      hideGlobalSpinner();
      if (res.success) {
        Swal.fire('Éxito', res.message, 'success');
        document.getElementById('form-purchase').reset();
        document.getElementById('purchase-size-display').value = '-';
        document.getElementById('purchase-unit-cost-input').value = '';
        document.getElementById('purchase-cost').value = '';
        document.getElementById('purchase-item-image').style.display = 'none';
        document.getElementById('purchase-no-image').style.display = 'block';
        document.getElementById('purchase-no-image').innerText = 'Seleccione un artículo para ver su imagen';
        document.getElementById('purchase-item-info').style.display = 'none';
        invalidateCache('articulos');
        loadArticlesIfNeeded();
      } else {
        Swal.fire('Error', res.message, 'error');
      }
    })
    .withFailureHandler(handleError)
    .registrarCompra(data, currentUser); // ← CAMBIO CRÍTICO: PASAMOS currentUser
}


/* ===================================================
   MÓDULO VENTAS
   =================================================== */
function loadSalesData() {
  loadArticlesIfNeeded();
  loadClientsForSale();
}

function loadClientsForSale() {
  var opts = '<option value="">Consumidor Final</option>';
  if (cache.clientes) {
    cache.clientes.forEach(function (c) {
      opts += `<option value="${c.ACUDIENTE_1}">${c.ACUDIENTE_1} (${c.ESTUDIANTE})</option>`;
    });
  } else if (globalClients.length > 0) {
    globalClients.forEach(function (c) {
      opts += `<option value="${c.ACUDIENTE_1}">${c.ACUDIENTE_1} (${c.ESTUDIANTE})</option>`;
    });
  }
  document.getElementById('sale-client-select').innerHTML = opts;
}

function updateSalePrice() {
  var name = document.getElementById('sale-item-select').value;

  // Limpiar displays
  document.getElementById('sale-size-display').value = '-';
  document.getElementById('sale-price-display').innerText = '$0';
  document.getElementById('sale-price-display').dataset.price = '0';
  document.getElementById('sale-stock-display').innerText = '-';
  document.getElementById('sale-item-image').style.display = 'none';
  document.getElementById('sale-no-image').style.display = 'block';
  document.getElementById('sale-no-image').innerText = 'Seleccione un artículo';

  if (!name) {
    return;
  }

  // Mostrar indicador de carga mientras consulta la hoja
  document.getElementById('sale-stock-display').innerText = 'Cargando...';
  document.getElementById('sale-no-image').innerText = 'Consultando datos del artículo...';

  // Leer datos actualizados directamente de la hoja ARTICULOS
  google.script.run
    .withSuccessHandler(function (response) {
      if (response.success && response.data) {
        var item = response.data;
        var precio = Number(item.PRECIO_VENTA || 0);
        var stock = Number(item.CANTIDAD || 0);

        // Mostrar talla del artículo
        document.getElementById('sale-size-display').value = item.TALLA || '-';
        document.getElementById('sale-price-display').innerText = '$' + precio.toLocaleString();
        document.getElementById('sale-price-display').dataset.price = precio;
        document.getElementById('sale-price-display').dataset.talla = item.TALLA || '';
        document.getElementById('sale-stock-display').innerText = stock;

        // Mostrar imagen si existe
        if (item.IMAGEN_ARTICULO && item.IMAGEN_ARTICULO.trim() !== '') {
          document.getElementById('sale-item-image').src = item.IMAGEN_ARTICULO;
          document.getElementById('sale-item-image').style.display = 'block';
          document.getElementById('sale-no-image').style.display = 'none';
        } else {
          document.getElementById('sale-no-image').innerText = 'Sin imagen disponible';
          document.getElementById('sale-no-image').style.display = 'block';
        }
      } else {
        document.getElementById('sale-no-image').innerText = 'Artículo no encontrado en inventario';
        document.getElementById('sale-no-image').style.display = 'block';
        document.getElementById('sale-stock-display').innerText = '-';

        Swal.fire({
          icon: 'error',
          title: 'Artículo No Encontrado',
          html: `
                  <p>No se encontró: <strong>${name}</strong></p>
                  <p style="font-size:0.9em; color:#666;">
                    Verifica que el nombre en la hoja ARTICULOS coincida exactamente
                  </p>
                `
        });
      }
    })
    .withFailureHandler(function (error) {
      document.getElementById('sale-stock-display').innerText = 'Error';
      document.getElementById('sale-no-image').innerText = 'Error al consultar el artículo';
      Swal.fire('Error', 'No se pudo consultar el artículo: ' + error.message, 'error');
    })
    .getArticuloByName(name);
}


async function addToCart() {
  var name = document.getElementById('sale-item-select').value;
  var tallaDisplay = document.getElementById('sale-size-display').value;
  var qty = parseInt(document.getElementById('sale-qty').value);
  var price = parseInt(document.getElementById('sale-price-display').dataset.price || 0);

  if (!name) {
    Swal.fire('Error', 'Seleccione un artículo', 'warning');
    return;
  }

  if (qty <= 0) {
    Swal.fire('Error', 'La cantidad debe ser mayor a 0', 'warning');
    return;
  }

  // Consultar stock actualizado directamente de la hoja ARTICULOS
  Swal.fire({
    title: 'Verificando stock...',
    text: 'Consultando inventario actualizado',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  var itemFresco = await new Promise(function (resolve) {
    google.script.run
      .withSuccessHandler(function (response) {
        resolve(response);
      })
      .withFailureHandler(function (error) {
        resolve({ success: false, error: error.message, data: null });
      })
      .getArticuloByName(name);
  });

  Swal.close();

  if (!itemFresco.success || !itemFresco.data) {
    Swal.fire('Error', 'Artículo no encontrado en inventario', 'warning');
    return;
  }

  var item = itemFresco.data;
  var stockDisponible = Number(item.CANTIDAD);
  var entregadoInicial = true; // Por defecto se marca como entregado

  // Actualizar el stock mostrado en pantalla con el dato fresco
  document.getElementById('sale-stock-display').innerText = stockDisponible;

  // Permitir ventas pendientes con stock <= 0 (cero o negativo)
  if (stockDisponible <= 0) {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'Inventario Insuficiente',
      html: `
        <p style="font-size:1.1em; margin:10px 0;">
          <strong>Inventario Disponible: ${stockDisponible}</strong>
        </p>

      <p style="font-size:0.95em; color:#666; margin:15px 0;">
    ${stockDisponible === 0 ? 'No hay existencias de este artículo en inventario.' : 'El stock de este artículo está en negativo.'}
  </p>

          <hr style="margin:20px 0;">
          <p style="font-size:1em; font-weight:600; color:#e74c3c;">
            ¿Desea realizar la venta como PENDIENTE DE ENTREGA?
          </p>
          <p style="font-size:0.9em; color:#666; margin-top:10px;">
            El artículo se agregará al carro marcado como "Sin Entregar"
          </p>
        `,
      showCancelButton: true,
      confirmButtonText: 'Sí, vender como pendiente',
      cancelButtonText: 'No, cancelar',
      confirmButtonColor: '#f39c12',
      cancelButtonColor: '#95a5a6'
    });

    if (!result.isConfirmed) {
      return;
    }

    entregadoInicial = false;

    Swal.fire({
      icon: 'info',
      title: 'Artículo agregado como pendiente',
      text: 'El checkbox de "Entregado" estará desmarcado',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000
    });
  } else if (stockDisponible < qty) {
    Swal.fire('Error', `Stock insuficiente. Disponible: ${stockDisponible}`, 'warning');
    return;
  }

  // Si es el primer item, fijar el cliente
  if (cart.length === 0) {
    currentClientFixed = document.getElementById('sale-client-select').value || "Consumidor Final";
  }

  var subtotal = qty * price;

  cart.push({
    nombre: name,
    talla: tallaDisplay,
    cantidad: qty,
    precio: price,
    subtotal: subtotal,
    entregado: entregadoInicial
  });

  renderCart();

  // Reset selección de artículo pero mantener cliente
  document.getElementById('sale-item-select').value = '';
  document.getElementById('sale-qty').value = '1';
  updateSalePrice();
}


function renderCart() {
  var tbody = document.querySelector('#cart-table tbody');

  if (cart.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:#999;">Carro vacío</td></tr>';
    document.getElementById('cart-total').innerText = '0';
    currentClientFixed = null;
    return;
  }

  tbody.innerHTML = '';
  var total = 0;

  cart.forEach(function (item, idx) {
    total += item.subtotal;
    var row = document.createElement('tr');
    var checkboxId = 'checkbox-entrega-' + idx;
    var isChecked = item.entregado !== false ? 'checked' : '';

    row.innerHTML = `
    <td>${item.nombre}</td>
    <td>${item.talla}</td>
    <td>${item.cantidad}</td>
    <td>$${item.subtotal.toLocaleString()}</td>
    <td style="text-align:center;">
      <input type="checkbox" id="${checkboxId}" ${isChecked} 
             onchange="toggleEntrega(${idx})"
             style="width:20px; height:20px; cursor:pointer;">
    </td>
    <td>
      <span class="material-icons remove-icon" onclick="removeFromCart(${idx})" 
            style="cursor:pointer; color:#e74c3c;">
        delete
      </span>
    </td>
  `;
    tbody.appendChild(row);
  });

  document.getElementById('cart-total').innerText = total.toLocaleString();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();

  if (cart.length === 0) {
    currentClientFixed = null;
  }
}

function toggleEntrega(idx) {
  var checkbox = document.getElementById('checkbox-entrega-' + idx);
  cart[idx].entregado = checkbox.checked;

  // Feedback visual
  if (!checkbox.checked) {
    Swal.fire({
      icon: 'warning',
      title: 'Artículo sin entregar',
      text: 'Este artículo quedará pendiente de entrega',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000
    });
  }
}



async function openPaymentModal() {
  if (cart.length === 0) {
    Swal.fire('Error', 'El carro está vacío', 'warning');
    return;
  }

  var total = cart.reduce((sum, item) => sum + item.subtotal, 0);

  const { value: formValues } = await Swal.fire({
    title: 'Pago Total: $' + total.toLocaleString(),
    html: `
            <label style="display:block; margin:10px 0; font-weight:600;">Medio de Pago:</label>
            <select id="pay-method" class="swal2-select" onchange="toggleCardOptions()">
              <option value="EFECTIVO">Efectivo</option>
              <option value="TARJETA">Tarjeta (Débito/Crédito)</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="MIXTO">Tarjeta y Efectivo</option>
              <option value="MIXTO_TRANS">Transferencia y Efectivo</option>
            </select>
            
            <div id="card-options" style="display:none; margin-top:15px;">
              <label style="display:block; margin:10px 0; font-weight:600;">Cantidad de Tarjetas:</label>
              <select id="card-count" class="swal2-select">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
          `,
    focusConfirm: false,
    showCancelButton: true,
    cancelButtonText: 'Cancelar',
    confirmButtonText: 'Continuar',
    preConfirm: () => {
      return {
        method: document.getElementById('pay-method').value,
        cardCount: document.getElementById('card-count').value
      };
    }
  });

  if (formValues) {
    processPaymentDetails(formValues, total);
  }
}

window.toggleCardOptions = function () {
  var method = document.getElementById('pay-method').value;
  document.getElementById('card-options').style.display =
    (method === 'TARJETA' || method === 'MIXTO') ? 'block' : 'none';
};

async function processPaymentDetails(info, total) {
  var pagos = [];
  var cambio = 0;

  if (info.method === 'EFECTIVO') {
    // Solicitar cuánto entrega el cliente
    const { value: efectivoEntregado } = await Swal.fire({
      title: 'Pago en Efectivo',
      html: `
              <p style="font-size:1.1em; margin:10px 0;">
                <strong>Total a Pagar:</strong> 
                <span style="color:#e74c3c; font-size:1.3em;">$${total.toLocaleString()}</span>
              </p>
              <label style="display:block; margin:15px 0 5px 0; font-weight:600;">
                ¿Cuánto dinero entrega el cliente?
              </label>
              <input id="efectivo-entregado" type="number" min="${total}" 
                     class="swal2-input" placeholder="Ejemplo: ${total}" 
                     style="font-size:1.2em; text-align:center;">
            `,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      confirmButtonText: 'Calcular Cambio',
      preConfirm: () => {
        var entregado = parseFloat(document.getElementById('efectivo-entregado').value || 0);
        if (entregado < total) {
          Swal.showValidationMessage(
            `El monto entregado ($${entregado.toLocaleString()}) es menor al total ($${total.toLocaleString()})`
          );
          return false;
        }
        return entregado;
      }
    });

    if (efectivoEntregado) {
      cambio = efectivoEntregado - total;
      pagos.push({ metodo: 'Efectivo', monto: total });

      // Mostrar el cambio claramente
      await Swal.fire({
        icon: 'success',
        title: 'Cambio a Devolver',
        html: `
                <div style="background:#f0f9ff; border:2px solid #3498db; border-radius:10px; padding:20px; margin:15px 0;">
                  <p style="font-size:1em; margin:5px 0; color:#555;">Cliente Entregó:</p>
                  <p style="font-size:1.5em; font-weight:bold; margin:5px 0; color:#2c3e50;">
                    $${efectivoEntregado.toLocaleString()}
                  </p>
                  
                  <p style="font-size:1em; margin:15px 0 5px 0; color:#555;">Total de la Compra:</p>
                  <p style="font-size:1.3em; font-weight:bold; margin:5px 0; color:#e74c3c;">
                    $${total.toLocaleString()}
                  </p>
                  
                  <hr style="border:none; border-top:2px solid #ddd; margin:20px 0;">
                  
                  <p style="font-size:1.2em; margin:5px 0; color:#27ae60; font-weight:bold;">
                    CAMBIO A DEVOLVER:
                  </p>
                  <p style="font-size:2.5em; font-weight:bold; margin:10px 0; color:#27ae60;">
                    $${cambio.toLocaleString()}
                  </p>
                </div>
              `,
        confirmButtonText: 'Generar Voucher',
        allowOutsideClick: false
      });

      sendSale(pagos, total, cambio);
    }
  } else if (info.method === 'TARJETA') {
    // Solo tarjetas
    var count = parseInt(info.cardCount);
    var htmlInputs = '';

    for (var i = 0; i < count; i++) {
      htmlInputs += `
              <input id="card-val-${i}" type="number" min="0" 
                     placeholder="Monto Tarjeta ${i + 1}" 
                     class="swal2-input" style="margin:5px 0;">
            `;
    }

    const { value: cardValues } = await Swal.fire({
      title: 'Ingrese montos por tarjeta',
      html: htmlInputs,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      confirmButtonText: 'Confirmar',
      preConfirm: () => {
        var vals = [];
        var sum = 0;

        for (var i = 0; i < count; i++) {
          var v = parseInt(document.getElementById('card-val-' + i).value || 0);
          vals.push({ metodo: `Tarjeta ${i + 1}`, monto: v });
          sum += v;
        }

        if (sum !== total) {
          Swal.showValidationMessage(
            `La suma ($${sum.toLocaleString()}) no coincide con el total ($${total.toLocaleString()})`
          );
          return false;
        }

        return vals;
      }
    });

    if (cardValues) {
      sendSale(cardValues, total, 0);
    }
  } else if (info.method === 'TRANSFERENCIA') {
    // Solo transferencia
    const { value: transferenciaValues } = await Swal.fire({
      title: 'Pago por Transferencia',
      html: `
              <p style="font-size:1.1em; margin:10px 0;">
                <strong>Total a Pagar:</strong> 
                <span style="color:#e74c3c; font-size:1.3em;">$${total.toLocaleString()}</span>
              </p>
              <input id="trans-val" type="number" min="${total}" 
                     placeholder="Monto Transferencia" 
                     class="swal2-input" style="margin:10px 0;">
            `,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      confirmButtonText: 'Confirmar',
      preConfirm: () => {
        var transVal = parseInt(document.getElementById('trans-val').value || 0);

        if (transVal !== total) {
          Swal.showValidationMessage(
            `El monto ($${transVal.toLocaleString()}) debe coincidir con el total ($${total.toLocaleString()})`
          );
          return false;
        }

        return [{ metodo: 'Transferencia', monto: transVal }];
      }
    });

    if (transferenciaValues) {
      sendSale(transferenciaValues, total, 0);
    }
  } else if (info.method === 'MIXTO') {
    // FLUJO CORREGIDO: Tarjeta y Efectivo
    var count = parseInt(info.cardCount);

    // PASO 1: Solicitar montos de tarjetas
    var htmlInputs = '';
    for (var i = 0; i < count; i++) {
      htmlInputs += `
              <label style="display:block; margin:10px 0; font-weight:600;">Tarjeta ${i + 1}:</label>
              <input id="card-val-${i}" type="number" min="0" 
                     placeholder="Monto Tarjeta ${i + 1}" 
                     class="swal2-input" style="margin:5px 0;">
            `;
    }

    const { value: mixedValues } = await Swal.fire({
      title: 'Ingrese montos de tarjetas',
      html: htmlInputs,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      confirmButtonText: 'Continuar',
      preConfirm: () => {
        var vals = [];
        var sum = 0;

        for (var i = 0; i < count; i++) {
          var v = parseInt(document.getElementById('card-val-' + i).value || 0);
          if (v > 0) {
            vals.push({ metodo: `Tarjeta ${i + 1}`, monto: v });
            sum += v;
          }
        }

        if (sum >= total) {
          Swal.showValidationMessage(
            `La suma de tarjetas ($${sum.toLocaleString()}) debe ser menor al total ($${total.toLocaleString()})`
          );
          return false;
        }

        return { tarjetas: vals, sumaTarjetas: sum };
      }
    });

    if (mixedValues) {
      // Calcular efectivo necesario automáticamente
      var efectivoNecesario = total - mixedValues.sumaTarjetas;

      // PASO 2: Solicitar cuánto entrega el cliente en efectivo
      const { value: efectivoEntregado } = await Swal.fire({
        title: 'Pago Mixto - Efectivo',
        html: `
                <div style="background:#ecf0f1; padding:15px; border-radius:8px; margin:10px 0;">
                  <p style="font-size:1em; margin:5px 0;"><strong>Total a Pagar:</strong> $${total.toLocaleString()}</p>
                  <p style="font-size:1em; margin:5px 0;"><strong>Suma Tarjetas:</strong> $${mixedValues.sumaTarjetas.toLocaleString()}</p>
                  <hr style="border:none; border-top:2px solid #bdc3c7; margin:10px 0;">
                  <p style="font-size:1.2em; margin:5px 0; font-weight:bold; color:#e74c3c;">
                    <strong>Efectivo Necesario:</strong> $${efectivoNecesario.toLocaleString()}
                  </p>
                </div>
                <label style="display:block; margin:15px 0 5px 0; font-weight:600;">
                  ¿Cuánto dinero entrega el cliente en efectivo?
                </label>
                <input id="efectivo-mixto-entregado" type="number" min="${efectivoNecesario}" 
                       class="swal2-input" placeholder="Ejemplo: ${efectivoNecesario}" 
                       style="font-size:1.2em; text-align:center;">
              `,
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Calcular Cambio',
        preConfirm: () => {
          var entregado = parseFloat(document.getElementById('efectivo-mixto-entregado').value || 0);
          if (entregado < efectivoNecesario) {
            Swal.showValidationMessage(
              `El monto entregado ($${entregado.toLocaleString()}) es menor al efectivo necesario ($${efectivoNecesario.toLocaleString()})`
            );
            return false;
          }
          return entregado;
        }
      });

      if (efectivoEntregado) {
        cambio = efectivoEntregado - efectivoNecesario;

        // Agregar efectivo a los pagos
        var pagosFinal = mixedValues.tarjetas.slice();
        pagosFinal.push({ metodo: 'Efectivo', monto: efectivoNecesario });

        // Mostrar cambio
        await Swal.fire({
          icon: 'success',
          title: 'Cambio a Devolver',
          html: `
                  <div style="background:#f0f9ff; border:2px solid #3498db; border-radius:10px; padding:20px; margin:15px 0;">
                    <p style="font-size:1em; margin:5px 0; color:#555;">Efectivo Entregado:</p>
                    <p style="font-size:1.5em; font-weight:bold; margin:5px 0; color:#2c3e50;">
                      $${efectivoEntregado.toLocaleString()}
                    </p>
                    
                    <p style="font-size:1em; margin:15px 0 5px 0; color:#555;">Efectivo Necesario:</p>
                    <p style="font-size:1.3em; font-weight:bold; margin:5px 0; color:#e74c3c;">
                      $${efectivoNecesario.toLocaleString()}
                    </p>
                    
                    <hr style="border:none; border-top:2px solid #ddd; margin:20px 0;">
                    
                    <p style="font-size:1.2em; margin:5px 0; color:#27ae60; font-weight:bold;">
                      CAMBIO A DEVOLVER:
                    </p>
                    <p style="font-size:2.5em; font-weight:bold; margin:10px 0; color:#27ae60;">
                      $${cambio.toLocaleString()}
                    </p>
                  </div>
                `,
          confirmButtonText: 'Generar Voucher',
          allowOutsideClick: false
        });

        sendSale(pagosFinal, total, cambio);
      }
    }
  } else if (info.method === 'MIXTO_TRANS') {
    // NUEVO FLUJO: Transferencia y Efectivo

    // PASO 1: Solicitar monto de transferencia
    const { value: transferenciaData } = await Swal.fire({
      title: 'Ingrese monto de transferencia',
      html: '<input id="trans-val" type="number" min="0" placeholder="Monto Transferencia" class="swal2-input" style="margin:5px 0;">',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      confirmButtonText: 'Continuar',
      preConfirm: () => {
        var transVal = parseInt(document.getElementById('trans-val').value || 0);

        if (transVal >= total) {
          Swal.showValidationMessage(
            `La transferencia ($${transVal.toLocaleString()}) debe ser menor al total ($${total.toLocaleString()})`
          );
          return false;
        }

        if (transVal <= 0) {
          Swal.showValidationMessage('El monto debe ser mayor a cero');
          return false;
        }

        return transVal;
      }
    });

    if (transferenciaData) {
      // Calcular efectivo necesario automáticamente
      var efectivoNecesario = total - transferenciaData;

      // PASO 2: Solicitar cuánto entrega el cliente en efectivo
      const { value: efectivoEntregado } = await Swal.fire({
        title: 'Pago Mixto - Efectivo',
        html: `
                <div style="background:#ecf0f1; padding:15px; border-radius:8px; margin:10px 0;">
                  <p style="font-size:1em; margin:5px 0;"><strong>Total a Pagar:</strong> $${total.toLocaleString()}</p>
                  <p style="font-size:1em; margin:5px 0;"><strong>Transferencia:</strong> $${transferenciaData.toLocaleString()}</p>
                  <hr style="border:none; border-top:2px solid #bdc3c7; margin:10px 0;">
                  <p style="font-size:1.2em; margin:5px 0; font-weight:bold; color:#e74c3c;">
                    <strong>Efectivo Necesario:</strong> $${efectivoNecesario.toLocaleString()}
                  </p>
                </div>
                <label style="display:block; margin:15px 0 5px 0; font-weight:600;">
                  ¿Cuánto dinero entrega el cliente en efectivo?
                </label>
                <input id="efectivo-mixto-trans" type="number" min="${efectivoNecesario}" 
                       class="swal2-input" placeholder="Ejemplo: ${efectivoNecesario}" 
                       style="font-size:1.2em; text-align:center;">
              `,
        showCancelButton: true,
        cancelButtonText: 'Cancelar',
        confirmButtonText: 'Calcular Cambio',
        preConfirm: () => {
          var entregado = parseFloat(document.getElementById('efectivo-mixto-trans').value || 0);
          if (entregado < efectivoNecesario) {
            Swal.showValidationMessage(
              `El monto entregado ($${entregado.toLocaleString()}) es menor al efectivo necesario ($${efectivoNecesario.toLocaleString()})`
            );
            return false;
          }
          return entregado;
        }
      });

      if (efectivoEntregado) {
        cambio = efectivoEntregado - efectivoNecesario;

        // Crear array de pagos
        var pagosFinal = [
          { metodo: 'Transferencia', monto: transferenciaData },
          { metodo: 'Efectivo', monto: efectivoNecesario }
        ];

        // Mostrar cambio
        await Swal.fire({
          icon: 'success',
          title: 'Cambio a Devolver',
          html: `
                  <div style="background:#f0f9ff; border:2px solid #3498db; border-radius:10px; padding:20px; margin:15px 0;">
                    <p style="font-size:1em; margin:5px 0; color:#555;">Efectivo Entregado:</p>
                    <p style="font-size:1.5em; font-weight:bold; margin:5px 0; color:#2c3e50;">
                      $${efectivoEntregado.toLocaleString()}
                    </p>
                    
                    <p style="font-size:1em; margin:15px 0 5px 0; color:#555;">Efectivo Necesario:</p>
                    <p style="font-size:1.3em; font-weight:bold; margin:5px 0; color:#e74c3c;">
                      $${efectivoNecesario.toLocaleString()}
                    </p>
                    
                    <hr style="border:none; border-top:2px solid #ddd; margin:20px 0;">
                    
                    <p style="font-size:1.2em; margin:5px 0; color:#27ae60; font-weight:bold;">
                      CAMBIO A DEVOLVER:
                    </p>
                    <p style="font-size:2.5em; font-weight:bold; margin:10px 0; color:#27ae60;">
                      $${cambio.toLocaleString()}
                    </p>
                  </div>
                `,
          confirmButtonText: 'Generar Voucher',
          allowOutsideClick: false
        });

        sendSale(pagosFinal, total, cambio);
      }
    }
  }
}

function sendSale(pagos, total, cambio) {
  var clientName = currentClientFixed || "Consumidor Final";
  var saleData = {
    clienteNombre: clientName,
    items: cart,
    total: total,
    pagos: pagos,
    cambio: cambio
  };

  // CRÍTICO: Validar que tengamos usuario activo
  if (!currentUser) {
    Swal.fire('Error', 'No hay sesión activa. Por favor recargue la página.', 'error');
    return;
  }

  console.log('📤 VENTA - Enviando con usuario:', currentUser);

  Swal.fire({
    title: 'Procesando venta...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  google.script.run
    .withSuccessHandler(function (res) {
      if (res.success) {
        Swal.fire({
          icon: 'success',
          title: 'Venta Registrada',
          text: 'Descargando Voucher...',
          timer: 2000,
          showConfirmButton: false
        });

        // Descargar PDF
        var link = document.createElement('a');
        link.href = "data:application/pdf;base64," + res.pdfBase64;
        link.download = res.fileName;
        link.click();

        // Reset
        cart = [];
        currentClientFixed = null;
        renderCart();
        invalidateCache('articulos');
        loadArticlesIfNeeded();
      } else {
        Swal.fire('Error', res.message, 'error');
      }
    })
    .withFailureHandler(handleError)
    .registrarVenta(saleData, currentUser); // ← CAMBIO CRÍTICO: PASAMOS currentUser
}
/* ===================================================
   MÓDULO VENTAS MISCELÁNEAS
   =================================================== */
function loadMiscData() {
  loadArticlesIfNeeded();
}

function updateMiscPrice() {
  var name = document.getElementById('misc-item-select').value;

  document.getElementById('misc-price-display').innerText = '$0';
  document.getElementById('misc-price-display').dataset.price = '0';
  document.getElementById('misc-stock-display').innerText = '-';
  document.getElementById('misc-item-image').style.display = 'none';
  document.getElementById('misc-no-image').style.display = 'block';
  document.getElementById('misc-no-image').innerText = 'Seleccione un artículo';

  if (!name) return;

  document.getElementById('misc-stock-display').innerText = 'Cargando...';
  document.getElementById('misc-no-image').innerText = 'Consultando datos del artículo...';

  google.script.run
    .withSuccessHandler(function (response) {
      if (response.success && response.data) {
        var item = response.data;
        var precio = Number(item.PRECIO_VENTA || 0);
        var stock = Number(item.CANTIDAD || 0);

        document.getElementById('misc-price-display').innerText = '$' + precio.toLocaleString();
        document.getElementById('misc-price-display').dataset.price = precio;
        document.getElementById('misc-stock-display').innerText = stock;

        if (item.IMAGEN_ARTICULO && item.IMAGEN_ARTICULO.trim() !== '') {
          document.getElementById('misc-item-image').src = item.IMAGEN_ARTICULO;
          document.getElementById('misc-item-image').style.display = 'block';
          document.getElementById('misc-no-image').style.display = 'none';
        } else {
          document.getElementById('misc-no-image').innerText = 'Sin imagen disponible';
          document.getElementById('misc-no-image').style.display = 'block';
        }
      } else {
        document.getElementById('misc-no-image').innerText = 'Artículo no encontrado en inventario';
        document.getElementById('misc-no-image').style.display = 'block';
        document.getElementById('misc-stock-display').innerText = '-';
      }
    })
    .withFailureHandler(function (error) {
      document.getElementById('misc-no-image').innerText = 'Error al consultar el artículo';
      Swal.fire('Error', 'No se pudo consultar el artículo: ' + error.message, 'error');
    })
    .getArticuloByName(name);
}

async function addToCartMisc() {
  var name = document.getElementById('misc-item-select').value;
  var qty = parseInt(document.getElementById('misc-qty').value);
  var price = parseInt(document.getElementById('misc-price-display').dataset.price || 0);

  if (!name) {
    Swal.fire('Error', 'Seleccione un artículo', 'warning');
    return;
  }

  if (qty <= 0) {
    Swal.fire('Error', 'La cantidad debe ser mayor a 0', 'warning');
    return;
  }

  // Verificar stock actualizado
  Swal.fire({
    title: 'Verificando stock...',
    text: 'Consultando inventario actualizado',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  var itemFresco = await new Promise(function (resolve) {
    google.script.run
      .withSuccessHandler(function (response) { resolve(response); })
      .withFailureHandler(function (error) { resolve({ success: false, error: error.message, data: null }); })
      .getArticuloByName(name);
  });

  Swal.close();

  if (!itemFresco.success || !itemFresco.data) {
    Swal.fire('Error', 'Artículo no encontrado en inventario', 'warning');
    return;
  }

  var item = itemFresco.data;
  var stockDisponible = Number(item.CANTIDAD);

  document.getElementById('misc-stock-display').innerText = stockDisponible;

  if (stockDisponible <= 0) {
    Swal.fire('Error', 'No hay existencias de este artículo en inventario.', 'warning');
    return;
  }

  if (stockDisponible < qty) {
    Swal.fire('Error', 'Stock insuficiente. Disponible: ' + stockDisponible, 'warning');
    return;
  }

  // Descontar inventario inmediatamente
  Swal.fire({
    title: 'Actualizando inventario...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  var resultDescuento = await new Promise(function (resolve) {
    google.script.run
      .withSuccessHandler(function (response) { resolve(response); })
      .withFailureHandler(function (error) { resolve({ success: false, message: error.message }); })
      .descontarInventarioMisc(name, qty);
  });

  Swal.close();

  if (!resultDescuento.success) {
    Swal.fire('Error', resultDescuento.message || 'No se pudo descontar el inventario', 'error');
    return;
  }

  // Actualizar stock en pantalla
  document.getElementById('misc-stock-display').innerText = resultDescuento.nuevoStock;

  var subtotal = qty * price;

  cartMisc.push({
    nombre: name,
    talla: item.TALLA || '-',
    cantidad: qty,
    precio: price,
    subtotal: subtotal
  });

  renderCartMisc();

  // Mantener artículo seleccionado, solo resetear cantidad
  document.getElementById('misc-qty').value = '1';
}

function renderCartMisc() {
  var tbody = document.querySelector('#misc-cart-table tbody');

  if (cartMisc.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#999;">Carro vacío</td></tr>';
    document.getElementById('misc-cart-total').innerText = '0';
    return;
  }

  tbody.innerHTML = '';
  var total = 0;

  cartMisc.forEach(function (item, index) {
    total += item.subtotal;
    var row = document.createElement('tr');
    row.innerHTML =
      '<td>' + item.nombre + '</td>' +
      '<td>' + item.cantidad + '</td>' +
      '<td>$' + item.subtotal.toLocaleString() + '</td>' +
      '<td><button class="btn-icon" onclick="removeFromCartMisc(' + index + ')" title="Eliminar"><span class="material-icons" style="color:#e74c3c;">delete</span></button></td>';
    tbody.appendChild(row);
  });

  document.getElementById('misc-cart-total').innerText = total.toLocaleString();
}

async function removeFromCartMisc(index) {
  var item = cartMisc[index];
  // Devolver stock al inventario
  Swal.fire({
    title: 'Restaurando inventario...',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  var result = await new Promise(function (resolve) {
    google.script.run
      .withSuccessHandler(function (response) { resolve(response); })
      .withFailureHandler(function (error) { resolve({ success: false, message: error.message }); })
      .restaurarInventarioMisc(item.nombre, item.cantidad);
  });

  Swal.close();

  if (!result.success) {
    Swal.fire('Error', 'No se pudo restaurar el inventario: ' + (result.message || ''), 'error');
    return;
  }

  cartMisc.splice(index, 1);
  renderCartMisc();
}

async function openPaymentModalMisc() {
  if (cartMisc.length === 0) {
    Swal.fire('Error', 'El carro está vacío', 'warning');
    return;
  }

  var total = cartMisc.reduce(function (sum, item) { return sum + item.subtotal; }, 0);

  var formResult = await Swal.fire({
    title: 'Pago Total: $' + total.toLocaleString(),
    html: `
            <label style="display:block; margin:10px 0; font-weight:600;">Medio de Pago:</label>
            <select id="misc-pay-method" class="swal2-select">
              <option value="EFECTIVO">Efectivo</option>
              <option value="TARJETA">Tarjeta (Débito/Crédito)</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>`,
    focusConfirm: false,
    showCancelButton: true,
    cancelButtonText: 'Cancelar',
    confirmButtonText: 'Continuar',
    preConfirm: function () {
      return { method: document.getElementById('misc-pay-method').value };
    }
  });

  if (formResult.value) {
    processMiscPayment(formResult.value, total);
  }
}

async function processMiscPayment(info, total) {
  var pagos = [];
  var cambio = 0;

  if (info.method === 'EFECTIVO') {
    var cashResult = await Swal.fire({
      title: 'Pago en Efectivo',
      html: `
              <p style="font-size:1.1em; margin:10px 0;">
                <strong>Total a Pagar:</strong>
                <span style="color:#e74c3c; font-size:1.3em;">$${total.toLocaleString()}</span>
              </p>
              <label style="display:block; margin:15px 0 5px 0; font-weight:600;">
                ¿Cuánto dinero entrega el cliente?
              </label>
              <input id="misc-efectivo" type="number" min="${total}"
                     class="swal2-input" placeholder="Ejemplo: ${total}"
                     style="font-size:1.2em; text-align:center;">`,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      confirmButtonText: 'Calcular Cambio',
      preConfirm: function () {
        var entregado = parseFloat(document.getElementById('misc-efectivo').value || 0);
        if (entregado < total) {
          Swal.showValidationMessage(
            `El monto entregado ($${entregado.toLocaleString()}) es menor al total ($${total.toLocaleString()})`
          );
          return false;
        }
        return entregado;
      }
    });

    if (cashResult.value) {
      cambio = cashResult.value - total;
      pagos.push({ metodo: 'Efectivo', monto: total });
      showMiscChange(cashResult.value, total, cambio, pagos);
    }
  } else if (info.method === 'TARJETA') {
    pagos.push({ metodo: 'Tarjeta', monto: total });
    finalizeMiscSale(pagos, total, 0);
  } else if (info.method === 'TRANSFERENCIA') {
    pagos.push({ metodo: 'Transferencia', monto: total });
    finalizeMiscSale(pagos, total, 0);
  }
}

async function showMiscChange(entregado, total, cambio, pagos) {
  await Swal.fire({
    icon: 'success',
    title: 'Cambio a Devolver',
    html: `
            <div style="background:#f0f9ff; border:2px solid #3498db; border-radius:10px; padding:20px; margin:15px 0;">
              <p style="font-size:1em; margin:5px 0; color:#555;">Cliente Entregó:</p>
              <p style="font-size:1.5em; font-weight:bold; margin:5px 0; color:#2c3e50;">
                $${entregado.toLocaleString()}
              </p>
              <p style="font-size:1em; margin:15px 0 5px 0; color:#555;">Total de la Compra:</p>
              <p style="font-size:1.3em; font-weight:bold; margin:5px 0; color:#e74c3c;">
                $${total.toLocaleString()}
              </p>
              <hr style="border:none; border-top:2px solid #ddd; margin:20px 0;">
              <p style="font-size:1.2em; margin:5px 0; color:#27ae60; font-weight:bold;">
                CAMBIO A DEVOLVER:
              </p>
              <p style="font-size:2.5em; font-weight:bold; margin:10px 0; color:#27ae60;">
                $${cambio.toLocaleString()}
              </p>
            </div>`,
    confirmButtonText: 'Nueva Venta',
    confirmButtonColor: '#27ae60',
    allowOutsideClick: false
  });

  finalizeMiscSale(pagos, total, cambio);
}

function finalizeMiscSale(pagos, total, cambio) {
  // Registrar la venta miscelánea en el backend
  if (!currentUser) {
    Swal.fire('Error', 'No hay sesión activa. Por favor recargue la página.', 'error');
    return;
  }

  // Guardar el artículo actualmente seleccionado antes de limpiar
  var lastArticle = document.getElementById('misc-item-select').value;

  var saleData = {
    items: cartMisc,
    total: total,
    pagos: pagos,
    cambio: cambio
  };

  Swal.fire({
    title: 'Registrando venta...',
    allowOutsideClick: false,
    didOpen: function () { Swal.showLoading(); }
  });

  google.script.run
    .withSuccessHandler(function (res) {
      Swal.close();
      if (res.success) {
        // Limpiar carro solamente
        cartMisc = [];
        renderCartMisc();
        document.getElementById('misc-qty').value = '1';
        invalidateCache('articulos');

        // Mantener el último artículo seleccionado y refrescar su stock
        if (lastArticle) {
          document.getElementById('misc-item-select').value = lastArticle;
          $('#misc-item-select').trigger('change.select2');
          updateMiscPrice();
        }
      } else {
        Swal.fire('Error', res.message, 'error');
      }
    })
    .withFailureHandler(handleError)
    .registrarVentaMiscelanea(saleData, currentUser);
}

/* ===================================================
   MÓDULO CIERRE DE CAJA
   =================================================== */
function loadUsuariosForCierre() {
  if (globalUsuarios && globalUsuarios.length > 0) {
    renderUsuariosCierre(globalUsuarios);
  } else {
    google.script.run
      .withSuccessHandler(function (response) {
        if (response.success) {
          globalUsuarios = response.data;
          renderUsuariosCierre(response.data);
        }
      })
      .withFailureHandler(handleError)
      .getUsuarios();
  }
}

function renderUsuariosCierre(usuarios) {
  var select = document.getElementById('cierre-usuario');
  select.innerHTML = '<option value="">Seleccione un usuario...</option>';

  usuarios.forEach(function (u) {
    var opt = document.createElement('option');
    opt.value = u.CORREO;
    opt.innerText = u.NOMBRE_USUARIO + ' (' + u.CORREO + ')';
    select.appendChild(opt);
  });
}

function generarCierre(e) {
  e.preventDefault();

  var fecha = document.getElementById('cierre-fecha').value;
  var usuario = document.getElementById('cierre-usuario').value;

  if (!fecha || !usuario) {
    Swal.fire('Error', 'Debe seleccionar fecha y usuario', 'warning');
    return;
  }

  // Guardar para uso posterior en PDF
  cierreFechaActual = fecha;
  cierreUsuarioActual = usuario;

  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(function (response) {
      hideGlobalSpinner();

      if (response.success) {
        mostrarResultadoCierre(fecha, usuario, response);
      } else {
        Swal.fire('Error', response.message || 'No se pudo generar el cierre', 'error');
      }
    })
    .withFailureHandler(handleError)
    .getCierreCaja(fecha, usuario);
}

function mostrarResultadoCierre(fecha, usuarioCorreo, data) {
  // Obtener nombre del usuario
  var nombreUsuario = usuarioCorreo;
  var usuarioObj = globalUsuarios.find(u => u.CORREO === usuarioCorreo);
  if (usuarioObj) {
    nombreUsuario = usuarioObj.NOMBRE_USUARIO;
  }

  // Formatear fecha
  var fechaObj = new Date(fecha);
  var fechaFormateada = fechaObj.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // Hora actual del cierre
  var horaActual = new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  // Llenar datos
  document.getElementById('cierre-res-fecha').innerText = fechaFormateada;
  document.getElementById('cierre-res-usuario').innerText = usuarioCorreo;
  document.getElementById('cierre-res-cajero').innerText = nombreUsuario;
  document.getElementById('cierre-res-hora').innerText = horaActual;

  // Uniformes
  document.getElementById('cierre-res-uni-efectivo').innerText = data.uniEfectivo.toLocaleString();
  document.getElementById('cierre-res-uni-tarjeta').innerText = data.uniTarjeta.toLocaleString();
  document.getElementById('cierre-res-uni-transferencia').innerText = data.uniTransferencia.toLocaleString();
  document.getElementById('cierre-res-uni-total').innerText = data.totalUniformes.toLocaleString();

  // Misceláneas
  document.getElementById('cierre-res-misc-efectivo').innerText = data.miscEfectivo.toLocaleString();
  document.getElementById('cierre-res-misc-tarjeta').innerText = data.miscTarjeta.toLocaleString();
  document.getElementById('cierre-res-misc-transferencia').innerText = data.miscTransferencia.toLocaleString();
  document.getElementById('cierre-res-misc-total').innerText = data.totalMisc.toLocaleString();

  // Helados Descubridor
  document.getElementById('cierre-res-helado-efectivo').innerText = data.heladoEfectivo.toLocaleString();
  document.getElementById('cierre-res-helado-tarjeta').innerText = data.heladoTarjeta.toLocaleString();
  document.getElementById('cierre-res-helado-transferencia').innerText = data.heladoTransferencia.toLocaleString();
  document.getElementById('cierre-res-helado-total').innerText = data.totalHelados.toLocaleString();

  // Total general
  document.getElementById('cierre-res-total').innerText = data.total.toLocaleString();

  // Mostrar resultado
  document.getElementById('cierre-resultado').style.display = 'block';

  // Scroll al resultado
  document.getElementById('cierre-resultado').scrollIntoView({ behavior: 'smooth' });
}

function descargarPDFCierre() {
  if (!cierreFechaActual || !cierreUsuarioActual) {
    Swal.fire('Error', 'Debe generar un cierre primero', 'warning');
    return;
  }

  Swal.fire({
    title: 'Generando PDF...',
    text: 'Por favor espere',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  google.script.run
    .withSuccessHandler(function (response) {
      Swal.close();

      if (response.success) {
        // Descargar PDF
        var link = document.createElement('a');
        link.href = "data:application/pdf;base64," + response.base64;
        link.download = response.fileName;
        link.click();

        Swal.fire({
          icon: 'success',
          title: 'PDF Descargado',
          text: 'El archivo se ha descargado exitosamente',
          timer: 2000,
          showConfirmButton: false
        });
      } else {
        Swal.fire('Error', response.message || 'No se pudo generar el PDF', 'error');
      }
    })
    .withFailureHandler(handleError)
    .generarPDFCierre(cierreFechaActual, cierreUsuarioActual);
}

/* ===================================================
   DESCARGAR PDF CONSOLIDADO POR ARTÍCULOS
   =================================================== */
function descargarPDFConsolidado() {
  if (!cierreFechaActual || !cierreUsuarioActual) {
    Swal.fire('Error', 'Debe generar un cierre primero', 'warning');
    return;
  }

  Swal.fire({
    title: 'Generando PDF Consolidado...',
    text: 'Por favor espere',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  google.script.run
    .withSuccessHandler(function (response) {
      Swal.close();

      if (response.success) {
        // Descargar PDF
        var link = document.createElement('a');
        link.href = "data:application/pdf;base64," + response.base64;
        link.download = response.fileName;
        link.click();

        Swal.fire({
          icon: 'success',
          title: 'PDF Consolidado Descargado',
          text: 'El archivo se ha descargado exitosamente',
          timer: 2000,
          showConfirmButton: false
        });
      } else {
        Swal.fire('Error', response.message || 'No se pudo generar el PDF consolidado', 'error');
      }
    })
    .withFailureHandler(handleError)
    .generarPDFConsolidado(cierreFechaActual, cierreUsuarioActual);
}

/* ===================================================
   DESCARGAR PDF DE ARTÍCULOS SIN ENTREGAR
   =================================================== */
function descargarPDFSinEntregar() {
  if (!cierreFechaActual || !cierreUsuarioActual) {
    Swal.fire('Error', 'Debe generar un cierre primero', 'warning');
    return;
  }

  Swal.fire({
    title: 'Generando Reporte de Pendientes...',
    text: 'Por favor espere',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  google.script.run
    .withSuccessHandler(function (response) {
      Swal.close();

      if (response.success) {
        // Descargar PDF
        var link = document.createElement('a');
        link.href = "data:application/pdf;base64," + response.base64;
        link.download = response.fileName;
        link.click();

        Swal.fire({
          icon: 'success',
          title: 'PDF de Pendientes Descargado',
          text: 'El archivo se ha descargado exitosamente',
          timer: 2000,
          showConfirmButton: false
        });
      } else {
        Swal.fire('Información', response.message, 'info');
      }
    })
    .withFailureHandler(handleError)
    .generarPDFSinEntregar(cierreFechaActual, cierreUsuarioActual);
}

/* ===================================================
   DESCARGAR PDF CONSOLIDADO TOTAL PENDIENTES
   =================================================== */
function descargarPDFConsolidadoPendientes() {
  Swal.fire({
    title: 'Generando Consolidado Total...',
    text: 'Por favor espere',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  google.script.run
    .withSuccessHandler(function (response) {
      Swal.close();

      if (response.success) {
        // Descargar PDF
        var link = document.createElement('a');
        link.href = "data:application/pdf;base64," + response.base64;
        link.download = response.fileName;
        link.click();

        Swal.fire({
          icon: 'success',
          title: 'PDF Consolidado Descargado',
          text: 'Se descargó el consolidado total de pendientes',
          timer: 2000,
          showConfirmButton: false
        });
      } else {
        Swal.fire('Información', response.message, 'info');
      }
    })
    .withFailureHandler(handleError)
    .generarPDFConsolidadoPendientes();
}


/* ===================================================
   DESCARGAR PDF CONSOLIDADO POR RANGO DE FECHAS (TODOS LOS USUARIOS)
   =================================================== */
async function descargarPDFConsolidadoRango() {
  // Solicitar rango de fechas con SweetAlert2
  const { value: fechas } = await Swal.fire({
    title: 'Consolidado por Rango de Fechas',
    html: `
      <div style="text-align: left; padding: 10px;">
        <p style="margin-bottom: 15px; color: #666; font-size: 0.95em;">
          <span class="material-icons" style="vertical-align: middle; color: #1abc9c;">info</span>
          Este reporte consolida las ventas de <strong>TODOS los usuarios</strong> en el rango de fechas seleccionado.
        </p>
        
        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #2c3e50;">
            📅 Fecha Inicial:
          </label>
          <input type="date" id="fecha-inicio-rango" class="swal2-input" 
                 style="width: 100%; margin: 0; padding: 10px; font-size: 1.1em;">
        </div>
        
        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #2c3e50;">
            📅 Fecha Final:
          </label>
          <input type="date" id="fecha-fin-rango" class="swal2-input" 
                 style="width: 100%; margin: 0; padding: 10px; font-size: 1.1em;">
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Generar Reporte',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#1abc9c',
    width: '450px',
    preConfirm: () => {
      var fechaInicio = document.getElementById('fecha-inicio-rango').value;
      var fechaFin = document.getElementById('fecha-fin-rango').value;

      if (!fechaInicio || !fechaFin) {
        Swal.showValidationMessage('Debe seleccionar ambas fechas');
        return false;
      }

      // Validar que fecha inicio no sea mayor a fecha fin
      if (new Date(fechaInicio) > new Date(fechaFin)) {
        Swal.showValidationMessage('La fecha inicial no puede ser mayor a la fecha final');
        return false;
      }

      return {
        fechaInicio: fechaInicio,
        fechaFin: fechaFin
      };
    }
  });

  if (fechas) {
    Swal.fire({
      title: 'Generando Consolidado...',
      html: `
        <p>Procesando ventas del período:</p>
        <p style="font-weight: bold; color: #1abc9c;">${fechas.fechaInicio} al ${fechas.fechaFin}</p>
      `,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    google.script.run
      .withSuccessHandler(function (response) {
        Swal.close();

        if (response.success) {
          // Descargar PDF
          var link = document.createElement('a');
          link.href = "data:application/pdf;base64," + response.base64;
          link.download = response.fileName;
          link.click();

          Swal.fire({
            icon: 'success',
            title: 'Reporte Generado',
            html: `
              <p>El consolidado de ventas ha sido generado exitosamente.</p>
              <p style="color: #666; font-size: 0.9em; margin-top: 10px;">
                Período: <strong>${fechas.fechaInicio}</strong> al <strong>${fechas.fechaFin}</strong>
              </p>
            `,
            timer: 3000,
            showConfirmButton: true
          });
        } else {
          Swal.fire('Información', response.message, 'info');
        }
      })
      .withFailureHandler(handleError)
      .generarPDFConsolidadoRango(fechas.fechaInicio, fechas.fechaFin);
  }



  /* ===================================================
     UTILIDADES DE CACHÉ
     =================================================== */
  function invalidateCache(type) {
    if (type === 'clientes') {
      cache.clientes = null;
      cache.timestamp.clientes = null;
      cache.loaded.clientes = false;
    } else if (type === 'articulos') {
      cache.articulos = null;
      cache.timestamp.articulos = null;
      cache.loaded.articulos = false;
    }
  }

  function invalidateAllCache() {
    cache = {
      clientes: null,
      articulos: null,
      usuarios: null,
      timestamp: { clientes: null, articulos: null, usuarios: null },
      loaded: { clientes: false, articulos: false, usuarios: false, config: false }
    };
  }

}
/* ===================================================
   MÓDULO: GESTIÓN DE PENDIENTES
   =================================================== */
var globalPendientes = [];

function loadPendientes() {
  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(handlePendientesData)
    .withFailureHandler(handleError)
    .getPendientes();
}

function handlePendientesData(response) {
  hideGlobalSpinner();

  if (response.success) {
    globalPendientes = response.data;
    renderPendientesTable(response.data);

    // Actualizar badge
    document.getElementById('badge-pendientes').innerText = response.data.length;
  } else {
    Swal.fire('Error', response.message || 'No se pudieron cargar los pendientes', 'error');
  }
}

function renderPendientesTable(data) {
  var tbody = document.querySelector('#pendientes-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="color:#999;">No hay artículos pendientes de entrega</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  data.forEach(function (row, idx) {
    var tr = document.createElement('tr');

    // Determinar color de fondo según estado
    var rowStyle = '';
    if (row.ENTREGADO === 'SIN ENTREGAR') {
      rowStyle = 'background: #fff5f5;';
    }

    tr.setAttribute('style', rowStyle);

    tr.innerHTML = `
      <td>${row.No_Voucher_Venta || '-'}</td>
      <td>${row.Fecha_Hora || '-'}</td>
      <td>${row.Cliente || '-'}</td>
      <td>${row.Articulo || '-'}</td>
      <td>${row.Talla || '-'}</td>
      <td style="text-align:center;">${row.Cantidad || '-'}</td>
      <td style="text-align:right;">$${Number(row.P_Venta || 0).toLocaleString()}</td>
      <td style="text-align:right;">$${Number(row.Subtotal || 0).toLocaleString()}</td>
      <td>${row.Usuario || '-'}</td>
      <td style="text-align:center;">
        <select onchange="actualizarEstadoEntrega(${idx}, this.value)" 
                style="padding: 6px 10px; border-radius: 6px; border: 2px solid ${row.ENTREGADO === 'SIN ENTREGAR' ? '#e74c3c' : '#27ae60'}; 
                       background: ${row.ENTREGADO === 'SIN ENTREGAR' ? '#fee' : '#e8f8f5'}; 
                       color: ${row.ENTREGADO === 'SIN ENTREGAR' ? '#c0392b' : '#229954'}; 
                       font-weight: 600; cursor: pointer;">
          <option value="SIN ENTREGAR" ${row.ENTREGADO === 'SIN ENTREGAR' ? 'selected' : ''}>SIN ENTREGAR</option>
          <option value="ENTREGADO(A)" ${row.ENTREGADO === 'ENTREGADO(A)' ? 'selected' : ''}>ENTREGADO(A)</option>
        </select>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function actualizarEstadoEntrega(idx, nuevoEstado) {
  var registro = globalPendientes[idx];

  if (!registro) {
    Swal.fire('Error', 'No se encontró el registro', 'error');
    return;
  }

  // ✅ NUEVA LÓGICA: Mensaje diferente si se marca como ENTREGADO
  var mensajeAdicional = '';
  if (nuevoEstado === 'ENTREGADO(A)') {
    mensajeAdicional = `
      <hr style="margin:15px 0;">
      <p style="font-size:0.9em; color:#27ae60; font-weight:600;">
        ℹ️ Se generará un voucher de entrega y se actualizará
      </p>
    `;
  }

  Swal.fire({
    title: '¿Confirma Entrega?',
    html: `
      <p>¿Desea cambiar el estado de entrega a:</p>
      <p style="font-size:1.2em; font-weight:bold; color: ${nuevoEstado === 'SIN ENTREGAR' ? '#e74c3c' : '#27ae60'};">
        ${nuevoEstado}
      </p>
      <hr>
      <p style="font-size:0.9em; color:#666;">
        <strong>Artículo:</strong> ${registro.Articulo}<br>
        <strong>Cliente:</strong> ${registro.Cliente}
      </p>
      ${mensajeAdicional}
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, cambiar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      showGlobalSpinner();

      google.script.run
        .withSuccessHandler(function (response) {
          hideGlobalSpinner();

          if (response.success) {
            // ✅ Si se generó PDF, descargarlo
            if (response.pdfBase64 && response.fileName) {
              // Descargar voucher de entrega
              var link = document.createElement('a');
              link.href = "data:application/pdf;base64," + response.pdfBase64;
              link.download = response.fileName;
              link.click();

              Swal.fire({
                icon: 'success',
                title: 'Entrega Registrada',
                html: `
                  <p>El estado de entrega ha sido actualizado correctamente</p>
                  <hr>
                  <p style="color:#27ae60; font-weight:600;">
                    ✅ Voucher de entrega descargado<br>
                    ✅ Registro guardado en hoja ENTREGAS
                  </p>
                `,
                timer: 3000,
                showConfirmButton: true
              });
            } else {
              Swal.fire({
                icon: 'success',
                title: 'Estado Actualizado',
                text: response.message || 'El estado de entrega ha sido actualizado correctamente',
                timer: 2000,
                showConfirmButton: false
              });
            }

            // Recargar la tabla
            loadPendientes();
          } else {
            Swal.fire('Error', response.message, 'error');
            // Revertir el select
            loadPendientes();
          }
        })
        .withFailureHandler(function (error) {
          handleError(error);
          loadPendientes();
        })
        .actualizarEstadoEntrega(registro.No_Voucher_Venta, registro.Fecha_Hora, registro.Articulo, nuevoEstado);
    } else {
      // Recargar para revertir el cambio visual
      loadPendientes();
    }
  });
}


function filterPendientes() {
  var txt = document.getElementById('pendientes-search').value.toLowerCase();

  if (!txt) {
    renderPendientesTable(globalPendientes);
    return;
  }

  var filtered = globalPendientes.filter(function (p) {
    return String(p.No_Voucher_Venta || '').toLowerCase().includes(txt) ||
      String(p.Cliente || '').toLowerCase().includes(txt) ||
      String(p.Articulo || '').toLowerCase().includes(txt);
  });

  renderPendientesTable(filtered);
}


/* ===================================================
   MÓDULO: ENTREGAS REALIZADAS
   =================================================== */
var globalEntregas = [];

function loadEntregas() {
  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(handleEntregasData)
    .withFailureHandler(handleError)
    .getEntregas();
}

function handleEntregasData(response) {
  hideGlobalSpinner();

  if (response.success) {
    globalEntregas = response.data;
    renderEntregasTable(response.data);

    // Calcular total
    var total = response.data.reduce(function (sum, item) {
      return sum + (Number(item.Subtotal_E) || 0);
    }, 0);

    // Actualizar contadores
    document.getElementById('entregas-count').innerText = response.data.length;
    document.getElementById('entregas-total').innerText = '$' + total.toLocaleString();
  } else {
    Swal.fire('Error', response.message || 'No se pudieron cargar las entregas', 'error');
  }
}

function renderEntregasTable(data) {
  var tbody = document.querySelector('#entregas-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:#999; padding: 40px;">No hay entregas registradas</td></tr>';
    document.getElementById('entregas-count').innerText = '0';
    document.getElementById('entregas-total').innerText = '$0';
    return;
  }

  tbody.innerHTML = '';

  data.forEach(function (row, idx) {
    var tr = document.createElement('tr');

    tr.innerHTML = `
      <td style="font-weight: 600; color: #3498db;">${row.No_Voucher_Venta_E || '-'}</td>
      <td>${row.Fecha_Hora_E || '-'}</td>
      <td style="font-weight: 500;">${row.Cliente_E || '-'}</td>
      <td>${row.Articulo_E || '-'}</td>
      <td style="text-align: center; font-weight: 600;">${row.Talla_E || '-'}</td>
      <td style="text-align: center; font-weight: 600; color: #27ae60;">${row.Cantidad_E || '-'}</td>
      <td style="text-align: right; color: #7f8c8d;">$${Number(row.P_Venta_E || 0).toLocaleString()}</td>
      <td style="text-align: right; font-weight: 700; color: #27ae60;">$${Number(row.Subtotal_E || 0).toLocaleString()}</td>
      <td style="color: #34495e;">${row.Usuario_E || '-'}</td>
    `;

    tbody.appendChild(tr);
  });
}

function filterEntregas() {
  var txt = document.getElementById('entregas-search').value.toLowerCase();

  if (!txt) {
    renderEntregasTable(globalEntregas);
    return;
  }

  var filtered = globalEntregas.filter(function (e) {
    return String(e.No_Voucher_Venta_E || '').toLowerCase().includes(txt) ||
      String(e.Cliente_E || '').toLowerCase().includes(txt) ||
      String(e.Articulo_E || '').toLowerCase().includes(txt) ||
      String(e.Usuario_E || '').toLowerCase().includes(txt);
  });

  renderEntregasTable(filtered);

  // Actualizar contador filtrado
  document.getElementById('entregas-count').innerText = filtered.length;

  // Calcular total filtrado
  var totalFiltrado = filtered.reduce(function (sum, item) {
    return sum + (Number(item.Subtotal_E) || 0);
  }, 0);
  document.getElementById('entregas-total').innerText = '$' + totalFiltrado.toLocaleString();
}


/* ===================================================
   MÓDULO: DEVOLUCIONES
   =================================================== */
var globalVentasDevolucion = [];
var carroDevolucion = [];
var voucherDevolucionActual = null;

function loadVentasParaDevoluciones() {
  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(handleVentasDevolucionData)
    .withFailureHandler(handleError)
    .getVentasParaDevoluciones();
}

function handleVentasDevolucionData(response) {
  hideGlobalSpinner();

  if (response.success) {
    globalVentasDevolucion = response.data;
    renderVentasDevolucionTable(response.data);
  } else {
    Swal.fire('Error', response.message || 'No se pudieron cargar las ventas', 'error');
  }
}

function renderVentasDevolucionTable(data) {
  var tbody = document.querySelector('#ventas-devolucion-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="color:#999; padding: 40px;">No hay ventas registradas</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  data.forEach(function (row, idx) {
    var tr = document.createElement('tr');

    // Solo mostrar filas con artículos (no las de resumen de pago)
    if (!row.Articulo || row.Articulo === '') {
      return;
    }

    // ✅ CORRECCIÓN: Encontrar el índice REAL en globalVentasDevolucion
    // Esto evita el desajuste cuando hay filas de resumen o cuando se filtra
    var realIndex = globalVentasDevolucion.findIndex(function (item) {
      return item.No_Voucher_Venta === row.No_Voucher_Venta &&
        item.Articulo === row.Articulo &&
        item.Talla === row.Talla &&
        item.Fecha_Hora === row.Fecha_Hora &&
        item.Cliente === row.Cliente;
    });

    // Si no se encuentra (caso improbable), usar -1 para evitar errores
    if (realIndex === -1) {
      console.warn('⚠️ Registro no encontrado en globalVentasDevolucion:', row);
      return;
    }

    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" id="chk-venta-dev-${realIndex}" 
               onchange="seleccionarVentaParaDevolucion(${realIndex})"
               style="width: 20px; height: 20px; cursor: pointer;">
      </td>
      <td style="font-weight: 600; color: #3498db;">${row.No_Voucher_Venta || '-'}</td>
      <td>${row.Fecha_Hora || '-'}</td>
      <td style="font-weight: 500;">${row.Cliente || '-'}</td>
      <td>${row.Articulo || '-'}</td>
      <td style="text-align: center;">${row.Talla || '-'}</td>
      <td style="text-align: center; font-weight: 600;">${row.Cantidad || '-'}</td>
      <td style="text-align: right;">$${Number(row.P_Venta || 0).toLocaleString()}</td>
      <td style="text-align: right; font-weight: 600; color: #27ae60;">$${Number(row.Subtotal || 0).toLocaleString()}</td>
      <td>${row.Usuario || '-'}</td>
    `;

    tbody.appendChild(tr);
  });
}



function seleccionarVentaParaDevolucion(idx) {
  var checkbox = document.getElementById('chk-venta-dev-' + idx);
  var ventaSeleccionada = globalVentasDevolucion[idx];

  if (!ventaSeleccionada || !ventaSeleccionada.Articulo) {
    return;
  }

  if (checkbox.checked) {
    // Validar si ya hay un voucher diferente en el carro
    if (voucherDevolucionActual && voucherDevolucionActual !== ventaSeleccionada.No_Voucher_Venta) {
      Swal.fire({
        icon: 'warning',
        title: 'Voucher Diferente',
        text: 'Ya tiene artículos de otro voucher en el carro. Por favor, complete la devolución actual o vacíe el carro.',
        confirmButtonText: 'Entendido'
      });
      checkbox.checked = false;
      return;
    }

    // Agregar SOLO este artículo al carro
    agregarArticuloAlCarroDevolucion(ventaSeleccionada);
    voucherDevolucionActual = ventaSeleccionada.No_Voucher_Venta;

  } else {
    // Si desmarca, remover este artículo del carro
    removerArticuloDelCarroDevolucion(ventaSeleccionada);
  }
}

function agregarArticuloAlCarroDevolucion(articulo) {
  // Validar que no esté duplicado
  var existe = carroDevolucion.find(function (item) {
    return item.No_Voucher_Venta === articulo.No_Voucher_Venta &&
      item.Articulo === articulo.Articulo &&
      item.Talla === articulo.Talla &&
      item.Fecha_Hora === articulo.Fecha_Hora;
  });

  if (existe) {
    Swal.fire({
      icon: 'info',
      title: 'Artículo ya agregado',
      text: 'Este artículo ya está en el carro de devolución',
      timer: 2000,
      showConfirmButton: false
    });
    return;
  }

  // Agregar al carro (guardando cantidad original para validaciones)
  carroDevolucion.push({
    No_Voucher_Venta: articulo.No_Voucher_Venta,
    Fecha_Hora: articulo.Fecha_Hora,
    Cliente: articulo.Cliente,
    Articulo: articulo.Articulo,
    Talla: articulo.Talla,
    Cantidad: articulo.Cantidad,
    CantidadOriginal: articulo.Cantidad,  // Guardar cantidad original para validar máximo
    P_Venta: articulo.P_Venta,
    Subtotal: articulo.Subtotal,
    Usuario: articulo.Usuario
  });


  renderCarroDevolucion();

  Swal.fire({
    icon: 'success',
    title: 'Artículo Agregado',
    html: `
      <p><strong>${articulo.Articulo}</strong> (Talla ${articulo.Talla})</p>
      <p style="color: #27ae60; font-weight: 600;">✅ Agregado al carro</p>
    `,
    timer: 1500,
    showConfirmButton: false
  });
}

function removerArticuloDelCarroDevolucion(articulo) {
  // Buscar y remover el artículo
  var index = carroDevolucion.findIndex(function (item) {
    return item.No_Voucher_Venta === articulo.No_Voucher_Venta &&
      item.Articulo === articulo.Articulo &&
      item.Talla === articulo.Talla &&
      item.Fecha_Hora === articulo.Fecha_Hora;
  });

  if (index !== -1) {
    carroDevolucion.splice(index, 1);
    renderCarroDevolucion();

    Swal.fire({
      icon: 'info',
      title: 'Artículo Removido',
      timer: 1000,
      showConfirmButton: false
    });
  }
}





function renderCarroDevolucion() {
  var tbody = document.querySelector('#carro-devolucion-table tbody');

  if (carroDevolucion.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="color:#999; padding: 40px;">Carro vacío - Seleccione artículos de la tabla superior</td></tr>';
    document.getElementById('devolucion-total').innerText = '0';
    document.getElementById('btn-generar-devolucion').disabled = true;
    voucherDevolucionActual = null;
    return;
  }

  tbody.innerHTML = '';
  var total = 0;

  carroDevolucion.forEach(function (item, idx) {
    // Calcular subtotal basado en cantidad actual (puede haber sido editada)
    var cantidadActual = Number(item.Cantidad || 0);
    var precioUnitario = Number(item.P_Venta || 0);
    var subtotalCalculado = cantidadActual * precioUnitario;

    // Actualizar subtotal en el objeto
    item.Subtotal = subtotalCalculado;

    total += subtotalCalculado;

    var tr = document.createElement('tr');
    tr.style.background = '#fff9f9';

    // Determinar si la cantidad es editable (cantidad original > 1)
    var cantidadOriginal = Number(item.CantidadOriginal || item.Cantidad || 0);
    var cantidadHTML = '';

    if (cantidadOriginal > 1) {
      // Mostrar input editable
      cantidadHTML = `
        <input type="number" 
               id="cant-dev-${idx}" 
               value="${cantidadActual}" 
               min="1" 
               max="${cantidadOriginal}" 
               onchange="actualizarCantidadDevolucion(${idx}, this.value, ${cantidadOriginal})"
               style="width: 60px; text-align: center; font-weight: 700; color: #c0392b; 
                      border: 2px solid #e74c3c; border-radius: 6px; padding: 5px;
                      background: #fff5f5;">
        <div style="font-size: 0.75em; color: #888; margin-top: 3px;">Máx: ${cantidadOriginal}</div>
      `;
    } else {
      // Cantidad fija (no editable)
      cantidadHTML = `<span style="font-weight: 700; color: #e74c3c;">${cantidadActual}</span>`;
    }


    // ✅ CORRECCIÓN: Mostrar fecha/hora actual y usuario activo (quien hace la devolución)
    var fechaHoraActual = new Date().toLocaleString('es-CO');
    var usuarioDevolucion = currentUser || 'Sistema';

    tr.innerHTML = `
      <td style="font-weight: 600; color: #e74c3c;">${item.No_Voucher_Venta || '-'}</td>
      <td style="font-size: 0.9em; color: #27ae60; font-weight: 600;">${fechaHoraActual}</td>
      <td style="font-weight: 500;">${item.Cliente || '-'}</td>
      <td>${item.Articulo || '-'}</td>
      <td style="text-align: center; font-weight: 600;">${item.Talla || '-'}</td>
      <td style="text-align: center;">${cantidadHTML}</td>
      <td style="text-align: right;">$${precioUnitario.toLocaleString()}</td>
      <td style="text-align: right; font-weight: 700; color: #c0392b;" id="subtotal-dev-${idx}">$${subtotalCalculado.toLocaleString()}</td>
      <td style="font-size: 0.85em; color: #27ae60; font-weight: 600;">${usuarioDevolucion}</td>
      <td style="text-align: center;">
        <button class="btn-icon" onclick="eliminarDelCarroDevolucion(${idx})" title="Eliminar">
          <span class="material-icons" style="color: #e74c3c; font-weight: bold;">delete_forever</span>
        </button>
      </td>
    `;


    tbody.appendChild(tr);
  });

  document.getElementById('devolucion-total').innerText = total.toLocaleString();
  document.getElementById('btn-generar-devolucion').disabled = false;
}

function actualizarCantidadDevolucion(idx, nuevaCantidad, cantidadMaxima) {
  var cantidad = parseInt(nuevaCantidad);

  // Validar que la cantidad sea válida
  if (isNaN(cantidad) || cantidad < 1) {
    Swal.fire({
      icon: 'warning',
      title: 'Cantidad inválida',
      text: 'La cantidad mínima es 1',
      timer: 2000,
      showConfirmButton: false
    });
    // Restaurar valor mínimo
    document.getElementById('cant-dev-' + idx).value = 1;
    cantidad = 1;
  }

  if (cantidad > cantidadMaxima) {
    Swal.fire({
      icon: 'warning',
      title: 'Cantidad excedida',
      text: 'La cantidad máxima a devolver es ' + cantidadMaxima,
      timer: 2000,
      showConfirmButton: false
    });
    // Restaurar valor máximo
    document.getElementById('cant-dev-' + idx).value = cantidadMaxima;
    cantidad = cantidadMaxima;
  }

  // Actualizar cantidad en el carro
  carroDevolucion[idx].Cantidad = cantidad;

  // Recalcular subtotal
  var precioUnitario = Number(carroDevolucion[idx].P_Venta || 0);
  var nuevoSubtotal = cantidad * precioUnitario;
  carroDevolucion[idx].Subtotal = nuevoSubtotal;

  // Actualizar subtotal en la celda
  document.getElementById('subtotal-dev-' + idx).innerText = '$' + nuevoSubtotal.toLocaleString();

  // Recalcular total general
  var totalGeneral = 0;
  carroDevolucion.forEach(function (item) {
    totalGeneral += Number(item.Subtotal || 0);
  });
  document.getElementById('devolucion-total').innerText = totalGeneral.toLocaleString();

  // Feedback visual
  Swal.fire({
    icon: 'info',
    title: 'Cantidad actualizada',
    html: `<p>Se devolverán <strong>${cantidad}</strong> unidad(es) de <strong>${carroDevolucion[idx].Articulo}</strong></p>`,
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000
  });
}

function eliminarDelCarroDevolucion(idx) {
  Swal.fire({
    title: '¿Eliminar Artículo?',
    text: 'Se eliminará este artículo del carro de devolución',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#e74c3c'
  }).then((result) => {
    if (result.isConfirmed) {
      carroDevolucion.splice(idx, 1);
      renderCarroDevolucion();

      Swal.fire({
        icon: 'success',
        title: 'Artículo Eliminado',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}


function filterVentasDevolucion() {
  var txt = document.getElementById('ventas-devolucion-search').value.toLowerCase();

  if (!txt) {
    renderVentasDevolucionTable(globalVentasDevolucion);
    return;
  }

  var filtered = globalVentasDevolucion.filter(function (v) {
    return String(v.No_Voucher_Venta || '').toLowerCase().includes(txt) ||
      String(v.Cliente || '').toLowerCase().includes(txt) ||
      String(v.Articulo || '').toLowerCase().includes(txt) ||
      String(v.Usuario || '').toLowerCase().includes(txt) ||
      String(v.Fecha_Hora || '').toLowerCase().includes(txt);
  });

  renderVentasDevolucionTable(filtered);
}

function generarVoucherDevolucion() {
  if (carroDevolucion.length === 0) {
    Swal.fire('Error', 'El carro de devolución está vacío', 'warning');
    return;
  }

  // Obtener datos del primer artículo (cliente y voucher son iguales para todos)
  var primerArticulo = carroDevolucion[0];

  Swal.fire({
    title: '¿Confirmar Devolución?',
    html: `
      <div style="text-align: left; padding: 15px;">
        <p><strong>Voucher Original:</strong> ${primerArticulo.No_Voucher_Venta}</p>
        <p><strong>Cliente:</strong> ${primerArticulo.Cliente}</p>
        <p><strong>Artículos a devolver:</strong> ${carroDevolucion.length}</p>
        <hr>
        <p style="color: #e74c3c; font-weight: bold;">
          ⚠️ Esta acción:
        </p>
        <ul style="text-align: left; color: #555;">
          <li>Generará un voucher de devolución</li>
          <li>Registrará la devolución en el sistema</li>
          <li>Devolverá los artículos al inventario</li>
        </ul>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, procesar devolución',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#27ae60',
    cancelButtonColor: '#95a5a6'
  }).then((result) => {
    if (result.isConfirmed) {
      procesarDevolucionCompleta();
    }
  });
}

function procesarDevolucionCompleta() {
  if (!currentUser) {
    Swal.fire('Error', 'No hay sesión activa. Por favor recargue la página.', 'error');
    return;
  }

  Swal.fire({
    title: 'Procesando Devolución...',
    text: 'Por favor espere',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  console.log('📤 DEVOLUCIÓN - Enviando con usuario:', currentUser);
  console.log('📦 Artículos a devolver:', carroDevolucion.length);

  google.script.run
    .withSuccessHandler(function (response) {
      if (response.success) {
        Swal.fire({
          icon: 'success',
          title: 'Devolución Registrada',
          html: `
            <p>${response.message}</p>
            <hr>
            <p style="color: #27ae60; font-weight: 600;">
              ✅ Voucher generado<br>
              ✅ Inventario actualizado<br>
              ✅ Registros guardados
            </p>
          `,
          confirmButtonText: 'Descargar Voucher'
        }).then(() => {
          // Descargar PDF
          var link = document.createElement('a');
          link.href = "data:application/pdf;base64," + response.pdfBase64;
          link.download = response.fileName;
          link.click();

          // Limpiar carro
          carroDevolucion = [];
          voucherDevolucionActual = null;
          renderCarroDevolucion();

          // Recargar ventas
          loadVentasParaDevoluciones();

          // Invalidar caché de artículos para refrescar inventario
          invalidateCache('articulos');
        });
      } else {
        Swal.fire('Error', response.message, 'error');
      }
    })
    .withFailureHandler(function (error) {
      handleError(error);
    })
    .procesarDevolucion(carroDevolucion, currentUser);
}

/* ===================================================
   MÓDULO: HISTORIAL DE DEVOLUCIONES APLICADAS
   =================================================== */
var globalDevolucionesAplicadas = [];

function loadDevolucionesAplicadas() {
  showGlobalSpinner();
  google.script.run
    .withSuccessHandler(handleDevolucionesAplicadasData)
    .withFailureHandler(handleError)
    .getDevoluciones();
}

function handleDevolucionesAplicadasData(response) {
  hideGlobalSpinner();

  if (response.success) {
    globalDevolucionesAplicadas = response.data;
    renderDevolucionesAplicadasTable(response.data);

    // Calcular total
    var total = response.data.reduce(function (sum, item) {
      return sum + (Number(item.Subtotal_D) || 0);
    }, 0);

    // Actualizar contadores
    document.getElementById('devoluciones-aplicadas-count').innerText = response.data.length;
    document.getElementById('devoluciones-aplicadas-total').innerText = '$' + total.toLocaleString();
  } else {
    Swal.fire('Error', response.message || 'No se pudieron cargar las devoluciones', 'error');
  }
}

function renderDevolucionesAplicadasTable(data) {
  var tbody = document.querySelector('#devoluciones-aplicadas-table tbody');

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="color:#999; padding: 40px;">No hay devoluciones registradas</td></tr>';
    document.getElementById('devoluciones-aplicadas-count').innerText = '0';
    document.getElementById('devoluciones-aplicadas-total').innerText = '$0';
    return;
  }

  tbody.innerHTML = '';

  data.forEach(function (row, idx) {
    var tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="voucher-cell">${row.No_Voucher_Venta_D || '-'}</td>
      <td class="fecha-cell">${row.Fecha_Hora_D || '-'}</td>
      <td class="cliente-cell">${row.Cliente_D || '-'}</td>
      <td class="articulo-cell">${row.Articulo_D || '-'}</td>
      <td class="talla-cell">${row.Talla_D || '-'}</td>
      <td class="cantidad-cell">${row.Cantidad_D || '-'}</td>
      <td class="precio-cell">$${Number(row.P_Venta_D || 0).toLocaleString()}</td>
      <td class="subtotal-cell">$${Number(row.Subtotal_D || 0).toLocaleString()}</td>
      <td class="usuario-cell">${row.Usuario_D || '-'}</td>
    `;

    tbody.appendChild(tr);
  });
}

function filterDevolucionesAplicadas() {
  var txt = document.getElementById('devoluciones-aplicadas-search').value.toLowerCase();

  if (!txt) {
    renderDevolucionesAplicadasTable(globalDevolucionesAplicadas);
    // Restaurar totales
    var total = globalDevolucionesAplicadas.reduce(function (sum, item) {
      return sum + (Number(item.Subtotal_D) || 0);
    }, 0);
    document.getElementById('devoluciones-aplicadas-count').innerText = globalDevolucionesAplicadas.length;
    document.getElementById('devoluciones-aplicadas-total').innerText = '$' + total.toLocaleString();
    return;
  }

  var filtered = globalDevolucionesAplicadas.filter(function (d) {
    return String(d.No_Voucher_Venta_D || '').toLowerCase().includes(txt) ||
      String(d.Cliente_D || '').toLowerCase().includes(txt) ||
      String(d.Articulo_D || '').toLowerCase().includes(txt) ||
      String(d.Usuario_D || '').toLowerCase().includes(txt) ||
      String(d.Fecha_Hora_D || '').toLowerCase().includes(txt);
  });

  renderDevolucionesAplicadasTable(filtered);

  // Actualizar contador filtrado
  document.getElementById('devoluciones-aplicadas-count').innerText = filtered.length;

  // Calcular total filtrado
  var totalFiltrado = filtered.reduce(function (sum, item) {
    return sum + (Number(item.Subtotal_D) || 0);
  }, 0);
  document.getElementById('devoluciones-aplicadas-total').innerText = '$' + totalFiltrado.toLocaleString();
}


/* ===================================================
   SPINNERS Y UX
   =================================================== */




/* ===================================================
   SPINNERS Y UX
   =================================================== */
function showGlobalSpinner() {
  document.getElementById('global-spinner').style.display = 'flex';
}

function hideGlobalSpinner() {
  document.getElementById('global-spinner').style.display = 'none';
}