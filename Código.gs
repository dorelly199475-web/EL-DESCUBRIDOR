var SPREADSHEET_ID = '1_YW8XnNxF_H_2SF1t-yk0JUA6OU1D1TqYjTsvz-gUIU';

function getSpreadsheet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch(e) {}
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('El Descubridor - Gestión')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var functionName = request.functionName;
    var args = request.args || [];
    
    // Ejecutar la función solicitada dinámicamente
    var result = this[functionName].apply(this, args);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getActiveUser() {
  var userProps = PropertiesService.getUserProperties();
  var userEmail = userProps.getProperty('userEmail');
  return userEmail ? userEmail : null;
}

function setActiveUser(email) {
  var userProps = PropertiesService.getUserProperties();
  userProps.setProperty('userEmail', email);
}

function clearActiveUser() {
  var userProps = PropertiesService.getUserProperties();
  userProps.deleteProperty('userEmail');
}

/* ==================================================
   SISTEMA DE CONCURRENCIA ROBUSTA
   ================================================== */

/**
 * Registra problemas de concurrencia para auditoría
 */
function logConcurrencyIssue(operation, error, attempts) {
  try {
    var sheet = getSpreadsheet().getSheetByName('LOGS_CONCURRENCIA');
    if (!sheet) {
      // Crear hoja de logs si no existe
      sheet = getSpreadsheet().insertSheet('LOGS_CONCURRENCIA');
      sheet.appendRow(['Fecha_Hora', 'Usuario', 'Operacion', 'Error', 'Intentos', 'Resuelto']);
    }
    
    var user = getActiveUser() || 'Sistema';
    var timestamp = new Date();
    var resolved = attempts > 1 ? 'Sí (Reintento ' + attempts + ')' : 'No';
    
    sheet.appendRow([
      timestamp,
      user,
      operation,
      error,
      attempts,
      resolved
    ]);
  } catch(e) {
    // Si falla el log, no detener la operación principal
    Logger.log('Error en log de concurrencia: ' + e.toString());
  }
}

/**
 * Adquiere lock con reintentos y backoff exponencial
 * @param {number} maxAttempts - Número máximo de intentos
 * @param {number} timeoutMs - Timeout en milisegundos para cada intento
 * @return {Lock} Lock adquirido o null si falla
 */
function acquireLockWithRetry(maxAttempts, timeoutMs) {
  var lock = LockService.getScriptLock();
  
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var success = lock.tryLock(timeoutMs);
      if (success) {
        return lock;
      }
      
      // Backoff exponencial: esperar más tiempo en cada intento
      var waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Máximo 5 segundos
      Logger.log('Intento ' + attempt + ' de adquirir lock falló. Esperando ' + waitTime + 'ms');
      Utilities.sleep(waitTime);
      
    } catch(e) {
      Logger.log('Error al intentar adquirir lock: ' + e.toString());
      if (attempt === maxAttempts) {
        throw new Error('No se pudo adquirir lock después de ' + maxAttempts + ' intentos');
      }
    }
  }
  
  throw new Error('No se pudo adquirir lock después de ' + maxAttempts + ' intentos');
}

/**
 * Ejecuta una operación con reintentos automáticos en caso de fallo
 * @param {function} operation - Función a ejecutar
 * @param {string} operationName - Nombre de la operación para logs
 * @param {number} maxAttempts - Número máximo de intentos (default: 3)
 * @return {Object} Resultado de la operación
 */
function executeWithRetry(operation, operationName, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  var lastError = null;
  
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      Logger.log(operationName + ' - Intento ' + attempt + ' de ' + maxAttempts);
      var result = operation();
      
      // Si es el primer intento que tiene éxito después de fallos, registrar
      if (attempt > 1) {
        logConcurrencyIssue(operationName, 'Resuelto después de ' + attempt + ' intentos', attempt);
      }
      
      return result;
      
    } catch(e) {
      lastError = e;
      Logger.log(operationName + ' - Error en intento ' + attempt + ': ' + e.toString());
      
      // Si no es el último intento, esperar antes de reintentar
      if (attempt < maxAttempts) {
        var waitTime = Math.min(500 * Math.pow(2, attempt - 1), 3000); // Backoff exponencial, máx 3s
        Logger.log('Esperando ' + waitTime + 'ms antes del siguiente intento...');
        Utilities.sleep(waitTime);
      }
    }
  }
  
  // Si llegamos aquí, todos los intentos fallaron
  logConcurrencyIssue(operationName, lastError.toString(), maxAttempts);
  throw new Error(operationName + ' falló después de ' + maxAttempts + ' intentos: ' + lastError.toString());
}

/**
 * Valida que el stock no haya cambiado desde la última lectura
 * @param {Sheet} sheet - Hoja de ARTICULOS
 * @param {number} rowIndex - Índice de la fila
 * @param {number} colIndex - Índice de la columna de cantidad
 * @param {number} expectedStock - Stock esperado
 * @return {boolean} true si el stock no cambió, false si cambió
 */
function validateStockNotChanged(sheet, rowIndex, colIndex, expectedStock) {
  var currentStock = Number(sheet.getRange(rowIndex, colIndex).getValue());
  if (currentStock !== expectedStock) {
    Logger.log('ADVERTENCIA: Stock cambió de ' + expectedStock + ' a ' + currentStock + ' durante la operación');
    return false;
  }
  return true;
}

/* ==================================================
   AUTENTICACIÓN
   ================================================== */
function verificarLogin(usuario, password) {
  try {
    var sheet = getSheet('USUARIOS');
    if (!sheet) {
      return {
        success: false,
        message: 'Hoja USUARIOS no encontrada'
      };
    }
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay usuarios registrados'
      };
    }
    
    var headers = data[0];
    var colUsuario = headers.indexOf('USUARIO');
    var colPassword = headers.indexOf('CONTRASEÑA');
    if (colPassword === -1) colPassword = headers.indexOf('CONTRASENA');
    if (colPassword === -1) colPassword = headers.indexOf('CORREO');
    
    var colNombre = headers.indexOf('NOMBRE_USUARIO');
    var colCorreo = headers.indexOf('CORREO');
    
    if (colUsuario === -1 || colPassword === -1) {
      return {
        success: false,
        message: 'Columnas de credenciales no encontradas'
      };
    }
    
    // Buscar usuario
    for (var i = 1; i < data.length; i++) {
      if (data[i][colUsuario] == usuario && data[i][colPassword] == password) {
        // Login exitoso
        var userEmail = colCorreo !== -1 ? data[i][colCorreo] : (usuario + "@sistema.local");
        setActiveUser(userEmail);
        return {
          success: true,
          message: 'Login exitoso',
          nombre: data[i][colNombre] || usuario,
          correo: userEmail
        };
      }
    }
    
    return {
      success: false,
      message: 'Usuario o contraseña incorrectos'
    };
    
  } catch(e) {
    return {
      success: false,
      message: 'Error al verificar login: ' + e.toString()
    };
  }
}

function cerrarSesion() {
  try {
    clearActiveUser();
    return { success: true, message: 'Sesión cerrada' };
  } catch(e) {
    return { success: false, message: 'Error al cerrar sesión' };
  }
}

/* ==================================================
   HELPERS DE BASE DE DATOS
   ================================================== */
function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

function getData(sheetName) {
  var sheet = getSheet(sheetName);
  if (!sheet) return [];
  
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  var headers = data[0];
  var rows = data.slice(1);
  
  return rows.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { 
      obj[h] = row[i]; 
    });
    return obj;
  });
}

/* ==================================================
   CARGA INICIAL OPTIMIZADA
   ================================================== */
function getInitialData() {
  try {
    var user = getActiveUser();
    if (!user) {
      return {
        success: false,
        needsLogin: true,
        message: 'Sesión no iniciada'
      };
    }
    
    var artSheet = getSheet('ARTICULOS');
    var cliSheet = getSheet('CLIENTES');
    
    var artCount = artSheet ? Math.max(0, artSheet.getLastRow() - 1) : 0;
    var cliCount = cliSheet ? Math.max(0, cliSheet.getLastRow() - 1) : 0;
    
    return {
      success: true,
      articulosCount: artCount,
      clientesCount: cliCount,
      usuario: user,
      needsLogin: false
    };
  } catch(e) {
    return {
      success: false,
      needsLogin: true,
      error: e.toString()
    };
  }
}

/* ==================================================
   MÓDULO: GESTIÓN DE USUARIOS
   ================================================== */
function getUsuarios() {
  try {
    return {
      success: true,
      data: getData('USUARIOS')
    };
  } catch(e) {
    return {
      success: false,
      error: e.toString(),
      data: []
    };
  }
}

function saveUsuario(data) {
  try {
    var sheet = getSheet('USUARIOS');
    var id = 'USR-' + new Date().getTime();
    
    sheet.appendRow([
      id,
      data.nombre,
      data.usuario,
      data.correo
    ]);
    
    return { 
      success: true, 
      message: "Usuario creado con ID: " + id 
    };
  } catch(e) {
    return {
      success: false,
      message: "Error al crear usuario: " + e.toString()
    };
  }
}

function updateUsuario(data) {
  try {
    var sheet = getSheet('USUARIOS');
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];
    
    var colId = headers.indexOf('ID_USUARIO');
    if (colId === -1) colId = 0;
    
    var rowIndex = -1;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][colId] == data.id) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { 
        success: false, 
        message: "Usuario no encontrado." 
      };
    }
    
    // Actualizar datos
    var colNombre = headers.indexOf('NOMBRE_USUARIO');
    var colUsuario = headers.indexOf('USUARIO');
    var colCorreo = headers.indexOf('CORREO');
    
    if (colNombre !== -1) sheet.getRange(rowIndex, colNombre + 1).setValue(data.nombre);
    if (colUsuario !== -1) sheet.getRange(rowIndex, colUsuario + 1).setValue(data.usuario);
    if (colCorreo !== -1) sheet.getRange(rowIndex, colCorreo + 1).setValue(data.correo);
    
    return { 
      success: true, 
      message: "Usuario actualizado correctamente." 
    };
  } catch(e) {
    return {
      success: false,
      message: "Error al actualizar: " + e.toString()
    };
  }
}

/* ==================================================
   MÓDULO: CLIENTES
   ================================================== */
function getClientes() {
  try {
    return {
      success: true,
      data: getData('CLIENTES')
    };
  } catch(e) {
    return {
      success: false,
      error: e.toString(),
      data: []
    };
  }
}

function saveCliente(data, usuarioActivo) {
  try {
    var sheet = getSheet('CLIENTES');
    // CORRECCIÓN: Usar el usuario pasado desde el cliente
    var user = usuarioActivo || 'Sistema';
    var fecha = new Date().toLocaleString('es-CO');
    
    sheet.appendRow([
      data.codigo || 'CLI-' + new Date().getTime(),
      data.estudiante,
      data.grado || '',
      data.ciclo,
      data.acudiente1,
      data.cedula1 || '',
      data.celular1 || '',
      data.direccion1 || '',
      data.correo1 || '',
      data.acudiente2 || '',
      data.cedula2 || '',
      data.celular2 || '',
      data.direccion2 || '',
      data.correo2 || '',
      'Creado por ' + user + ' el ' + fecha
    ]);
    
    return { 
      success: true, 
      message: "Cliente creado correctamente." 
    };
  } catch(e) {
    return {
      success: false,
      message: "Error al crear cliente: " + e.toString()
    };
  }
}

function updateCliente(data, usuarioActivo) {
  try {
    var sheet = getSheet('CLIENTES');
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0];
    // CORRECCIÓN: Usar el usuario pasado desde el cliente
    var user = usuarioActivo || 'Sistema';
    var fecha = new Date().toLocaleString('es-CO');
    
    var colCodigo = headers.indexOf('CODIGO');
    if (colCodigo === -1) colCodigo = 0;
    
    var rowIndex = -1;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][colCodigo] == data.codigo) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { 
        success: false, 
        message: "Cliente no encontrado." 
      };
    }
    
    // Actualizar todos los campos
    var colEstudiante = headers.indexOf('ESTUDIANTE');
    var colGrado = headers.indexOf('GRADO');
    var colCiclo = headers.indexOf('CICLO');
    var colAcud1 = headers.indexOf('ACUDIENTE_1');
    var colCed1 = headers.indexOf('CEDULA_ACUD_1');
    var colCel1 = headers.indexOf('CELULAR_ACUD_1');
    var colDir1 = headers.indexOf('DIRECCION_ACUD_1');
    var colCorr1 = headers.indexOf('CORREO_ACUD_1');
    var colAcud2 = headers.indexOf('ACUDIENTE_2');
    var colCed2 = headers.indexOf('CEDULA_ACUD_2');
    var colCel2 = headers.indexOf('CELULAR_ACUD_2');
    var colDir2 = headers.indexOf('DIRECCION_ACUD_2');
    var colCorr2 = headers.indexOf('CORREO_ACUD_2');
    var colMod = headers.indexOf('MODIFICACION');
    
    if (colEstudiante !== -1) sheet.getRange(rowIndex, colEstudiante + 1).setValue(data.estudiante);
    if (colGrado !== -1) sheet.getRange(rowIndex, colGrado + 1).setValue(data.grado || '');
    if (colCiclo !== -1) sheet.getRange(rowIndex, colCiclo + 1).setValue(data.ciclo);
    if (colAcud1 !== -1) sheet.getRange(rowIndex, colAcud1 + 1).setValue(data.acudiente1);
    if (colCed1 !== -1) sheet.getRange(rowIndex, colCed1 + 1).setValue(data.cedula1 || '');
    if (colCel1 !== -1) sheet.getRange(rowIndex, colCel1 + 1).setValue(data.celular1 || '');
    if (colDir1 !== -1) sheet.getRange(rowIndex, colDir1 + 1).setValue(data.direccion1 || '');
    if (colCorr1 !== -1) sheet.getRange(rowIndex, colCorr1 + 1).setValue(data.correo1 || '');
    if (colAcud2 !== -1) sheet.getRange(rowIndex, colAcud2 + 1).setValue(data.acudiente2 || '');
    if (colCed2 !== -1) sheet.getRange(rowIndex, colCed2 + 1).setValue(data.cedula2 || '');
    if (colCel2 !== -1) sheet.getRange(rowIndex, colCel2 + 1).setValue(data.celular2 || '');
    if (colDir2 !== -1) sheet.getRange(rowIndex, colDir2 + 1).setValue(data.direccion2 || '');
    if (colCorr2 !== -1) sheet.getRange(rowIndex, colCorr2 + 1).setValue(data.correo2 || '');
    
    if (colMod !== -1) {
      var currentLog = rows[rowIndex-1][colMod];
      var newLog = currentLog + " | Editado por " + user + " el " + fecha;
      sheet.getRange(rowIndex, colMod + 1).setValue(newLog);
    }
    
    return { 
      success: true, 
      message: "Cliente actualizado correctamente." 
    };
  } catch(e) {
    return {
      success: false,
      message: "Error al actualizar: " + e.toString()
    };
  }
}

