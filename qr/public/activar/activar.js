const form = document.getElementById('form');
const boton = document.getElementById('enviar');
const mensaje = document.getElementById('mensaje');
const campoCodigo = document.getElementById('codigo');
const campoUrl = document.getElementById('url');

const modoActual = () => form.elements.modo?.value ?? document.querySelector('input[name=modo]:checked').value;

// Prellena el código desde ?c=
const c = new URLSearchParams(location.search).get('c');
if (c) campoCodigo.value = c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

document.querySelectorAll('input[name=modo]').forEach((r) =>
  r.addEventListener('change', () => {
    boton.textContent = modoActual() === 'activar' ? 'Activar' : 'Guardar link';
  })
);

function mostrar(texto, tipo) {
  mensaje.textContent = texto;
  mensaje.className = tipo;
  mensaje.hidden = false;
}

// Acepta "ejemplo.com" y le agrega https://. Solo http/https (el servidor lo vuelve a validar).
function normalizarUrl(valor) {
  const v = valor.trim();
  if (!v) return null;
  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(conEsquema);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  mensaje.hidden = true;

  const modo = modoActual();
  const codigo = campoCodigo.value.trim().toUpperCase();
  const activacion = document.getElementById('activacion').value.trim();
  const url = normalizarUrl(campoUrl.value);

  if (!codigo || !activacion) return mostrar('Completá el código del QR y el de activación.', 'err');
  if (!url) return mostrar('El link no es válido. Tiene que empezar con http:// o https://', 'err');

  boton.disabled = true;
  try {
    const res = await fetch(`/api/${modo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, activacion, url }),
    });
    const datos = await res.json().catch(() => ({}));
    if (res.ok && datos.ok) {
      campoUrl.value = url;
      mostrar(
        modo === 'activar'
          ? '¡Listo! Tu QR ya está activo. Escanealo para probarlo.'
          : '¡Listo! El link se actualizó.',
        'ok'
      );
    } else if (res.status >= 500) {
      mostrar('El servicio no responde. Probá de nuevo en unos minutos.', 'err');
    } else {
      mostrar(
        'No se pudo completar. Revisá los códigos. Si tu QR ya estaba activado, elegí "Cambiar link". Tras varios errores seguidos se bloquea unos minutos.',
        'err'
      );
    }
  } catch {
    mostrar('No hay conexión. Probá de nuevo.', 'err');
  } finally {
    boton.disabled = false;
  }
});
