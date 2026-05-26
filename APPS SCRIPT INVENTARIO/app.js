/* ==================================================
   CONFIGURACIÓN Y MENU
   ================================================== */
const SPREADSHEET_ID = '1laL9LXfjb6lYWhV6R6SXxFsKCkYy_WnFOU6qaC7AhIM';

// Almacenamiento local para usuario activo
class UserService {
  static getActiveUser() {
    return localStorage.getItem('userEmail');
  }

  static setActiveUser(email) {
    localStorage.setItem('userEmail', email);
  }

  static clearActiveUser() {
    localStorage.removeItem('userEmail');
  }
}

/* ==================================================
   SISTEMA DE CONCURRENCIA ROBUSTA
   ================================================== */

/**
 * Registra problemas de concurrencia para auditoría
 */
function logConcurrencyIssue(operation, error, attempts) {
  try {
    const logEntry = {
      timestamp: new Date(),
      user: UserService.getActiveUser() || 'Sistema',
      operation: operation,
      error: error,
      attempts: attempts,
      resolved: attempts > 1 ? `Sí (Reintento ${attempts})` : 'No'
    };
    
    console.log('Concurrency Issue:', logEntry);
    // Aquí iría la lógica para guardar en base de datos
    // Por ahora lo guardamos en localStorage
    const logs = JSON.parse(localStorage.getItem('concurrencyLogs') || '[]');
    logs.push(logEntry);
    localStorage.setItem('concurrencyLogs', JSON.stringify(logs));
  } catch(e) {
    console.error('Error en log de concurrencia:', e);
  }
}

/**
 * Simula un lock con reintentos y backoff exponencial
 * @param {number} maxAttempts - Número máximo de intentos
 * @param {number} timeoutMs - Timeout en milisegundos para cada intento
 * @return {Promise} Promise que se resuelve cuando se adquiere el lock
 */
async function acquireLockWithRetry(maxAttempts = 3, timeoutMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const locked = localStorage.getItem('appLock');
      
      if (!locked) {
        localStorage.setItem('appLock', 'true');
        return { releaseLock: () => localStorage.removeItem('appLock') };
      }
      
      // Backoff exponencial
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`Intento ${attempt} de adquirir lock falló. Esperando ${waitTime}ms`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
    } catch(e) {
      console.error('Error al intentar adquirir lock:', e);
      if (attempt === maxAttempts) {
        throw new Error(`No se pudo adquirir lock después de ${maxAttempts} intentos`);
      }
    }
  }
  
  throw new Error(`No se pudo adquirir lock después de ${maxAttempts} intentos`);
}

/* ==================================================
   FUNCIONES DE INTERFAZ DE USUARIO
   ================================================== */

/**
 * Maneja el login del usuario
 */
function handleLogin(event) {
  event.preventDefault();
  
  const usuario = document.getElementById('login-usuario').value;
  const password = document.getElementById('login-password').value;
  
  // Validar credenciales (aquí iría la lógica real de autenticación)
  if (usuario && password) {
    UserService.setActiveUser(password);
    showMainApp();
  } else {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Usuario y contraseña requeridos'
    });
  }
}

/**
 * Muestra la aplicación principal
 */
function showMainApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
}

/**
 * Oculta la aplicación principal y muestra login
 */
function showLoginScreen() {
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  UserService.clearActiveUser();
}

/**
 * Navega entre secciones
 */
function navigate(section) {
  const buttons = document.querySelectorAll('.nav-links li');
  buttons.forEach(btn => btn.classList.remove('active'));
  
  document.getElementById(`btn-${section}`).classList.add('active');
  
  console.log('Navegando a:', section);
  // Aquí iría la lógica para cargar la sección correspondiente
}

/**
 * Alterna la visibilidad de la contraseña
 */
function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const icon = document.querySelector('.toggle-password');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = 'visibility';
  } else {
    input.type = 'password';
    icon.textContent = 'visibility_off';
  }
}

/* ==================================================
   INICIALIZACIÓN
   ================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Verificar si hay usuario activo
  const activeUser = UserService.getActiveUser();
  
  if (activeUser) {
    showMainApp();
  } else {
    // Agregar listener al formulario de login
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', handleLogin);
    }
  }
});