function getClienteById(codigo) {
  try {
    var sheet = getSheet('CLIENTES');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colCodigo = headers.indexOf('CODIGO');
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][colCodigo] == codigo) {
        var obj = {};
        headers.forEach(function(h, idx) {
          obj[h] = data[i][idx];
        });
        return {
          success: true,
          data: obj
        };
      }
    }
    
    return {
      success: false,
      message: 'Cliente no encontrado'
    };
  } catch(e) {
    return {
      success: false,
      message: 'Error: ' + e.toString()
    };
  }
}

/* ==================================================
   MÓDULO: ARTICULOS
   ================================================== */
function getArticulos() {
  try {
    return {
      success: true,
      data: getData('ARTICULOS')
    };
  } catch(e) {
    return {
      success: false,
      error: e.toString(),
      data: []
    };
  }
}

function getArticuloByName(nombre) {
  try {
    var sheet = getSheet('ARTICULOS');
    if (!sheet) return { success: false, error: 'Hoja ARTICULOS no encontrada', data: null };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: false, error: 'No hay artículos', data: null };

    var headers = data[0];
    var rows = data.slice(1);

    for (var i = 0; i < rows.length; i++) {
      var obj = {};
      headers.forEach(function(h, j) { obj[h] = rows[i][j]; });
      if (String(obj.ARTICULO || '').trim() === String(nombre || '').trim()) {
        return { success: true, data: obj };
      }
    }

    return { success: false, error: 'Artículo no encontrado', data: null };
  } catch(e) {
    return { success: false, error: e.toString(), data: null };
  }
}

function saveArticulo(data) {
  try {
    var sheet = getSheet('ARTICULOS');
    var id = 'ART-' + Math.floor(Math.random() * 100000);
    
    sheet.appendRow([
      id,
      data.nombre,
      data.imagen || '',
      data.talla,
      data.cantidad || 0,
      data.precioCosto || 0,
      data.precioVenta || 0,
      data.stock || 0
    ]);
    
    return { 
      success: true, 
      message: "Artículo registrado con ID: " + id 
    };
  } catch(e) {
    return{
      success: false,
      message: "Error al registrar artículo: " + e.toString()
    };
  }
}

/* ==================================================
   MÓDULO: COMPRAS (ENTRADAS)
   ================================================== */
function registrarCompra(data, usuarioActivo) {
  // Ejecutar con retry automático
  return executeWithRetry(function() {
    return registrarCompraInternal(data, usuarioActivo);
  }, 'registrarCompra', 3);
}

function registrarCompraInternal(data, usuarioActivo) {
  var lock = null;
  try {
    // Adquirir lock con reintentos (máximo 5 intentos, 30 segundos cada uno)
    lock = acquireLockWithRetry(5, 30000);
    
    var sheetCompras = getSheet('COMPRAS');
    var sheetArt = getSheet('ARTICULOS');
    var artData = sheetArt.getDataRange().getValues();
    var artHeaders = artData[0];
    // CORRECCIÓN CRÍTICA: Usar el usuario pasado desde el cliente
    var user = usuarioActivo || 'Sistema';
    
    Logger.log('🔍 COMPRA - Usuario recibido desde cliente: ' + user);
    
    // Buscar el artículo para obtener su ID_ARTICULO y PRECIO_COSTO
    var colIdArt = artHeaders.indexOf('ID_ARTICULO');
    var colNombre = artHeaders.indexOf('ARTICULO');
    var colTalla = artHeaders.indexOf('TALLA');
    var colCantidad = artHeaders.indexOf('CANTIDAD');
    var colPrecioCosto = artHeaders.indexOf('PRECIO_COSTO');
    
    var idArticulo = '';
    var precioCosto = 0;
    var tallaArticulo = '';
    var found = false;
    var rowIndex = -1;
    var expectedStock = 0;
    
    for (var i = 1; i < artData.length; i++) {
      // BÚSQUEDA SOLO POR NOMBRE (sin filtrar por talla) - CON TRIM PARA EVITAR ESPACIOS INVISIBLES
      if (String(artData[i][colNombre] || '').trim() == String(data.articuloNombre || '').trim()) {
        idArticulo = artData[i][colIdArt];
        precioCosto = Number(artData[i][colPrecioCosto] || 0);
        tallaArticulo = artData[i][colTalla];
        rowIndex = i + 1;
        expectedStock = Number(artData[i][colCantidad]);
        found = true;
        break;
      }
    }
    
    if (!found) {
      return { 
        success: false, 
        message: "Artículo no encontrado en inventario." 
      };
    }
    
    // Calcular nuevo stock
    var currentStock = expectedStock;
    var newStock = currentStock + Number(data.cantidad);
    
    // VALIDACIÓN DOBLE: Re-leer stock antes de actualizar para detectar cambios concurrentes
    var stockActualEnHoja = Number(sheetArt.getRange(rowIndex, colCantidad + 1).getValue());
    if (stockActualEnHoja !== expectedStock) {
      Logger.log('Stock cambió durante la operación. Esperado: ' + expectedStock + ', Actual: ' + stockActualEnHoja);
      // Recalcular con el stock actual
      currentStock = stockActualEnHoja;
      newStock = currentStock + Number(data.cantidad);
    }
    
    // Calcular costo total
    var costoTotal = precioCosto * Number(data.cantidad);
    
    // Registrar compra con todos los campos de COMPRAS
    var idCompra = 'COM-' + new Date().getTime();
    var consecutivo = 'CONS-' + Math.floor(Math.random() * 1000000);
    
    sheetCompras.appendRow([
      idCompra,              // ID_COMPRA
      idArticulo,            // ID_ARTICULO
      tallaArticulo,         // TALLA (se toma del artículo)
      data.cantidad,         // CANTIDAD_COMPRA
      new Date(),            // FECHA_HORA_COMPRA
      consecutivo,           // CONSECUTIVO_COMPRA
      '',                    // RECIBIDO_PENDIENTE
      '',                    // UNIDADES_PENDIENTE
      user                   // USUARIO_RECIBE - AHORA USA EL USUARIO CORRECTO
    ]);
    
    Logger.log('✅ COMPRA - Guardado en COMPRAS con usuario: ' + user);
    
    // Actualizar stock en ARTICULOS
    sheetArt.getRange(rowIndex, colCantidad + 1).setValue(newStock);
    
    Logger.log('Compra registrada exitosamente. Stock actualizado: ' + currentStock + ' → ' + newStock);
    
    return { 
      success: true, 
      message: "Compra registrada. Costo Total: $" + costoTotal.toLocaleString() + ". Stock actualizado a " + newStock 
    };
    
  } catch (e) {
    Logger.log('Error en registrarCompraInternal: ' + e.toString());
    return { 
      success: false, 
      message: "Error al registrar compra: " + e.toString() + ". Por favor, intente nuevamente." 
    };
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

/* ==================================================
   MÓDULO: VENTAS (SALIDAS Y VOUCHER)
   ================================================== */
function registrarVenta(ventaData, usuarioActivo) {
  // Ejecutar con retry automático
  return executeWithRetry(function() {
    return registrarVentaInternal(ventaData, usuarioActivo);
  }, 'registrarVenta', 3);
}

function registrarVentaInternal(ventaData, usuarioActivo) {
  var lock = null;
  try {
    // Adquirir lock con reintentos (máximo 5 intentos, 30 segundos cada uno)
    lock = acquireLockWithRetry(5, 30000);
    
    var sheetVentas = getSheet('VENTAS');
    var sheetVentasVoucher = getSheet('VENTAS_VOUCHER');
    var sheetArt = getSheet('ARTICULOS');
    var artRange = sheetArt.getDataRange();
    var artValues = artRange.getValues();
    var artHeaders = artValues[0];
    
    // CORRECCIÓN CRÍTICA: Usar el usuario pasado desde el cliente
    var user = usuarioActivo || 'Sistema';
    
    Logger.log('🔍 VENTA - Usuario recibido desde cliente: ' + user);
    
    var colNombre = artHeaders.indexOf('ARTICULO');
    var colTalla = artHeaders.indexOf('TALLA');
    var colCantidad = artHeaders.indexOf('CANTIDAD');
    
    var items = ventaData.items;
    var rowsToUpdate = [];
    

    // ✅ FASE 1 CORREGIDA: Validar stock inicial CON EXCEPCIÓN PARA VENTAS PENDIENTES
   
    for (var k = 0; k < items.length; k++) {
      var item = items[k];
      var foundRow = -1;
      
      // 🔍 CORRECCIÓN CRÍTICA: Agregar trim() para evitar problemas con espacios
      var nombreBuscado = String(item.nombre || '').trim();
      
      for (var i = 1; i < artValues.length; i++) {
        var nombreEnHoja = String(artValues[i][colNombre] || '').trim();
        
        // BÚSQUEDA SOLO POR NOMBRE con trim() para evitar espacios invisibles
        if (nombreEnHoja === nombreBuscado) {
          foundRow = i;
          break;
        }
      }
      
      if (foundRow === -1) {
        // 🔍 LOG DE DEBUG: Mostrar exactamente qué se buscó
        Logger.log('❌ ARTÍCULO NO ENCONTRADO EN VENTAS:');
        Logger.log('   - Buscado: "' + nombreBuscado + '" (longitud: ' + nombreBuscado.length + ')');
        Logger.log('   - Total artículos en hoja: ' + (artValues.length - 1));
        
        return { 
          success: false, 
          message: "Item no encontrado: " + nombreBuscado + ". Verifique que el nombre en ARTICULOS coincida exactamente." 
        };
      }
      var currentStock = Number(artValues[foundRow][colCantidad]);
      
      // ✅ CORRECCIÓN: Permitir stock insuficiente SOLO si es venta pendiente (entregado: false)
      if (item.entregado !== false && currentStock < item.cantidad) {
        // Solo rechazar si NO es venta pendiente y el stock es insuficiente
        return { 
          success: false, 
          message: "Stock insuficiente para: " + item.nombre + " (Disponible: " + currentStock + ")" 
        };
      }
      
      // Agregar a la lista de actualizaciones (descuenta stock en TODOS los casos)
      rowsToUpdate.push({ 
        rowIndex: foundRow + 1, 
        currentStock: currentStock,
        newStock: currentStock - item.cantidad,  // ← Descuenta siempre (puede quedar negativo)
        itemName: item.nombre
      });

    }
    
    // FASE 2: VALIDACIÓN DOBLE - Re-leer stock antes de actualizar
    for (var j = 0; j < rowsToUpdate.length; j++) {
      var update = rowsToUpdate[j];
      var stockActualEnHoja = Number(sheetArt.getRange(update.rowIndex, colCantidad + 1).getValue());
      
      if (stockActualEnHoja !== update.currentStock) {
        Logger.log('ADVERTENCIA: Stock de ' + update.itemName + ' cambió durante la operación. Esperado: ' + update.currentStock + ', Actual: ' + stockActualEnHoja);
        
        // Recalcular con el stock actual
        if (stockActualEnHoja < (update.currentStock - update.newStock)) {
          // Ya no hay suficiente stock
          return { 
            success: false, 
            message: "Stock de " + update.itemName + " cambió durante la operación. Stock actual insuficiente (" + stockActualEnHoja + "). Por favor, intente nuevamente." 
          };
        }
        
        // Actualizar con el stock real actual
        update.currentStock = stockActualEnHoja;
        update.newStock = stockActualEnHoja - (update.currentStock - update.newStock);
      }
    }
    
    // FASE 3: Actualizar stock (operación atómica)
    rowsToUpdate.forEach(function(r) {
      sheetArt.getRange(r.rowIndex, colCantidad + 1).setValue(r.newStock);
      Logger.log('Stock actualizado para ' + r.itemName + ': ' + r.currentStock + ' → ' + r.newStock);
    });
    
    // FASE 4: Registrar venta en VENTAS (hoja existente)
    var idVenta = 'VEN-' + new Date().getTime();
    var fechaHora = new Date();
    var detalleJson = JSON.stringify(items);
    var metodosPago = JSON.stringify(ventaData.pagos);
    
    sheetVentas.appendRow([
      idVenta,
      fechaHora,
      ventaData.clienteNombre,
      detalleJson,
      ventaData.total,
      metodosPago
    ]);
    
    // FASE 5: Registrar ventas detalladas en VENTAS_VOUCHER
    var fechaHoraFormateada = fechaHora.toLocaleString('es-CO');
    
    // Calcular totales por método de pago
    var totalEfectivo = 0;
    var totalTarjeta = 0;
    var totalTransferencia = 0;
    
    ventaData.pagos.forEach(function(p) {
      var metodo = String(p.metodo).toLowerCase();
      if (metodo.includes('efectivo')) {
        totalEfectivo += Number(p.monto);
      } else if (metodo.includes('tarjeta')) {
        totalTarjeta += Number(p.monto);
      } else if (metodo.includes('transferencia')) {
        totalTransferencia += Number(p.monto);
      }
    });
    
    // Registrar cada artículo como una fila
items.forEach(function(item) {
  // Determinar estado de entrega
  var estadoEntrega = item.entregado ? 'ENTREGADO(A)' : 'SIN ENTREGAR';
  
  sheetVentasVoucher.appendRow([
    idVenta,                    // No_Voucher_Venta
    fechaHoraFormateada,        // Fecha_Hora
    ventaData.clienteNombre,    // Cliente
    item.nombre,                // Articulo
    item.talla,                 // Talla
    item.cantidad,              // Cantidad
    item.precio,                // P_Venta
    item.subtotal,              // Subtotal
    user,                       // Usuario
    '',                         // EFECTIVO (vacío en filas de artículos)
    '',                         // TARJETA (vacío en filas de artículos)
    '',                         // TRANSFERENCIA (vacío en filas de artículos)
    estadoEntrega               // ENTREGADO - NUEVA COLUMNA
  ]);
});
    
    Logger.log('✅ VENTA - Guardado artículos en VENTAS_VOUCHER con usuario: ' + user);
    
    // Registrar fila de resumen con métodos de pago
sheetVentasVoucher.appendRow([
  idVenta,                    // No_Voucher_Venta
  fechaHoraFormateada,        // Fecha_Hora
  ventaData.clienteNombre,    // Cliente
  '',                         // Articulo (vacío en fila de resumen)
  '',                         // Talla (vacío)
  '',                         // Cantidad (vacío)
  '',                         // P_Venta (vacío)
  '',                         // Subtotal (vacío)
  user,                       // Usuario
  totalEfectivo > 0 ? totalEfectivo : '',        // EFECTIVO
  totalTarjeta > 0 ? totalTarjeta : '',          // TARJETA
  totalTransferencia > 0 ? totalTransferencia : '', // TRANSFERENCIA
  ''                          // ENTREGADO (vacío en fila de resumen)
]);

    Logger.log('✅ VENTA - Guardado resumen de pago en VENTAS_VOUCHER con usuario: ' + user);
    
    // FASE 6: Generar PDF
    var pdfBlob = crearVoucherPDF(idVenta, ventaData, user);
    var base64 = Utilities.base64Encode(pdfBlob.getBytes());
    
    Logger.log('Venta ' + idVenta + ' registrada exitosamente');
    
    return { 
      success: true, 
      message: "Venta exitosa.", 
      pdfBase64: base64,
      fileName: "Voucher_" + idVenta + ".pdf"
    };
    
  } catch (e) {
    Logger.log('Error en registrarVentaInternal: ' + e.toString());
    return { 
      success: false, 
      message: "Error al registrar venta: " + e.toString() + ". Por favor, intente nuevamente." 
    };
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

/* ===================================================
   MÓDULO VENTAS MISCELÁNEAS
   =================================================== */

function descontarInventarioMisc(nombreArticulo, cantidad) {
  var lock = null;
  try {
    lock = acquireLockWithRetry(5, 30000);

    var sheet = getSheet('ARTICULOS');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colNombre = headers.indexOf('ARTICULO');
    var colCantidad = headers.indexOf('CANTIDAD');

    var nombreBuscado = String(nombreArticulo || '').trim();

    for (var i = 1; i < data.length; i++) {
      var nombreEnHoja = String(data[i][colNombre] || '').trim();
      if (nombreEnHoja === nombreBuscado) {
        var stockActual = Number(data[i][colCantidad]);
        if (stockActual < cantidad) {
          return { success: false, message: 'Stock insuficiente. Disponible: ' + stockActual };
        }
        var nuevoStock = stockActual - cantidad;
        sheet.getRange(i + 1, colCantidad + 1).setValue(nuevoStock);
        Logger.log('Misc - Stock descontado para ' + nombreBuscado + ': ' + stockActual + ' → ' + nuevoStock);
        return { success: true, nuevoStock: nuevoStock };
      }
    }

    return { success: false, message: 'Artículo no encontrado: ' + nombreBuscado };
  } catch(e) {
    Logger.log('Error en descontarInventarioMisc: ' + e.toString());
    return { success: false, message: 'Error al descontar inventario: ' + e.toString() };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function restaurarInventarioMisc(nombreArticulo, cantidad) {
  var lock = null;
  try {
    lock = acquireLockWithRetry(5, 30000);

    var sheet = getSheet('ARTICULOS');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colNombre = headers.indexOf('ARTICULO');
    var colCantidad = headers.indexOf('CANTIDAD');

    var nombreBuscado = String(nombreArticulo || '').trim();

    for (var i = 1; i < data.length; i++) {
      var nombreEnHoja = String(data[i][colNombre] || '').trim();
      if (nombreEnHoja === nombreBuscado) {
        var stockActual = Number(data[i][colCantidad]);
        var nuevoStock = stockActual + cantidad;
        sheet.getRange(i + 1, colCantidad + 1).setValue(nuevoStock);
        Logger.log('Misc - Stock restaurado para ' + nombreBuscado + ': ' + stockActual + ' → ' + nuevoStock);
        return { success: true, nuevoStock: nuevoStock };
      }
    }

    return { success: false, message: 'Artículo no encontrado: ' + nombreBuscado };
  } catch(e) {
    Logger.log('Error en restaurarInventarioMisc: ' + e.toString());
    return { success: false, message: 'Error al restaurar inventario: ' + e.toString() };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function registrarVentaMiscelanea(ventaData, usuarioActivo) {
  try {
    var sheetVentas = getSheet('VENTAS');
    var sheetVentasVoucher = getSheet('VENTAS_VOUCHER');

    var user = usuarioActivo || 'Sistema';
    var clienteNombre = 'VENTA MISCELÁNEA';
    var idVenta = 'MISC-' + new Date().getTime();
    var fechaHora = new Date();
    var items = ventaData.items;
    var detalleJson = JSON.stringify(items);
    var metodosPago = JSON.stringify(ventaData.pagos);

    // Registrar en VENTAS
    sheetVentas.appendRow([
      idVenta,
      fechaHora,
      clienteNombre,
      detalleJson,
      ventaData.total,
      metodosPago
    ]);

    // Registrar detalle en VENTAS_VOUCHER
    var fechaHoraFormateada = fechaHora.toLocaleString('es-CO');

    var totalEfectivo = 0;
    var totalTarjeta = 0;
    var totalTransferencia = 0;

    ventaData.pagos.forEach(function(p) {
      var metodo = String(p.metodo).toLowerCase();
      if (metodo.includes('efectivo')) {
        totalEfectivo += Number(p.monto);
      } else if (metodo.includes('tarjeta')) {
        totalTarjeta += Number(p.monto);
      } else if (metodo.includes('transferencia')) {
        totalTransferencia += Number(p.monto);
      }
    });

    // Registrar cada artículo como una fila
    items.forEach(function(item) {
      sheetVentasVoucher.appendRow([
        idVenta,                    // No_Voucher_Venta
        fechaHoraFormateada,        // Fecha_Hora
        clienteNombre,              // Cliente
        item.nombre,                // Articulo
        item.talla,                 // Talla
        item.cantidad,              // Cantidad
        item.precio,                // P_Venta
        item.subtotal,              // Subtotal
        user,                       // Usuario
        '',                         // EFECTIVO
        '',                         // TARJETA
        '',                         // TRANSFERENCIA
        'ENTREGADO(A)'              // ENTREGADO
      ]);
    });

    // Registrar fila de resumen con métodos de pago
    sheetVentasVoucher.appendRow([
      idVenta,                    // No_Voucher_Venta
      fechaHoraFormateada,        // Fecha_Hora
      clienteNombre,              // Cliente
      '',                         // Articulo
      '',                         // Talla
      '',                         // Cantidad
      '',                         // P_Venta
      '',                         // Subtotal
      user,                       // Usuario
      totalEfectivo > 0 ? totalEfectivo : '',
      totalTarjeta > 0 ? totalTarjeta : '',
      totalTransferencia > 0 ? totalTransferencia : '',
      ''                          // ENTREGADO
    ]);

    Logger.log('Venta miscelánea ' + idVenta + ' registrada por ' + user);

    return {
      success: true,
      message: 'Venta miscelánea registrada exitosamente.'
    };
  } catch(e) {
    Logger.log('Error en registrarVentaMiscelanea: ' + e.toString());
    return {
      success: false,
      message: 'Error al registrar venta miscelánea: ' + e.toString()
    };
  }
}

function getLogoBase64() {
  try {
    // ID del logo en Google Drive
    var fileId = '1tUGInTiN_8MHQu4QEcXuf4tcIBeQ5yLW';
    
    Logger.log('🔍 Intentando cargar logo desde Drive con ID: ' + fileId);
    
    // Método 1: Cargar directamente desde Google Drive
    try {
      var file = DriveApp.getFileById(fileId);
      Logger.log('✅ Archivo encontrado: ' + file.getName());
      
      var blob = file.getBlob();
      Logger.log('✅ Blob obtenido, tamaño: ' + blob.getBytes().length + ' bytes');
      
      var base64 = Utilities.base64Encode(blob.getBytes());
      Logger.log('✅ Conversión a base64 exitosa, longitud: ' + base64.length + ' caracteres');
      
      return 'data:image/png;base64,' + base64;
      
    } catch(e1) {
      Logger.log('⚠️ Método 1 falló: ' + e1.toString());
      
      // Método 2: Intentar con URL pública del Drive
      try {
        Logger.log('⚠️ Intentando método alternativo con URL pública...');
        var url = 'https://drive.google.com/uc?export=view&id=' + fileId;
        var response = UrlFetchApp.fetch(url, {
          'muteHttpExceptions': true,
          'followRedirects': true
        });
        
        if (response.getResponseCode() === 200) {
          var blob = response.getBlob();
          var base64 = Utilities.base64Encode(blob.getBytes());
          Logger.log('✅ Logo cargado desde URL pública de Drive');
          return 'data:image/png;base64,' + base64;
        } else {
          Logger.log('❌ Respuesta HTTP: ' + response.getResponseCode());
        }
      } catch(e2) {
        Logger.log('❌ Método 2 falló: ' + e2.toString());
      }
      
      // Método 3: Intentar con URL directa de imagen (si es pública)
      try {
        Logger.log('⚠️ Intentando método 3 con URL directa...');
        var url = 'https://i.postimg.cc/0jMcgZ60/PINTA_removebg_preview.png';
        var response = UrlFetchApp.fetch(url, {
          'muteHttpExceptions': true
        });
        
        if (response.getResponseCode() === 200) {
          var blob = response.getBlob();
          var base64 = Utilities.base64Encode(blob.getBytes());
          Logger.log('✅ Logo cargado desde URL externa');
          return 'data:image/png;base64,' + base64;
        }
      } catch(e3) {
        Logger.log('❌ Método 3 falló: ' + e3.toString());
      }
    }
    
    Logger.log('❌ Todos los métodos de carga fallaron');
    return '';
    
  } catch(e) {
    Logger.log('❌ Error general al cargar logo: ' + e.toString());
    return '';
  }
}

function crearVoucherPDF(idVenta, data, usuarioEmail) {
  // Obtener logo en base64
  var logoBase64 = getLogoBase64();
  
  // Obtener nombre del usuario
  var nombreUsuario = usuarioEmail;
  try {
    var sheetUsuarios = getSheet('USUARIOS');
    var usersData = sheetUsuarios.getDataRange().getValues();
    var usersHeaders = usersData[0];
    var colCorreo = usersHeaders.indexOf('CORREO');
    var colNombre = usersHeaders.indexOf('NOMBRE_USUARIO');
    
    for (var i = 1; i < usersData.length; i++) {
      if (usersData[i][colCorreo] == usuarioEmail) {
        nombreUsuario = usersData[i][colNombre] || usuarioEmail;
        break;
      }
    }
  } catch(e) {
    Logger.log('No se pudo obtener nombre de usuario: ' + e.toString());
  }
  
  var html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page { 
          size: 80mm auto; 
          margin: 3mm; 
        }
        body { 
          font-family: Arial, 'Helvetica Neue', sans-serif; 
          padding: 0; 
          margin: 0; 
          width: 78mm;
          font-size: 13px;
          color: #000000;
          font-weight: bold;
        }
        .voucher { 
          padding: 4mm; 
          max-width: 78mm; 
        }
        .header { 
          text-align: center; 
          margin-bottom: 10px; 
        }
        .logo-container { 
          margin-bottom: 10px; 
        }
        .logo { 
          width: 75px; 
          height: auto; 
        }
        h2 { 
          color: #000000; 
          margin: 6px 0; 
          font-size: 18px;
          font-weight: 900;
        }
        .info { 
          margin: 4px 0; 
          font-size: 12px;
          color: #000000;
          line-height: 1.5;
          font-weight: bold;
        }
        .info strong {
          font-weight: 900;
        }
        hr { 
          border: none; 
          border-top: 2px solid #000; 
          margin: 10px 0; 
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-top: 10px; 
          font-size: 12px;
          color: #000000;
          font-weight: bold;
        }
        th, td { 
          padding: 5px 3px; 
          text-align: left; 
          border-bottom: 2px solid #000;
          color: #000000;
          font-weight: bold;
        }
        th { 
          font-weight: 900; 
          border-bottom: 3px solid #000;
          color: #000000;
          background: #f0f0f0;
        }
        .total { 
          text-align: right; 
          font-size: 16px; 
          font-weight: 900; 
          margin: 12px 0;
          color: #000000;
          border-top: 3px solid #000;
          padding-top: 8px;
        }
        .payment-info { 
          margin-top: 10px; 
          font-size: 12px;
          color: #000000;
          line-height: 1.6;
          font-weight: bold;
        }
        .payment-info strong {
          font-weight: 900;
        }
        .cambio-info {
          background: #ffffff;
          border: 3px solid #000;
          padding: 10px;
          margin: 12px 0;
          text-align: center;
        }
        .cambio-info strong {
          font-weight: 900;
        }
        .cambio-valor {
          font-size: 18px;
          font-weight: 900;
          color: #000000;
        }
        .footer { 
          text-align: center; 
          font-size: 11px; 
          margin-top: 12px; 
          color: #000000;
          line-height: 1.5;
          font-weight: bold;
        }
        .footer strong {
          font-weight: 900;
        }
      </style>
    </head>
    <body>
      <div class="voucher">
        <div class="header">`;
  
  // Logo
  if (logoBase64) {
    html += `
          <div class="logo-container">
            <img src="${logoBase64}" alt="Logo" class="logo">
          </div>`;
  }
  
  html += `
          <h2>EL DESCUBRIDOR</h2>
          <p class="info">Punto de Venta</p>
          <p class="info"><strong>Voucher:</strong> ${idVenta}</p>
          <p class="info"><strong>Fecha:</strong> ${new Date().toLocaleString('es-CO', {dateStyle: 'short', timeStyle: 'short'})}</p>
        </div>
        
        <hr>
        
        <p class="info"><strong>Cliente:</strong><br>${data.clienteNombre}</p>
        
        <table>
          <thead>
            <tr>
              <th>Art.</th>
              <th>T.</th>
              <th>Cant</th>
              <th>P.U.</th>
              <th>Subt.</th>
            </tr>
          </thead>
          <tbody>`;
  
  data.items.forEach(function(item) {
    // Acortar nombre del artículo si es muy largo
    var nombreCorto = item.nombre.length > 15 ? item.nombre.substring(0, 15) + '...' : item.nombre;
    html += `
            <tr>
              <td>${nombreCorto}</td>
              <td>${item.talla}</td>
              <td style="text-align:center;">${item.cantidad}</td>
              <td style="text-align:right;">$${Number(item.precio).toLocaleString('es-CO')}</td>
              <td style="text-align:right;">$${Number(item.subtotal).toLocaleString('es-CO')}</td>
            </tr>`;
  });

  html += `
          </tbody>
        </table>
        
        <p class="total">TOTAL: $${data.total.toLocaleString('es-CO')}</p>
        
        <hr>
        
        <div class="payment-info">
          <strong>Métodos de Pago:</strong><br>`;
  
  data.pagos.forEach(function(p) {
    html += `&nbsp;&nbsp;• ${p.metodo}: $${p.monto.toLocaleString('es-CO')}<br>`;
  });
  
  // Mostrar cambio si existe
  if (data.cambio !== undefined && data.cambio > 0) {
    html += `
        </div>
        
        <div class="cambio-info">
          <strong>CAMBIO:</strong><br>
          <span class="cambio-valor">$${data.cambio.toLocaleString('es-CO')}</span>
        </div>
        <div class="payment-info">`;
  }
  
  html += `
        </div>
        
        <hr>
        
        <div class="footer">
          <p>Gracias por su compra</p>
          <p><strong>Atendido por:</strong> ${nombreUsuario}</p>
          <p>© Sistemas 2025</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
  blob.setName('Voucher_' + idVenta + '.pdf');
  
  return blob;
}

/* ==================================================
   VOUCHER DE ENTREGA
   ================================================== */

/**
 * Genera un PDF de voucher para entregas
 * Similar al voucher de venta pero con texto "ENTREGADO" y línea de firma
 */
function generarVoucherEntrega(registroEntrega) {
  try {
    // Obtener logo en base64
    var logoBase64 = getLogoBase64();
    
    // Fecha y hora ACTUAL del sistema (momento de la entrega)
    var fechaHoraEntrega = new Date();
    var fechaHoraFormateada = fechaHoraEntrega.toLocaleString('es-CO', {
      dateStyle: 'short', 
      timeStyle: 'short'
    });
    
    // Obtener nombre del usuario
    var nombreUsuario = registroEntrega.Usuario || 'Sistema';
    try {
      var sheetUsuarios = getSheet('USUARIOS');
      var usersData = sheetUsuarios.getDataRange().getValues();
      var usersHeaders = usersData[0];
      var colCorreo = usersHeaders.indexOf('CORREO');
      var colNombre = usersHeaders.indexOf('NOMBRE_USUARIO');
      
      for (var i = 1; i < usersData.length; i++) {
        if (usersData[i][colCorreo] == registroEntrega.Usuario) {
          nombreUsuario = usersData[i][colNombre] || registroEntrega.Usuario;
          break;
        }
      }
    } catch(e) {
      Logger.log('No se pudo obtener nombre de usuario para voucher: ' + e.toString());
    }
    
    // Crear HTML del voucher
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page { 
            size: 80mm auto; 
            margin: 3mm; 
          }
          body { 
            font-family: Arial, 'Helvetica Neue', sans-serif; 
            padding: 0; 
            margin: 0; 
            width: 78mm;
            font-size: 13px;
            color: #000000;
            font-weight: bold;
          }
          .voucher { 
            padding: 4mm; 
            max-width: 78mm; 
          }
          .header { 
            text-align: center; 
            margin-bottom: 10px; 
          }
          .logo-container { 
            margin-bottom: 10px; 
          }
          .logo { 
            width: 75px; 
            height: auto; 
          }
          h2 { 
            color: #000000; 
            margin: 6px 0; 
            font-size: 18px;
            font-weight: 900;
          }
          .info { 
            margin: 4px 0; 
            font-size: 12px;
            color: #000000;
            line-height: 1.5;
            font-weight: bold;
          }
          .info strong {
            font-weight: 900;
          }
          hr { 
            border: none; 
            border-top: 2px solid #000; 
            margin: 10px 0; 
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 10px; 
            font-size: 12px;
            color: #000000;
            font-weight: bold;
          }
          th, td { 
            padding: 5px 3px; 
            text-align: left; 
            border-bottom: 2px solid #000;
            color: #000000;
            font-weight: bold;
          }
          th { 
            font-weight: 900; 
            border-bottom: 3px solid #000;
            color: #000000;
            background: #f0f0f0;
          }
          .entregado-box {
            background: #d4edda;
            border: 3px solid #28a745;
            padding: 10px;
            margin: 12px 0;
            text-align: center;
            border-radius: 5px;
          }
          .entregado-text {
            font-size: 16px;
            font-weight: 900;
            color: #155724;
          }
          .firma-box {
            margin: 15px 0;
            padding-top: 30px;
            border-top: 2px dashed #000;
          }
          .firma-text {
            font-size: 12px;
            font-weight: bold;
            color: #000;
          }
          .footer { 
            text-align: center; 
            font-size: 11px; 
            margin-top: 12px; 
            color: #000000;
            line-height: 1.5;
            font-weight: bold;
          }
          .footer strong {
            font-weight: 900;
          }
        </style>
      </head>
      <body>
        <div class="voucher">
          <div class="header">`;
    
    // Logo
    if (logoBase64) {
      html += `
            <div class="logo-container">
              <img src="${logoBase64}" alt="Logo" class="logo">
            </div>`;
    }
    
    html += `
            <h2>EL DESCUBRIDOR</h2>
            <p class="info">Voucher de Entrega</p>
            <p class="info"><strong>Voucher Original:</strong> ${registroEntrega.No_Voucher_Venta || 'N/A'}</p>
            <p class="info"><strong>Fecha Entrega:</strong> ${fechaHoraFormateada}</p>
          </div>
          
          <hr>
          
          <p class="info"><strong>Cliente:</strong><br>${registroEntrega.Cliente || 'N/A'}</p>
          
          <table>
            <thead>
              <tr>
                <th>Artículo</th>
                <th>T.</th>
                <th>Cant</th>
                <th>P.U.</th>
                <th>Subt.</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${registroEntrega.Articulo || ''}</td>
                <td>${registroEntrega.Talla || ''}</td>
                <td style="text-align:center;">${registroEntrega.Cantidad || 0}</td>
                <td style="text-align:right;">$${Number(registroEntrega.P_Venta || 0).toLocaleString('es-CO')}</td>
                <td style="text-align:right;">$${Number(registroEntrega.Subtotal || 0).toLocaleString('es-CO')}</td>
              </tr>
            </tbody>
          </table>
          
          <div class="entregado-box">
            <p class="entregado-text">** ENTREGADO **</p>
          </div>
          
          <div class="firma-box">
            <p class="firma-text">FIRMA: __________________________</p>
          </div>
          
          <hr>
          
          <div class="footer">
            <p>Gracias por su compra</p>
            <p><strong>Atendido por:</strong> ${nombreUsuario}</p>
            <p>© Sistemas 2025</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Convertir HTML a PDF
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var fileName = 'Voucher_Entrega_' + (registroEntrega.No_Voucher_Venta || 'SN') + '.pdf';
    blob.setName(fileName);
    
    Logger.log('✅ Voucher de entrega generado: ' + fileName);
    
    return blob;
    
  } catch(e) {
    Logger.log('❌ Error al generar voucher de entrega: ' + e.toString());
    throw new Error('Error al generar voucher de entrega: ' + e.toString());
  }
}



/* ==================================================
   MÓDULO CIERRE DE CAJA
   ================================================== */
function getCierreCaja(fechaStr, usuarioCorreo) {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos de ventas'
      };
    }

    var headers = data[0];
    var colFecha = headers.indexOf('Fecha_Hora');
    var colUsuario = headers.indexOf('Usuario');
    var colCliente = headers.indexOf('Cliente');
    var colEfectivo = headers.indexOf('EFECTIVO');
    var colTarjeta = headers.indexOf('TARJETA');
    var colTransferencia = headers.indexOf('TRANSFERENCIA');
    var colVoucher = headers.indexOf('No_Voucher_Venta');
    var colArticulo = headers.indexOf('Articulo');
    var colSubtotal = headers.indexOf('Subtotal');

    // Parsear fecha objetivo
    var fechaObj = new Date(fechaStr);
    var diaObj = fechaObj.getDate();
    var mesObj = fechaObj.getMonth();
    var anioObj = fechaObj.getFullYear();

    // Paso 1: Recopilar filas que coincidan y agrupar artículos por voucher
    var matchingRows = [];
    var voucherItems = {}; // voucherNum -> { heladoSubtotal, totalSubtotal }

    for (var i = 1; i < data.length; i++) {
      var fechaVenta = data[i][colFecha];
      var usuarioVenta = data[i][colUsuario];

      // Convertir fecha de venta a Date
      var fechaVentaObj;
      if (typeof fechaVenta === 'string') {
        var partes = fechaVenta.split(',')[0].split('/');
        if (partes.length === 3) {
          fechaVentaObj = new Date(partes[2], partes[1] - 1, partes[0]);
        }
      } else if (fechaVenta instanceof Date) {
        fechaVentaObj = fechaVenta;
      }

      // Filtrar por fecha y usuario
      if (fechaVentaObj &&
          fechaVentaObj.getDate() === diaObj &&
          fechaVentaObj.getMonth() === mesObj &&
          fechaVentaObj.getFullYear() === anioObj &&
          usuarioVenta === usuarioCorreo) {

        matchingRows.push(data[i]);

        // Rastrear artículos por voucher para detectar HELADO
        var voucherNum = data[i][colVoucher];
        var articulo = String(data[i][colArticulo] || '').trim().toUpperCase();
        if (articulo !== '') {
          if (!voucherItems[voucherNum]) {
            voucherItems[voucherNum] = { heladoSubtotal: 0, totalSubtotal: 0 };
          }
          var subtotalItem = Number(data[i][colSubtotal]) || 0;
          voucherItems[voucherNum].totalSubtotal += subtotalItem;
          if (articulo.indexOf('HELADO') !== -1) {
            voucherItems[voucherNum].heladoSubtotal += subtotalItem;
          }
        }
      }
    }

    // Paso 2: Procesar filas de pago, separando proporción HELADO
    var uniEfectivo = 0, uniTarjeta = 0, uniTransferencia = 0;
    var miscEfectivo = 0, miscTarjeta = 0, miscTransferencia = 0;
    var heladoEfectivo = 0, heladoTarjeta = 0, heladoTransferencia = 0;

    for (var j = 0; j < matchingRows.length; j++) {
      var row = matchingRows[j];
      var efectivo = row[colEfectivo];
      var tarjeta = row[colTarjeta];
      var transferencia = row[colTransferencia];
      var cliente = String(row[colCliente] || '').trim().toUpperCase();
      var esMisc = (cliente === 'VENTA MISCELÁNEA' || cliente === 'VENTA MISCELANEA');
      var voucherNum = row[colVoucher];

      // Determinar proporción de HELADO para este voucher
      var heladoProp = 0;
      if (voucherItems[voucherNum] && voucherItems[voucherNum].totalSubtotal > 0) {
        heladoProp = voucherItems[voucherNum].heladoSubtotal / voucherItems[voucherNum].totalSubtotal;
      }
      var normalProp = 1 - heladoProp;

      if (efectivo !== '' && efectivo !== null && !isNaN(efectivo)) {
        var ef = Number(efectivo);
        heladoEfectivo += ef * heladoProp;
        if (esMisc) { miscEfectivo += ef * normalProp; }
        else { uniEfectivo += ef * normalProp; }
      }
      if (tarjeta !== '' && tarjeta !== null && !isNaN(tarjeta)) {
        var ta = Number(tarjeta);
        heladoTarjeta += ta * heladoProp;
        if (esMisc) { miscTarjeta += ta * normalProp; }
        else { uniTarjeta += ta * normalProp; }
      }
      if (transferencia !== '' && transferencia !== null && !isNaN(transferencia)) {
        var tr = Number(transferencia);
        heladoTransferencia += tr * heladoProp;
        if (esMisc) { miscTransferencia += tr * normalProp; }
        else { uniTransferencia += tr * normalProp; }
      }
    }

    // Redondear valores para evitar decimales flotantes
    uniEfectivo = Math.round(uniEfectivo);
    uniTarjeta = Math.round(uniTarjeta);
    uniTransferencia = Math.round(uniTransferencia);
    miscEfectivo = Math.round(miscEfectivo);
    miscTarjeta = Math.round(miscTarjeta);
    miscTransferencia = Math.round(miscTransferencia);
    heladoEfectivo = Math.round(heladoEfectivo);
    heladoTarjeta = Math.round(heladoTarjeta);
    heladoTransferencia = Math.round(heladoTransferencia);

    var totalUniformes = uniEfectivo + uniTarjeta + uniTransferencia;
    var totalMisc = miscEfectivo + miscTarjeta + miscTransferencia;
    var totalHelados = heladoEfectivo + heladoTarjeta + heladoTransferencia;

    return {
      success: true,
      // Uniformes
      uniEfectivo: uniEfectivo,
      uniTarjeta: uniTarjeta,
      uniTransferencia: uniTransferencia,
      totalUniformes: totalUniformes,
      // Misceláneas
      miscEfectivo: miscEfectivo,
      miscTarjeta: miscTarjeta,
      miscTransferencia: miscTransferencia,
      totalMisc: totalMisc,
      // Helados Descubridor
      heladoEfectivo: heladoEfectivo,
      heladoTarjeta: heladoTarjeta,
      heladoTransferencia: heladoTransferencia,
      totalHelados: totalHelados,
      // Compatibilidad con reportes existentes
      efectivo: uniEfectivo + miscEfectivo + heladoEfectivo,
      tarjeta: uniTarjeta + miscTarjeta + heladoTarjeta,
      transferencia: uniTransferencia + miscTransferencia + heladoTransferencia,
      total: totalUniformes + totalMisc + totalHelados
    };

  } catch(e) {
    return {
      success: false,
      message: 'Error al procesar cierre: ' + e.toString()
    };
  }
}

function generarPDFCierre(fechaStr, usuarioCorreo) {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos para exportar'
      };
    }
    
    var headers = data[0];
    var colFecha = headers.indexOf('Fecha_Hora');
    var colUsuario = headers.indexOf('Usuario');
    
    // Parsear fecha objetivo
    var fechaObj = new Date(fechaStr);
    var diaObj = fechaObj.getDate();
    var mesObj = fechaObj.getMonth();
    var anioObj = fechaObj.getFullYear();
    
    var fechaFormateada = fechaObj.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    // Obtener nombre del usuario
    var nombreUsuario = usuarioCorreo;
    try {
      var sheetUsuarios = getSheet('USUARIOS');
      var usersData = sheetUsuarios.getDataRange().getValues();
      var usersHeaders = usersData[0];
      var colCorreo = usersHeaders.indexOf('CORREO');
      var colNombre = usersHeaders.indexOf('NOMBRE_USUARIO');
      
      for (var i = 1; i < usersData.length; i++) {
        if (usersData[i][colCorreo] == usuarioCorreo) {
          nombreUsuario = usersData[i][colNombre] || usuarioCorreo;
          break;
        }
      }
    } catch(e) {
      Logger.log('No se pudo obtener nombre de usuario: ' + e.toString());
    }
    
    // Filtrar datos
    var datosFiltrados = [];
    
    for (var i = 1; i < data.length; i++) {
      var fechaVenta = data[i][colFecha];
      var usuarioVenta = data[i][colUsuario];
      
      // Convertir fecha
      var fechaVentaObj;
      if (typeof fechaVenta === 'string') {
        var partes = fechaVenta.split(',')[0].split('/');
        if (partes.length === 3) {
          fechaVentaObj = new Date(partes[2], partes[1] - 1, partes[0]);
        }
      } else if (fechaVenta instanceof Date) {
        fechaVentaObj = fechaVenta;
      }
      
      // Filtrar
      if (fechaVentaObj && 
          fechaVentaObj.getDate() === diaObj &&
          fechaVentaObj.getMonth() === mesObj &&
          fechaVentaObj.getFullYear() === anioObj &&
          usuarioVenta === usuarioCorreo) {
        datosFiltrados.push(data[i]);
      }
    }
    
    if (datosFiltrados.length === 0) {
      return {
        success: false,
        message: 'No hay datos para la fecha y usuario seleccionados'
      };
    }
    
    // Obtener logo en base64
    var logoBase64 = getLogoBase64();
    
    // Crear HTML para el PDF
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 15mm 15mm 25mm 15mm;
            @bottom-center {
              content: "Página " counter(page) " de " counter(pages);
              font-size: 10px;
              font-weight: bold;
              color: #000;
            }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 3px solid #2c3e50;
            padding-bottom: 15px;
          }
          .logo {
            width: 80px;
            height: auto;
            margin-bottom: 10px;
          }
          h1 {
            margin: 5px 0;
            font-size: 24px;
            color: #2c3e50;
          }
          h2 {
            margin: 5px 0;
            font-size: 16px;
            color: #34495e;
          }
          .info-box {
            background: #ecf0f1;
            padding: 10px;
            border-radius: 5px;
            margin: 15px 0;
          }
          .info-box p {
            margin: 5px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 9px;
          }
          th {
            background: #e8e8e8;
            color: #000000;
            padding: 6px 4px;
            text-align: left;
            font-weight: bold;
            border: 2px solid #000000;
          }
          td {
            padding: 5px 4px;
            border-bottom: 1px solid #ddd;
            border-left: 1px solid #ddd;
            border-right: 1px solid #ddd;
          }
          tr:nth-child(even) {
            background: #f9f9f9;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 9px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">`;
    
    if (logoBase64) {
      html += `<img src="${logoBase64}" alt="Logo" class="logo">`;
    }
    
    html += `
          <h1>EL DESCUBRIDOR</h1>
          <h2>Cierre de Punto de Venta - Detalle de Transacciones</h2>
        </div>
        
        <div class="info-box">
          <p><strong>Fecha de cierre:</strong> ${fechaFormateada}</p>
          <p><strong>Cajero/a:</strong> ${nombreUsuario}</p>
          <p><strong>Usuario:</strong> ${usuarioCorreo}</p>
          <p><strong>Hora de generación:</strong> ${new Date().toLocaleString('es-CO')}</p>
        </div>
        
        <table>
  <thead>
    <tr>
      <th>Voucher</th>
      <th>Fecha/Hora</th>
      <th>Cliente</th>
      <th>Artículo</th>
      <th>Talla</th>
      <th>Cant.</th>
      <th>P. Venta</th>
      <th>Subtotal</th>
      <th>Usuario</th>
      <th>Efectivo</th>
      <th>Tarjeta</th>
      <th>Transfer.</th>
      <th>Estado Entrega</th>
    </tr>
  </thead>
          <tbody>`;
    
    // Agregar filas de datos
    datosFiltrados.forEach(function(row) {
      html += '<tr>';
      headers.forEach(function(h, idx) {
        var value = row[idx];
        
        // Formatear valores numéricos
        if (h === 'P_Venta' || h === 'Subtotal' || h === 'EFECTIVO' || h === 'TARJETA' || h === 'TRANSFERENCIA') {
          if (value !== '' && value !== null && !isNaN(value)) {
            value = '$' + Number(value).toLocaleString('es-CO');
          } else {
            value = '-';
          }
        } else if (value === '' || value === null) {
          value = '-';
        }
        
        html += '<td>' + value + '</td>';
      });
      html += '</tr>';
    });
    
    html += `
          </tbody>
        </table>
        
        <div class="footer">
          <p><strong>El Descubridor</strong></p>
          <p>Sistema desarrollado por Equipo de Sistemas © 2025</p>
          <p>Documento generado automáticamente - Total de registros: ${datosFiltrados.length}</p>
        </div>
      </body>
      </html>
    `;
    
    // Convertir HTML a PDF
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    blob.setName('Cierre_Detalle_' + fechaStr.replace(/\//g, '-') + '.pdf');
    
    // Convertir a base64
    var base64 = Utilities.base64Encode(blob.getBytes());
    
    return {
      success: true,
      base64: base64,
      fileName: blob.getName()
    };
    
  } catch(e) {
    return {
      success: false,
      message: 'Error al generar PDF: ' + e.toString()
    };
  }
}

/* ==================================================
   MÓDULO REPORTES
   ================================================== */
function getReportData() {
  try {
    var artData = getData('ARTICULOS');
    var totalStock = 0;
    var valorizado = 0;
    
    artData.forEach(function(a) {
      var cant = Number(a.CANTIDAD || 0);
      var precio = Number(a.PRECIO_VENTA || 0);
      totalStock += cant;
      valorizado += (cant * precio);
    });
    
    return {
      success: true,
      totalItems: totalStock,
      valorInventario: valorizado
    };
  } catch(e) {
    return{
      success: false,
      error: e.toString(),
      totalItems: 0,
      valorInventario: 0
    };
  }
}

/* ==================================================
   REPORTE CONSOLIDADO POR ARTÍCULOS
   ================================================== */
function generarPDFConsolidado(fechaStr, usuarioCorreo) {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos para exportar'
      };
    }
    
    var headers = data[0];
    var colFecha = headers.indexOf('Fecha_Hora');
    var colUsuario = headers.indexOf('Usuario');
    var colArticulo = headers.indexOf('Articulo');
    var colCantidad = headers.indexOf('Cantidad');
    var colSubtotal = headers.indexOf('Subtotal');
    
    // Parsear fecha objetivo
    var fechaObj = new Date(fechaStr);
    var diaObj = fechaObj.getDate();
    var mesObj = fechaObj.getMonth();
    var anioObj = fechaObj.getFullYear();
    
    var fechaFormateada = fechaObj.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    // Obtener nombre del usuario
    var nombreUsuario = usuarioCorreo;
    try {
      var sheetUsuarios = getSheet('USUARIOS');
      var usersData = sheetUsuarios.getDataRange().getValues();
      var usersHeaders = usersData[0];
      var colCorreo = usersHeaders.indexOf('CORREO');
      var colNombre = usersHeaders.indexOf('NOMBRE_USUARIO');
      
      for (var i = 1; i < usersData.length; i++) {
        if (usersData[i][colCorreo] == usuarioCorreo) {
          nombreUsuario = usersData[i][colNombre] || usuarioCorreo;
          break;
        }
      }
    } catch(e) {
      Logger.log('No se pudo obtener nombre de usuario: ' + e.toString());
    }
    
    // Consolidar datos por artículo
    var consolidado = {};
    
    for (var i = 1; i < data.length; i++) {
      var fechaVenta = data[i][colFecha];
      var usuarioVenta = data[i][colUsuario];
      var articulo = data[i][colArticulo];
      var cantidad = data[i][colCantidad];
      var subtotal = data[i][colSubtotal];
      
      // Convertir fecha
      var fechaVentaObj;
      if (typeof fechaVenta === 'string') {
        var partes = fechaVenta.split(',')[0].split('/');
        if (partes.length === 3) {
          fechaVentaObj = new Date(partes[2], partes[1] - 1, partes[0]);
        }
      } else if (fechaVenta instanceof Date) {
        fechaVentaObj = fechaVenta;
      }
      
      // Filtrar por fecha y usuario
      if (fechaVentaObj && 
          fechaVentaObj.getDate() === diaObj &&
          fechaVentaObj.getMonth() === mesObj &&
          fechaVentaObj.getFullYear() === anioObj &&
          usuarioVenta === usuarioCorreo) {
        
        // Solo procesar filas con artículo
        if (articulo && articulo !== '' && articulo !== null) {
          // Inicializar si no existe
          if (!consolidado[articulo]) {
            consolidado[articulo] = {
              cantidad: 0,
              venta: 0
            };
          }
          
          // Acumular cantidad y venta
          if (cantidad !== '' && cantidad !== null && !isNaN(cantidad)) {
            consolidado[articulo].cantidad += Number(cantidad);
          }
          if (subtotal !== '' && subtotal !== null && !isNaN(subtotal)) {
            consolidado[articulo].venta += Number(subtotal);
          }
        }
      }
    }
    
    // Verificar si hay datos consolidados
    if (Object.keys(consolidado).length === 0) {
      return {
        success: false,
        message: 'No hay ventas para la fecha y usuario seleccionados'
      };
    }
    
    // Obtener logo en base64
    var logoBase64 = getLogoBase64();
    
    // Calcular totales
    var totalCantidad = 0;
    var totalVenta = 0;
    for (var art in consolidado) {
      totalCantidad += consolidado[art].cantidad;
      totalVenta += consolidado[art].venta;
    }
    
    // Crear HTML para el PDF
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 15mm 15mm 25mm 15mm;
            @bottom-center {
              content: "Página " counter(page) " de " counter(pages);
              font-size: 10px;
              font-weight: bold;
              color: #000;
            }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 3px solid #2c3e50;
            padding-bottom: 15px;
          }
          .logo {
            width: 80px;
            height: auto;
            margin-bottom: 10px;
          }
          h1 {
            margin: 5px 0;
            font-size: 24px;
            color: #2c3e50;
          }
          h2 {
            margin: 5px 0;
            font-size: 16px;
            color: #34495e;
          }
          .info-box {
            background: #ecf0f1;
            padding: 10px;
            border-radius: 5px;
            margin: 15px 0;
          }
          .info-box p {
            margin: 5px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 11px;
          }
          th {
            background: #e8e8e8;
            color: #000000;
            padding: 10px;
            text-align: left;
            font-weight: bold;
            border: 2px solid #000000;
          }
          td {
            padding: 8px 10px;
            border-bottom: 1px solid #ddd;
            border-left: 1px solid #ddd;
            border-right: 1px solid #ddd;
          }
          tr:nth-child(even) {
            background: #f9f9f9;
          }
          .totales {
            background: #d5dbdb !important;
            font-weight: bold;
            border-top: 3px solid #000;
          }
          .totales td {
            font-size: 12px;
            padding: 10px;
          }
          .text-right {
            text-align: right;
          }
          .text-center {
            text-align: center;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 9px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">`;
    
    if (logoBase64) {
      html += `<img src="${logoBase64}" alt="Logo" class="logo">`;
    }
    
    html += `
          <h1>EL DESCUBRIDOR</h1>
          <h2>Consolidado de Ventas por Artículo</h2>
        </div>
        
        <div class="info-box">
          <p><strong>Fecha de cierre:</strong> ${fechaFormateada}</p>
          <p><strong>Cajero/a:</strong> ${nombreUsuario}</p>
          <p><strong>Usuario:</strong> ${usuarioCorreo}</p>
          <p><strong>Hora de generación:</strong> ${new Date().toLocaleString('es-CO')}</p>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th class="text-center">Cantidad Total</th>
              <th class="text-right">Venta Total</th>
            </tr>
          </thead>
          <tbody>`;
    
    // Agregar filas de artículos consolidados
    for (var articulo in consolidado) {
      html += `
            <tr>
              <td>${articulo}</td>
              <td class="text-center">${consolidado[articulo].cantidad}</td>
              <td class="text-right">$${consolidado[articulo].venta.toLocaleString('es-CO')}</td>
            </tr>`;
    }
    
    // Agregar fila de totales
    html += `
            <tr class="totales">
              <td><strong>TOTALES</strong></td>
              <td class="text-center"><strong>${totalCantidad}</strong></td>
              <td class="text-right"><strong>$${totalVenta.toLocaleString('es-CO')}</strong></td>
            </tr>
          </tbody>
        </table>
        
        <div class="footer">
          <p><strong>EL DESCUBRIDOR</strong></p>
          <p>Consolidado generado el ${new Date().toLocaleString('es-CO')}</p>
          <p>Total de artículos diferentes: ${Object.keys(consolidado).length}</p>
          <p>© Sistemas 2025</p>
        </div>
      </body>
      </html>
    `;
    
    // Convertir HTML a PDF
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var base64 = Utilities.base64Encode(blob.getBytes());
    
    // Generar nombre del archivo
    var fileName = 'Consolidado_' + fechaFormateada.replace(/\//g, '-') + '.pdf';
    
    return {
      success: true,
      base64: base64,
      fileName: fileName
    };
    
  } catch(e) {
    return {
      success: false,
      message: 'Error al generar PDF consolidado: ' + e.toString()
    };
  }
}


/* ==================================================
   REPORTE CONSOLIDADO POR ARTÍCULOS - RANGO DE FECHAS (TODOS LOS USUARIOS)
   ================================================== */
function generarPDFConsolidadoRango(fechaInicio, fechaFin) {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos para exportar'
      };
    }
    
    var headers = data[0];
    var colFecha = headers.indexOf('Fecha_Hora');
    var colArticulo = headers.indexOf('Articulo');
    var colCantidad = headers.indexOf('Cantidad');
    var colSubtotal = headers.indexOf('Subtotal');
    
    // Columnas para métodos de pago
    var colEfectivo = headers.indexOf('EFECTIVO');
    var colTarjeta = headers.indexOf('TARJETA');
    var colTransferencia = headers.indexOf('TRANSFERENCIA');
    
    // Variables para acumular totales por método de pago
    var totalEfectivoRango = 0;
    var totalTarjetaRango = 0;
    var totalTransferenciaRango = 0;


    // Parsear fechas de inicio y fin
    var fechaInicioObj = new Date(fechaInicio);
    fechaInicioObj.setHours(0, 0, 0, 0);
    
    var fechaFinObj = new Date(fechaFin);
    fechaFinObj.setHours(23, 59, 59, 999);
    
    // Formatear fechas para mostrar en el reporte
    var fechaInicioFormateada = fechaInicioObj.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    var fechaFinFormateada = fechaFinObj.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    // Consolidar datos por artículo (SIN filtrar por usuario)
    var consolidado = {};
    
    for (var i = 1; i < data.length; i++) {
      var fechaVenta = data[i][colFecha];
      var articulo = data[i][colArticulo];
      var cantidad = data[i][colCantidad];
      var subtotal = data[i][colSubtotal];
      
      // Convertir fecha de venta a Date
      var fechaVentaObj;
      if (typeof fechaVenta === 'string') {
        var partes = fechaVenta.split(',')[0].split('/');
        if (partes.length === 3) {
          fechaVentaObj = new Date(partes[2], partes[1] - 1, partes[0]);
        }
      } else if (fechaVenta instanceof Date) {
        fechaVentaObj = fechaVenta;
      }
      
             // Filtrar por rango de fechas (SIN filtrar por usuario)
      if (fechaVentaObj && 
          fechaVentaObj >= fechaInicioObj &&
          fechaVentaObj <= fechaFinObj) {
        
        // Procesar filas con artículo (consolidado de artículos)
        if (articulo && articulo !== '' && articulo !== null) {
          // Inicializar si no existe
          if (!consolidado[articulo]) {
            consolidado[articulo] = {
              cantidad: 0,
              venta: 0
            };
          }
          
          // Acumular cantidad y venta
          if (cantidad !== '' && cantidad !== null && !isNaN(cantidad)) {
            consolidado[articulo].cantidad += Number(cantidad);
          }
          if (subtotal !== '' && subtotal !== null && !isNaN(subtotal)) {
            consolidado[articulo].venta += Number(subtotal);
          }
        }
        
        // Acumular totales por método de pago (filas de resumen con pagos)
        var efectivoVal = data[i][colEfectivo];
        var tarjetaVal = data[i][colTarjeta];
        var transferenciaVal = data[i][colTransferencia];
        
        if (efectivoVal !== '' && efectivoVal !== null && !isNaN(efectivoVal)) {
          totalEfectivoRango += Number(efectivoVal);
        }
        if (tarjetaVal !== '' && tarjetaVal !== null && !isNaN(tarjetaVal)) {
          totalTarjetaRango += Number(tarjetaVal);
        }
        if (transferenciaVal !== '' && transferenciaVal !== null && !isNaN(transferenciaVal)) {
          totalTransferenciaRango += Number(transferenciaVal);
        }
      }
    
    
    }
    
    // Verificar si hay datos consolidados
    if (Object.keys(consolidado).length === 0) {
      return {
        success: false,
        message: 'No hay ventas en el rango de fechas seleccionado (' + fechaInicioFormateada + ' - ' + fechaFinFormateada + ')'
      };
    }
    
    // Obtener logo en base64
    var logoBase64 = getLogoBase64();
    
    // Calcular totales
    var totalCantidad = 0;
    var totalVenta = 0;
    for (var art in consolidado) {
      totalCantidad += consolidado[art].cantidad;
      totalVenta += consolidado[art].venta;
    }
    
    // Crear HTML para el PDF
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 15mm 15mm 25mm 15mm;
            @bottom-center {
              content: "Página " counter(page) " de " counter(pages);
              font-size: 10px;
              font-weight: bold;
              color: #000;
            }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 3px solid #2c3e50;
            padding-bottom: 15px;
          }
          .logo {
            width: 80px;
            height: auto;
            margin-bottom: 10px;
          }
          h1 {
            margin: 5px 0;
            font-size: 24px;
            color: #2c3e50;
          }
          h2 {
            margin: 5px 0;
            font-size: 16px;
            color: #34495e;
          }
          .info-box {
            background: #e8f6f3;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
            border-left: 4px solid #1abc9c;
          }
          .info-box p {
            margin: 5px 0;
          }
          .rango-fechas {
            background: #fff3cd;
            border: 2px solid #ffc107;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            text-align: center;
          }
          .rango-fechas strong {
            color: #856404;
            font-size: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 11px;
          }

          th {
            background: #1abc9c;
            color: #000000;
            padding: 12px;
            text-align: left;
            font-weight: bold;
            font-size: 13px;
            border: 2px solid #16a085;
          }

          td {
            padding: 8px 10px;
            border-bottom: 1px solid #ddd;
            border-left: 1px solid #ddd;
            border-right: 1px solid #ddd;
          }
          tr:nth-child(even) {
            background: #f9f9f9;
          }
          .totales {
            background: #d5dbdb !important;
            font-weight: bold;
            border-top: 3px solid #000;
          }
          .totales td {
            font-size: 12px;
            padding: 10px;
          }
          .text-right {
            text-align: right;
          }
          .text-center {
            text-align: center;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 9px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">`;
    
    if (logoBase64) {
      html += `<img src="${logoBase64}" alt="Logo" class="logo">`;
    }
    
    html += `
          <h1>EL DESCUBRIDOR</h1>
          <h2>Consolidado de Ventas por Artículo</h2>
        </div>
        
        <div class="rango-fechas">
          <strong>📅 RANGO DE FECHAS: ${fechaInicioFormateada} al ${fechaFinFormateada}</strong>
        </div>
        
        <div class="info-box">
          <p><strong>Tipo de Reporte:</strong> Consolidado General (Todos los Usuarios)</p>
          <p><strong>Hora de generación:</strong> ${new Date().toLocaleString('es-CO')}</p>
          <p><strong>Total de artículos diferentes:</strong> ${Object.keys(consolidado).length}</p>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th class="text-center">Cantidad Total</th>
              <th class="text-right">Venta Total</th>
            </tr>
          </thead>
          <tbody>`;
    
    // Agregar filas de artículos consolidados
    for (var articulo in consolidado) {
      html += `
            <tr>
              <td>${articulo}</td>
              <td class="text-center">${consolidado[articulo].cantidad}</td>
              <td class="text-right">$${consolidado[articulo].venta.toLocaleString('es-CO')}</td>
            </tr>`;
    }
    
    // Agregar fila de totales




    html += `
            <tr class="totales">
              <td><strong>TOTALES</strong></td>
              <td class="text-center"><strong>${totalCantidad}</strong></td>
              <td class="text-right"><strong>$${totalVenta.toLocaleString('es-CO')}</strong></td>
            </tr>
          </tbody>
        </table>
        
        <div style="margin-top: 25px; padding: 20px; background: #f8f9fa; border: 2px solid #2c3e50; border-radius: 8px;">
          <h3 style="margin: 0 0 15px 0; color: #2c3e50; font-size: 14px; text-transform: uppercase; border-bottom: 2px solid #2c3e50; padding-bottom: 10px;">
            💰 Resumen de Ingresos por Método de Pago
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: #34495e;">
                <th style="padding: 12px; text-align: left; color: #000000; font-weight: bold; font-size: 13px; border: 1px solid #2c3e50;">Método de Pago</th>
                <th style="padding: 12px; text-align: right; color: #000000; font-weight: bold; font-size: 13px; border: 1px solid #2c3e50;">Total Recaudado</th>
              </tr>
            </thead>
            <tbody>
              <tr style="background: #e8f8f5;">
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: 600;">
                  💵 EFECTIVO
                </td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: #27ae60; font-size: 13px;">
                  $${totalEfectivoRango.toLocaleString('es-CO')}
                </td>
              </tr>
              <tr style="background: #eaf2f8;">
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: 600;">
                  💳 TARJETA DE CRÉDITO/DÉBITO
                </td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: #3498db; font-size: 13px;">
                  $${totalTarjetaRango.toLocaleString('es-CO')}
                </td>
              </tr>
              <tr style="background: #f5eef8;">
                <td style="padding: 10px; border: 1px solid #ddd; font-weight: 600;">
                  🏦 TRANSFERENCIA
                </td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold; color: #9b59b6; font-size: 13px;">
                  $${totalTransferenciaRango.toLocaleString('es-CO')}
                </td>
              </tr>
              <tr style="background: #2c3e50;">
                <td style="padding: 12px; border: 1px solid #2c3e50; font-weight: bold; color: white; font-size: 13px;">
                  TOTAL GENERAL RECAUDADO
                </td>
                <td style="padding: 12px; border: 1px solid #2c3e50; text-align: right; font-weight: bold; color: #f1c40f; font-size: 15px;">
                  $${(totalEfectivoRango + totalTarjetaRango + totalTransferenciaRango).toLocaleString('es-CO')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>




        <div class="footer">
          <p><strong>EL DESCUBRIDOR</strong></p>
          <p>Consolidado de Ventas por Rango de Fechas</p>
          <p>Período: ${fechaInicioFormateada} al ${fechaFinFormateada}</p>
          <p>Generado el ${new Date().toLocaleString('es-CO')}</p>
          <p>© Sistemas 2025</p>
        </div>
      </body>
      </html>
    `;
    
    // Convertir HTML a PDF
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var base64 = Utilities.base64Encode(blob.getBytes());
    
    // Generar nombre del archivo con rango de fechas
    var fileName = 'Consolidado_Rango_' + fechaInicioFormateada.replace(/\//g, '-') + '_al_' + fechaFinFormateada.replace(/\//g, '-') + '.pdf';
    
    return {
      success: true,
      base64: base64,
      fileName: fileName
    };
    
  } catch(e) {
    Logger.log('Error en generarPDFConsolidadoRango: ' + e.toString());
    return {
      success: false,
      message: 'Error al generar PDF consolidado por rango: ' + e.toString()
    };
  }
}



/* ==================================================
   REPORTE DE ARTÍCULOS SIN ENTREGAR
   ================================================== */
function generarPDFSinEntregar(fechaStr, usuarioCorreo) {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos para exportar'
      };
    }
    
    var headers = data[0];
    var colFecha = headers.indexOf('Fecha_Hora');
    var colUsuario = headers.indexOf('Usuario');
    var colArticulo = headers.indexOf('Articulo');
    var colEntregado = headers.indexOf('ENTREGADO');
    
    // Validar que existe la columna ENTREGADO
    if (colEntregado === -1) {
      return {
        success: false,
        message: 'La columna ENTREGADO no existe en VENTAS_VOUCHER. Por favor, agréguela manualmente.'
      };
    }
    
    // Parsear fecha objetivo
    var fechaObj = new Date(fechaStr);
    var diaObj = fechaObj.getDate();
    var mesObj = fechaObj.getMonth();
    var anioObj = fechaObj.getFullYear();
    
    var fechaFormateada = fechaObj.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    
    // Obtener nombre del usuario
    var nombreUsuario = usuarioCorreo;
    try {
      var sheetUsuarios = getSheet('USUARIOS');
      var usersData = sheetUsuarios.getDataRange().getValues();
      var usersHeaders = usersData[0];
      var colCorreo = usersHeaders.indexOf('CORREO');
      var colNombre = usersHeaders.indexOf('NOMBRE_USUARIO');
      
      for (var i = 1; i < usersData.length; i++) {
        if (usersData[i][colCorreo] == usuarioCorreo) {
          nombreUsuario = usersData[i][colNombre] || usuarioCorreo;
          break;
        }
      }
    } catch(e) {
      Logger.log('No se pudo obtener nombre de usuario: ' + e.toString());
    }
    
    // Filtrar datos: solo artículos SIN ENTREGAR
    var datosFiltrados = [];
    
    for (var i = 1; i < data.length; i++) {
      var fechaVenta = data[i][colFecha];
      var usuarioVenta = data[i][colUsuario];
      var articulo = data[i][colArticulo];
      var estadoEntrega = String(data[i][colEntregado] || '').toUpperCase();
      
      // Convertir fecha
      var fechaVentaObj;
      if (typeof fechaVenta === 'string') {
        var partes = fechaVenta.split(',')[0].split('/');
        if (partes.length === 3) {
          fechaVentaObj = new Date(partes[2], partes[1] - 1, partes[0]);
        }
      } else if (fechaVenta instanceof Date) {
        fechaVentaObj = fechaVenta;
      }
      
      // Filtrar: misma fecha, mismo usuario, con artículo y SIN ENTREGAR
      if (fechaVentaObj && 
          fechaVentaObj.getDate() === diaObj &&
          fechaVentaObj.getMonth() === mesObj &&
          fechaVentaObj.getFullYear() === anioObj &&
          usuarioVenta === usuarioCorreo &&
          articulo && articulo !== '' &&
          estadoEntrega === 'SIN ENTREGAR') {
        datosFiltrados.push(data[i]);
      }
    }
    
    if (datosFiltrados.length === 0) {
      return {
        success: false,
        message: 'No hay artículos sin entregar para la fecha y usuario seleccionados'
      };
    }
    
    // Obtener logo en base64
    var logoBase64 = getLogoBase64();
    
    // Crear HTML para el PDF - MISMO DISEÑO QUE EL REPORTE DETALLADO
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 15mm 15mm 25mm 15mm;
            @bottom-center {
              content: "Página " counter(page) " de " counter(pages);
              font-size: 10px;
              font-weight: bold;
              color: #000;
            }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
          }



          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 3px solid #2c3e50;
            padding-bottom: 15px;
          }



          .logo {
            width: 80px;
            height: auto;
            margin-bottom: 10px;
          }


          h1 {
            margin: 5px 0;
            font-size: 24px;
            color: #2c3e50;
          }


          h2 {
            margin: 5px 0;
            font-size: 16px;
            color: #34495e;
          }



          .info-box {
            background: #fee;
            padding: 10px;
            border-radius: 5px;
            margin: 15px 0;
            border-left: 4px solid #e74c3c;
          }
          .info-box p {
            margin: 5px 0;
          }
          .alert-box {
            background: #fff3cd;
            border: 2px solid #ffc107;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            text-align: center;
          }
          .alert-box strong {
            color: #856404;
            font-size: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 9px;
          }


          th {
            background: #e8e8e8;
            color: #000000;
            padding: 6px 4px;
            text-align: left;
            font-weight: bold;
            border: 2px solid #000000;
          }


          td {
            padding: 5px 4px;
            border-bottom: 1px solid #ddd;
            border-left: 1px solid #ddd;
            border-right: 1px solid #ddd;
          }


              tr:nth-child(even) {
              background: #f9f9f9;
          }


          .estado-pendiente {
            color: #e74c3c;
            font-weight: bold;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 9px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">`;
    
    if (logoBase64) {
      html += `<img src="${logoBase64}" alt="Logo" class="logo">`;
    }
    
    html += `
          <h1>EL DESCUBRIDOR</h1>
          <h2>⚠️ Artículos Pendientes de Entrega ⚠️</h2>
        </div>
        
        <div class="alert-box">
          <strong>⚠️ IMPORTANTE: Este reporte muestra únicamente los artículos que fueron vendidos pero NO entregados al cliente</strong>
        </div>
        
        <div class="info-box">
          <p><strong>Fecha de cierre:</strong> ${fechaFormateada}</p>
          <p><strong>Cajero/a:</strong> ${nombreUsuario}</p>
          <p><strong>Usuario:</strong> ${usuarioCorreo}</p>
          <p><strong>Hora de generación:</strong> ${new Date().toLocaleString('es-CO')}</p>
          <p><strong>Total de artículos pendientes:</strong> ${datosFiltrados.length}</p>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Voucher</th>
              <th>Fecha/Hora</th>
              <th>Cliente</th>
              <th>Artículo</th>
              <th>Talla</th>
              <th>Cant.</th>
              <th>P. Venta</th>
              <th>Subtotal</th>
              <th>Usuario</th>
              <th>Efectivo</th>
              <th>Tarjeta</th>
              <th>Transfer.</th>
              <th>Estado Entrega</th>
            </tr>
          </thead>
          <tbody>`;
    
    // Agregar filas de datos
    datosFiltrados.forEach(function(row) {
      html += '<tr>';
      headers.forEach(function(h, idx) {
        var value = row[idx];
        
        // Formatear valores numéricos
        if (h === 'P_Venta' || h === 'Subtotal' || h === 'EFECTIVO' || h === 'TARJETA' || h === 'TRANSFERENCIA') {
          if (value !== '' && value !== null && !isNaN(value)) {
            value = '$' + Number(value).toLocaleString('es-CO');
          } else {
            value = '-';
          }
        } else if (value === '' || value === null) {
          value = '-';
        }
        
        html += '<td>' + value + '</td>';
      });
      html += '</tr>';
    });
    
    html += `
          </tbody>
        </table>
        
        <div class="footer">
          <p><strong>EL DESCUBRIDOR</strong></p>
          <p>Reporte de Artículos Pendientes de Entrega</p>
          <p>© Sistemas 2025</p>
        </div>
      </body>
      </html>
    `;
    
    // Convertir HTML a PDF
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var base64 = Utilities.base64Encode(blob.getBytes());
    
    // Generar nombre del archivo
    var fileName = 'Pendientes_Entrega_' + fechaFormateada.replace(/\//g, '-') + '.pdf';
    
    return {
      success: true,
      base64: base64,
      fileName: fileName
    };
    
  } catch(e) {
    Logger.log('Error en generarPDFSinEntregar: ' + e.toString());
    return {
      success: false,
      message: 'Error al generar PDF de pendientes: ' + e.toString()
    };
  }
}

/* ==================================================
   CONSOLIDADO TOTAL DE PENDIENTES (SIN FILTRO DE FECHA/USUARIO)
   ================================================== */
function generarPDFConsolidadoPendientes() {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos para exportar'
      };
    }
    
    var headers = data[0];
    var colArticulo = headers.indexOf('Articulo');
    var colTalla = headers.indexOf('Talla');
    var colCantidad = headers.indexOf('Cantidad');
    var colEntregado = headers.indexOf('ENTREGADO');
    
    // Validar que existe la columna ENTREGADO
    if (colEntregado === -1) {
      return {
        success: false,
        message: 'La columna ENTREGADO no existe en VENTAS_VOUCHER.'
      };
    }
    
    // Consolidar TODOS los pendientes (sin filtro de fecha/usuario)
    var consolidado = {};
    
    for (var i = 1; i < data.length; i++) {
      var articulo = data[i][colArticulo];
      var talla = data[i][colTalla];
      var cantidad = data[i][colCantidad];
      var estadoEntrega = String(data[i][colEntregado] || '').toUpperCase();
      
      // Solo procesar si tiene artículo y está SIN ENTREGAR
      if (articulo && articulo !== '' && estadoEntrega === 'SIN ENTREGAR') {
        var clave = articulo + ' - Talla ' + talla;
        
        if (!consolidado[clave]) {
          consolidado[clave] = {
            articulo: articulo,
            talla: talla,
            cantidad: 0
          };
        }
        
        if (cantidad !== '' && cantidad !== null && !isNaN(cantidad)) {
          consolidado[clave].cantidad += Number(cantidad);
        }
      }
    }
    
    // Verificar si hay pendientes
    if (Object.keys(consolidado).length === 0) {
      return {
        success: false,
        message: 'No hay artículos pendientes de entrega en todo el sistema'
      };
    }
    
    // Obtener logo en base64
    var logoBase64 = getLogoBase64();
    
    // Calcular total de unidades pendientes
    var totalUnidades = 0;
    for (var key in consolidado) {
      totalUnidades += consolidado[key].cantidad;
    }
    
    // Crear HTML para el PDF
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 15mm 15mm 25mm 15mm;
            @bottom-center {
              content: "Página " counter(page) " de " counter(pages);
              font-size: 10px;
              font-weight: bold;
              color: #000;
            }
          }
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 3px solid #e74c3c;
            padding-bottom: 15px;
          }
          .logo {
            width: 80px;
            height: auto;
            margin-bottom: 10px;
          }
          h1 {
            margin: 5px 0;
            font-size: 24px;
            color: #e74c3c;
          }
          h2 {
            margin: 5px 0;
            font-size: 16px;
            color: #c0392b;
          }
          .info-box {
            background: #fee;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
            border-left: 4px solid #e74c3c;
          }
          .info-box p {
            margin: 5px 0;
          }
          .alert-box {
            background: #fff3cd;
            border: 2px solid #ffc107;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            text-align: center;
          }
          .alert-box strong {
            color: #856404;
            font-size: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 11px;
          }
          th {
            background: #e74c3c;
            color: white;
            padding: 10px;
            text-align: left;
            font-weight: bold;
            border: 2px solid #c0392b;
          }
          td {
            padding: 8px 10px;
            border-bottom: 1px solid #ddd;
            border-left: 1px solid #ddd;
            border-right: 1px solid #ddd;
          }
          tr:nth-child(even) {
            background: #fff5f5;
          }
          .totales {
            background: #fee !important;
            font-weight: bold;
            border-top: 3px solid #e74c3c;
          }
          .totales td {
            font-size: 12px;
            padding: 12px 10px;
          }
          .text-center {
            text-align: center;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 9px;
            color: #666;
            border-top: 1px solid #ddd;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">`;
    
    if (logoBase64) {
      html += `<img src="${logoBase64}" alt="Logo" class="logo">`;
    }
    
    html += `
          <h1>EL DESCUBRIDOR</h1>
          <h2>⚠️ Consolidado Total de Pendientes de Entrega ⚠️</h2>
        </div>
        
        <div class="alert-box">
          <strong>⚠️ REPORTE GLOBAL: Este consolidado incluye TODOS los artículos pendientes de entrega sin importar fecha ni usuario</strong>
        </div>
        
        <div class="info-box">
          <p><strong>Fecha de generación:</strong> ${new Date().toLocaleString('es-CO')}</p>
          <p><strong>Total de artículos diferentes pendientes:</strong> ${Object.keys(consolidado).length}</p>
          <p><strong>Total de unidades pendientes:</strong> ${totalUnidades}</p>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th class="text-center">Talla</th>
              <th class="text-center">Cantidad Total Pendiente</th>
            </tr>
          </thead>
          <tbody>`;
    
    // Agregar filas de artículos consolidados
    for (var clave in consolidado) {
      var item = consolidado[clave];
      html += `
            <tr>
              <td>${item.articulo}</td>
              <td class="text-center">${item.talla}</td>
              <td class="text-center" style="font-weight: bold; color: #e74c3c;">${item.cantidad}</td>
            </tr>`;
    }
    
    // Agregar fila de totales
    html += `
            <tr class="totales">
              <td colspan="2"><strong>TOTAL GENERAL DE UNIDADES PENDIENTES</strong></td>
              <td class="text-center"><strong style="color: #e74c3c; font-size: 14px;">${totalUnidades}</strong></td>
            </tr>
          </tbody>
        </table>
        
        <div class="footer">
          <p><strong>EL DESCUBRIDOR</strong></p>
          <p>Consolidado Total de Pendientes - Generado el ${new Date().toLocaleString('es-CO')}</p>
          <p>© Sistemas 2025</p>
        </div>
      </body>
      </html>
    `;
    
    // Convertir HTML a PDF
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var base64 = Utilities.base64Encode(blob.getBytes());
    
    var fileName = 'Consolidado_Total_Pendientes_' + new Date().toISOString().split('T')[0] + '.pdf';
    
    return {
      success: true,
      base64: base64,
      fileName: fileName
    };
    
  } catch(e) {
    Logger.log('Error en generarPDFConsolidadoPendientes: ' + e.toString());
    return {
      success: false,
      message: 'Error al generar PDF consolidado de pendientes: ' + e.toString()
    };
  }
}


/* ==================================================
   MÓDULO: GESTIÓN DE PENDIENTES
   ================================================== */
function getPendientes() {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: false,
        message: 'No hay datos en VENTAS_VOUCHER'
      };
    }
    
    var headers = data[0];
    var colEntregado = headers.indexOf('ENTREGADO');
    var colArticulo = headers.indexOf('Articulo');
    
    if (colEntregado === -1) {
      return {
        success: false,
        message: 'La columna ENTREGADO no existe en VENTAS_VOUCHER'
      };
    }
    
    var pendientes = [];
    
    for (var i = 1; i < data.length; i++) {
      var estadoEntrega = String(data[i][colEntregado] || '').toUpperCase();
      var articulo = data[i][colArticulo];
      
      // Solo incluir filas con artículo y estado SIN ENTREGAR
      if (articulo && articulo !== '' && estadoEntrega === 'SIN ENTREGAR') {
        var obj = {};
        headers.forEach(function(h, idx) {
          obj[h] = data[i][idx];
        });
        pendientes.push(obj);
      }
    }
    
    return {
      success: true,
      data: pendientes
    };
    
  } catch(e) {
    Logger.log('Error en getPendientes: ' + e.toString());
    return {
      success: false,
      message: 'Error al obtener pendientes: ' + e.toString()
    };
  }
}

function actualizarEstadoEntrega(voucher, fechaHora, articulo, nuevoEstado) {
  var lock = null;
  
  try {
    lock = acquireLockWithRetry(5, 30000);
    
    var sheetVentasVoucher = getSheet('VENTAS_VOUCHER');
    var data = sheetVentasVoucher.getDataRange().getValues();
    var headers = data[0];
    
    var colVoucher = headers.indexOf('No_Voucher_Venta');
    var colFecha = headers.indexOf('Fecha_Hora');
    var colArticulo = headers.indexOf('Articulo');
    var colEntregado = headers.indexOf('ENTREGADO');
    
    if (colEntregado === -1) {
      return {
        success: false,
        message: 'Columna ENTREGADO no encontrada'
      };
    }
    
    var encontrado = false;
    var registroEntrega = null;
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][colVoucher] == voucher && 
          String(data[i][colFecha]) == String(fechaHora) &&
          data[i][colArticulo] == articulo) {
        
        // Actualizar estado en VENTAS_VOUCHER
        sheetVentasVoucher.getRange(i + 1, colEntregado + 1).setValue(nuevoEstado);
        encontrado = true;
        
        // Guardar registro completo para voucher y para ENTREGAS
        registroEntrega = {};
        headers.forEach(function(h, idx) {
          registroEntrega[h] = data[i][idx];
        });
        
        Logger.log('Estado actualizado: Voucher=' + voucher + ', Artículo=' + articulo + ', Nuevo Estado=' + nuevoEstado);
        break;
      }
    }
    
    if (!encontrado) {
      return {
        success: false,
        message: 'No se encontró el registro para actualizar'
      };
    }
    
    // ✅ LÓGICA CORREGIDA: Si el nuevo estado es ENTREGADO(A), generar voucher y registrar en ENTREGAS
    if (nuevoEstado === 'ENTREGADO(A)' && registroEntrega) {
      try {
        Logger.log('🔄 Generando voucher de entrega...');
        
        // 1. Generar PDF de voucher de entrega
        var pdfBlob = generarVoucherEntrega(registroEntrega);
        var base64 = Utilities.base64Encode(pdfBlob.getBytes());
        var fileName = pdfBlob.getName();
        
        Logger.log('✅ Voucher PDF generado: ' + fileName);
        
        // 2. Registrar en hoja ENTREGAS
        var sheetEntregas = getSheet('ENTREGAS');
        if (!sheetEntregas) {
          // Si no existe la hoja ENTREGAS, crearla
          Logger.log('⚠️ Hoja ENTREGAS no existe. Creando...');
          sheetEntregas = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet('ENTREGAS');
          // Agregar encabezados
          sheetEntregas.appendRow([
            'No_Voucher_Venta',
            'Fecha_Hora_Venta',
            'Fecha_Hora_E',
            'Cliente',
            'Articulo',
            'Talla',
            'Cantidad',
            'P_Venta',
            'Subtotal',
            'Usuario'
          ]);
          Logger.log('✅ Hoja ENTREGAS creada con encabezados');
        }
        

        // ✅ CORRECCIÓN: Mapeo correcto según especificaciones
        var fechaHoraEntregaActual = new Date().toLocaleString('es-CO');
        var usuarioActivo = getActiveUser() || 'Sistema';
        
        sheetEntregas.appendRow([
          registroEntrega.No_Voucher_Venta || '',     // No_Voucher_Venta_E
          fechaHoraEntregaActual,                      // Fecha_Hora_E (fecha/hora ACTUAL del sistema)
          registroEntrega.Cliente || '',               // Cliente_E
          registroEntrega.Articulo || '',              // Articulo_E
          registroEntrega.Talla || '',                 // Talla_E
          registroEntrega.Cantidad || 0,               // Cantidad_E
          registroEntrega.P_Venta || 0,                // P_Venta_E
          registroEntrega.Subtotal || 0,               // Subtotal_E
          usuarioActivo                                // Usuario_E (usuario activo actual, no el original)
        ]);
   
        Logger.log('✅ Registro de entrega guardado en hoja ENTREGAS');
        Logger.log('   - Voucher: ' + registroEntrega.No_Voucher_Venta);
        Logger.log('   - Artículo: ' + registroEntrega.Articulo);
        Logger.log('   - Cliente: ' + registroEntrega.Cliente);
        Logger.log('   - Fecha Entrega: ' + fechaHoraEntregaActual);
        
        // Retornar con voucher PDF
        return {
          success: true,
          message: 'Entrega registrada correctamente',
          pdfBase64: base64,
          fileName: fileName
        };
        
      } catch(eVoucher) {
        Logger.log('❌ Error al generar voucher o registrar entrega: ' + eVoucher.toString());
        Logger.log('   Stack: ' + (eVoucher.stack || 'No disponible'));
        
        // Aunque falle el voucher, el estado ya se actualizó
        return {
          success: true,
          message: 'Estado actualizado pero hubo un error: ' + eVoucher.toString()
        };
      }
    }
    
    return {
      success: true,
      message: 'Estado actualizado correctamente'
    };
    
  } catch(e) {
    Logger.log('❌ Error en actualizarEstadoEntrega: ' + e.toString());
    Logger.log('   Stack: ' + (e.stack || 'No disponible'));
    return {
      success: false,
      message: 'Error al actualizar: ' + e.toString()
    };
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}


/* ==================================================
   MÓDULO: HISTORIAL DE ENTREGAS
   ================================================== */
function getEntregas() {
  try {
    var sheet = getSheet('ENTREGAS');
    
    if (!sheet) {
      return {
        success: false,
        message: 'La hoja ENTREGAS no existe'
      };
    }
    
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: true,
        data: [],
        message: 'No hay entregas registradas'
      };
    }
    
    var headers = data[0];
    var entregas = [];
    
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      headers.forEach(function(h, idx) {
        obj[h] = data[i][idx];
      });
      entregas.push(obj);
    }
    
    // Ordenar por fecha de entrega descendente (más recientes primero)
    entregas.sort(function(a, b) {
      var fechaA = new Date(a.Fecha_Hora_E || 0);
      var fechaB = new Date(b.Fecha_Hora_E || 0);
      return fechaB - fechaA;
    });
    
    Logger.log('✅ Entregas cargadas: ' + entregas.length + ' registros');
    
    return {
      success: true,
      data: entregas
    };
    
  } catch(e) {
    Logger.log('❌ Error en getEntregas: ' + e.toString());
    return {
      success: false,
      message: 'Error al obtener entregas: ' + e.toString()
    };
  }
}  // ← AGREGAR ESTA LLAVE DE CIERRE


  /* ==================================================
   MÓDULO: DEVOLUCIONES
   ================================================== */

/**
 * Obtiene todas las ventas de VENTAS_VOUCHER para mostrar en el dashboard de devoluciones
 */
function getVentasParaDevoluciones() {
  try {
    var sheet = getSheet('VENTAS_VOUCHER');
    
    if (!sheet) {
      return {
        success: false,
        message: 'La hoja VENTAS_VOUCHER no existe'
      };
    }
    
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: true,
        data: [],
        message: 'No hay ventas registradas'
      };
    }
    
    var headers = data[0];
    var ventas = [];
    
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      headers.forEach(function(h, idx) {
        obj[h] = data[i][idx];
      });
      ventas.push(obj);
    }
    
    // Ordenar por fecha descendente (más recientes primero)
    ventas.sort(function(a, b) {
      var fechaA = new Date(a.Fecha_Hora || 0);
      var fechaB = new Date(b.Fecha_Hora || 0);
      return fechaB - fechaA;
    });
    
    Logger.log('✅ Ventas cargadas para devoluciones: ' + ventas.length + ' registros');
    
    return {
      success: true,
      data: ventas
    };
    
  } catch(e) {
    Logger.log('❌ Error en getVentasParaDevoluciones: ' + e.toString());
    return {
      success: false,
      message: 'Error al obtener ventas: ' + e.toString()
    };
  }
}

/**
 * Procesa una devolución completa:
 * 1. Genera voucher PDF
 * 2. Registra en hoja DEVOLUCION
 * 3. Suma cantidades al inventario (ARTICULOS)
 */
function procesarDevolucion(articulosDevolucion, usuarioActivo) {
  return executeWithRetry(function() {
    return procesarDevolucionInternal(articulosDevolucion, usuarioActivo);
  }, 'procesarDevolucion', 3);
}

function procesarDevolucionInternal(articulosDevolucion, usuarioActivo) {
  var lock = null;
  
  try {
    // Adquirir lock con reintentos
    lock = acquireLockWithRetry(5, 30000);
    
    if (!articulosDevolucion || articulosDevolucion.length === 0) {
      return {
        success: false,
        message: 'No hay artículos para devolver'
      };
    }
    
    // Validar usuario
    if (!usuarioActivo) {
      return {
        success: false,
        message: 'Usuario no válido'
      };
    }
    
    var sheetDevolucion = getSheet('DEVOLUCION');
    var sheetArticulos = getSheet('ARTICULOS');
    
    // Si no existe DEVOLUCION, crearla
    if (!sheetDevolucion) {
      Logger.log('⚠️ Hoja DEVOLUCION no existe. Creando...');
      sheetDevolucion = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet('DEVOLUCION');
      sheetDevolucion.appendRow([
        'No_Voucher_Venta_D',
        'Fecha_Hora_D',
        'Cliente_D',
        'Articulo_D',
        'Talla_D',
        'Cantidad_D',
        'P_Venta_D',
        'Subtotal_D',
        'Usuario_D'
      ]);
      Logger.log('✅ Hoja DEVOLUCION creada');
    }
    
    // Obtener datos de artículos para validación y actualización
    var artData = sheetArticulos.getDataRange().getValues();
    var artHeaders = artData[0];
    var colNombre = artHeaders.indexOf('ARTICULO');
    var colCantidad = artHeaders.indexOf('CANTIDAD');
    
    if (colNombre === -1 || colCantidad === -1) {
      return {
        success: false,
        message: 'Columnas ARTICULO o CANTIDAD no encontradas en ARTICULOS'
      };
    }
    
    // Obtener último número de voucher de devolución
    var dataDevolucion = sheetDevolucion.getDataRange().getValues();
    var numeroVoucherDevolucion = 'DEV-' + (dataDevolucion.length); // Número secuencial
    
    var fechaHoraDevolucion = new Date().toLocaleString('es-CO');
    var clienteDevolucion = articulosDevolucion[0].Cliente || 'N/A';
    var voucherOriginal = articulosDevolucion[0].No_Voucher_Venta || 'N/A';
    
    Logger.log('🔄 Procesando devolución - Voucher: ' + numeroVoucherDevolucion);
    Logger.log('   Artículos a devolver: ' + articulosDevolucion.length);
    
    // FASE 1: Validar que todos los artículos existen en inventario
    var articulosValidados = [];
    
    for (var i = 0; i < articulosDevolucion.length; i++) {
      var articulo = articulosDevolucion[i];
      var nombreArticulo = articulo.Articulo;
      
      var encontrado = false;
      var rowIndex = -1;
      
      for (var j = 1; j < artData.length; j++) {
        if (artData[j][colNombre] === nombreArticulo) {
          encontrado = true;
          rowIndex = j + 1;
          
          articulosValidados.push({
            articulo: articulo,
            rowIndex: rowIndex,
            stockActual: Number(artData[j][colCantidad])
          });
          
          break;
        }
      }
      
      if (!encontrado) {
        return {
          success: false,
          message: 'Artículo no encontrado en inventario: ' + nombreArticulo
        };
      }
    }
    
    Logger.log('✅ Validación completada - ' + articulosValidados.length + ' artículos validados');
    
    // FASE 2: Actualizar inventario (SUMAR cantidades)
    articulosValidados.forEach(function(item) {
      var nuevaCantidad = item.stockActual + Number(item.articulo.Cantidad);
      sheetArticulos.getRange(item.rowIndex, colCantidad + 1).setValue(nuevaCantidad);
      
      Logger.log('   ✅ ' + item.articulo.Articulo + ': ' + item.stockActual + ' → ' + nuevaCantidad);
    });
    
    // FASE 3: Registrar en hoja DEVOLUCION
    articulosDevolucion.forEach(function(articulo) {
      sheetDevolucion.appendRow([
        articulo.No_Voucher_Venta || '',     // No_Voucher_Venta_D
        fechaHoraDevolucion,                  // Fecha_Hora_D (fecha/hora actual)
        articulo.Cliente || '',               // Cliente_D
        articulo.Articulo || '',              // Articulo_D
        articulo.Talla || '',                 // Talla_D
        articulo.Cantidad || 0,               // Cantidad_D
        articulo.P_Venta || 0,                // P_Venta_D
        articulo.Subtotal || 0,               // Subtotal_D
        usuarioActivo                         // Usuario_D
      ]);
    });
    
    Logger.log('✅ Registros guardados en DEVOLUCION');
    
    // FASE 4: Generar PDF de voucher de devolución
    var pdfBlob = generarVoucherDevolucionPDF({
      numeroVoucher: numeroVoucherDevolucion,
      voucherOriginal: voucherOriginal,
      fechaDevolucion: fechaHoraDevolucion,
      cliente: clienteDevolucion,
      articulos: articulosDevolucion,
      usuario: usuarioActivo
    });
    
    var base64 = Utilities.base64Encode(pdfBlob.getBytes());
    var fileName = pdfBlob.getName();
    
    Logger.log('✅ Voucher PDF generado: ' + fileName);
    
    return {
      success: true,
      message: 'Devolución procesada exitosamente. ' + articulosDevolucion.length + ' artículo(s) devuelto(s) al inventario.',
      pdfBase64: base64,
      fileName: fileName,
      numeroVoucher: numeroVoucherDevolucion
    };
    
  } catch(e) {
    Logger.log('❌ Error en procesarDevolucionInternal: ' + e.toString());
    Logger.log('   Stack: ' + (e.stack || 'No disponible'));
    return {
      success: false,
      message: 'Error al procesar devolución: ' + e.toString()
    };
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

/**
 * Genera el PDF del voucher de devolución
 */
function generarVoucherDevolucionPDF(datosDevolucion) {
  try {
    var logoBase64 = getLogoBase64();
    
    // Obtener nombre del usuario
    var nombreUsuario = datosDevolucion.usuario;
    try {
      var sheetUsuarios = getSheet('USUARIOS');
      var usersData = sheetUsuarios.getDataRange().getValues();
      var usersHeaders = usersData[0];
      var colCorreo = usersHeaders.indexOf('CORREO');
      var colNombre = usersHeaders.indexOf('NOMBRE_USUARIO');
      
      for (var i = 1; i < usersData.length; i++) {
        if (usersData[i][colCorreo] == datosDevolucion.usuario) {
          nombreUsuario = usersData[i][colNombre] || datosDevolucion.usuario;
          break;
        }
      }
    } catch(e) {
      Logger.log('No se pudo obtener nombre de usuario: ' + e.toString());
    }
    
    var html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page { 
            size: 80mm auto; 
            margin: 3mm; 
          }
          body { 
            font-family: Arial, 'Helvetica Neue', sans-serif; 
            padding: 0; 
            margin: 0; 
            width: 78mm;
            font-size: 13px;
            color: #000000;
            font-weight: bold;
          }
          .voucher { 
            padding: 4mm; 
            max-width: 78mm; 
          }
          .header { 
            text-align: center; 
            margin-bottom: 10px; 
          }
          .logo-container { 
            margin-bottom: 10px; 
          }
          .logo { 
            width: 75px; 
            height: auto; 
          }
          h2 { 
            color: #000000; 
            margin: 6px 0; 
            font-size: 18px;
            font-weight: 900;
          }
          .devolucion-title {
            background: #fee;
            border: 3px solid #e74c3c;
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
            text-align: center;
          }
          .devolucion-title h3 {
            color: #c0392b;
            margin: 0;
            font-size: 16px;
            font-weight: 900;
          }
          .info { 
            margin: 4px 0; 
            font-size: 12px;
            color: #000000;
            line-height: 1.5;
            font-weight: bold;
          }
          .info strong {
            font-weight: 900;
          }
          hr { 
            border: none; 
            border-top: 2px solid #000; 
            margin: 10px 0; 
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 10px; 
            font-size: 12px;
            color: #000000;
            font-weight: bold;
          }
          th, td { 
            padding: 5px 3px; 
            text-align: left; 
            border-bottom: 2px solid #000;
            color: #000000;
            font-weight: bold;
          }
          th { 
            font-weight: 900; 
            border-bottom: 3px solid #000;
            color: #000000;
            background: #f0f0f0;
          }
          .total { 
            text-align: right; 
            font-size: 16px; 
            font-weight: 900; 
            margin: 12px 0;
            color: #000000;
            border-top: 3px solid #000;
            padding-top: 8px;
          }
          .firma-box {
            margin: 15px 0;
            padding-top: 30px;
            border-top: 2px dashed #000;
          }
          .firma-text {
            font-size: 12px;
            font-weight: bold;
            color: #000;
          }
          .footer { 
            text-align: center; 
            font-size: 11px; 
            margin-top: 12px; 
            color: #000000;
            line-height: 1.5;
            font-weight: bold;
          }
          .footer strong {
            font-weight: 900;
          }
        </style>
      </head>
      <body>
        <div class="voucher">
          <div class="header">`;
    
    // Logo
    if (logoBase64) {
      html += `
            <div class="logo-container">
              <img src="${logoBase64}" alt="Logo" class="logo">
            </div>`;
    }
    
    html += `
            <h2>EL DESCUBRIDOR</h2>
            <div class="devolucion-title">
              <h3>** DEVOLUCIÓN **</h3>
            </div>
          </div>
          
          <p class="info"><strong>Voucher Devolución No:</strong> ${datosDevolucion.numeroVoucher}</p>
          <p class="info"><strong>Voucher Original:</strong> ${datosDevolucion.voucherOriginal}</p>
          <p class="info"><strong>Fecha Devolución:</strong> ${datosDevolucion.fechaDevolucion}</p>
          
          <hr>
          
          <p class="info"><strong>Cliente:</strong><br>${datosDevolucion.cliente}</p>
          
          <table>
            <thead>
              <tr>
                <th>Artículo</th>
                <th>T.</th>
                <th>Cant</th>
                <th>P.U.</th>
                <th>Subt.</th>
              </tr>
            </thead>
            <tbody>`;
    
    var totalDevolucion = 0;
    
    datosDevolucion.articulos.forEach(function(item) {
      var nombreCorto = item.Articulo.length > 15 ? item.Articulo.substring(0, 15) + '...' : item.Articulo;
      totalDevolucion += Number(item.Subtotal || 0);
      
      html += `
              <tr>
                <td>${nombreCorto}</td>
                <td>${item.Talla || '-'}</td>
                <td style="text-align:center;">${item.Cantidad || 0}</td>
                <td style="text-align:right;">$${Number(item.P_Venta || 0).toLocaleString('es-CO')}</td>
                <td style="text-align:right;">$${Number(item.Subtotal || 0).toLocaleString('es-CO')}</td>
              </tr>`;
    });
    
    html += `
            </tbody>
          </table>
          
          <p class="total">TOTAL DEVOLUCIÓN: $${totalDevolucion.toLocaleString('es-CO')}</p>
          
          <div class="firma-box">
            <p class="firma-text">FIRMA: __________________________</p>
          </div>
          
          <hr>
          
          <div class="footer">
            <p>** DEVOLUCIÓN TRAMITADA **</p>
            <p><strong>Atendido por:</strong> ${nombreUsuario}</p>
            <p>© Sistemas 2025</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var fileName = 'Voucher_Devolucion_' + datosDevolucion.numeroVoucher + '.pdf';
    blob.setName(fileName);
    
    Logger.log('✅ Voucher de devolución generado: ' + fileName);
    
    return blob;
    
  } catch(e) {
    Logger.log('❌ Error al generar voucher de devolución: ' + e.toString());
    throw new Error('Error al generar voucher de devolución: ' + e.toString());
  }
}

/* ==================================================
   MÓDULO: HISTORIAL DE DEVOLUCIONES APLICADAS
   ================================================== */
function getDevoluciones() {
  try {
    var sheet = getSheet('DEVOLUCION');
    
    if (!sheet) {
      return {
        success: false,
        message: 'La hoja DEVOLUCION no existe'
      };
    }
    
    var data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return {
        success: true,
        data: [],
        message: 'No hay devoluciones registradas'
      };
    }
    
    var headers = data[0];
    var devoluciones = [];
    
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      headers.forEach(function(h, idx) {
        obj[h] = data[i][idx];
      });
      devoluciones.push(obj);
    }
    
    // Ordenar por fecha de devolución descendente (más recientes primero)
    devoluciones.sort(function(a, b) {
      var fechaA = new Date(a.Fecha_Hora_D || 0);
      var fechaB = new Date(b.Fecha_Hora_D || 0);
      return fechaB - fechaA;
    });
    
    Logger.log('✅ Devoluciones cargadas: ' + devoluciones.length + ' registros');
    
    return {
      success: true,
      data: devoluciones
    };
    
  } catch(e) {
    Logger.log('❌ Error en getDevoluciones: ' + e.toString());
    return {
      success: false,
      message: 'Error al obtener devoluciones: ' + e.toString()
    };
  }
}



