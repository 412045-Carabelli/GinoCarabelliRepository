# QRs dinámicos con activación

Cada sticker/placa NFC trae un **QR fijo** (`https://DOMINIO/r/CODIGO`) y un **código de activación**. El cliente entra, pone el código y el link de destino; después puede cambiarlo cuando quiera. Lo impreso nunca cambia.

```
QR ─► https://DOMINIO/r/CODIGO ─► Cloudflare Pages Function ─► Supabase RPC resolver_qr
                                     ├─ ok          → 302 al destino
                                     ├─ sin_activar → 302 a /activar?c=CODIGO
                                     └─ otro        → "QR no disponible"
/activar (HTML estático) ─► /api/activar | /api/editar ─► Supabase RPC activar_qr | editar_qr
```

| Carpeta | Qué es |
|---|---|
| `schema.sql` | Tabla, índices, RLS, funciones RPC, permisos |
| `functions/` | Pages Functions: `r/[codigo].js` (redirección) y `api/[accion].js` (proxy a las RPC) |
| `public/` | Página de activación/edición (HTML + JS puro) |
| `scripts/generar-lote.js` | Genera lotes: inserta en Supabase y exporta PNG/SVG + CSV |
| `scripts/backup.js` | Exporta la tabla a CSV |
| `../.github/workflows/anti-pausa.yml` | Evita que Supabase pause el proyecto |

Seguridad: RLS activado y sin acceso directo para `anon`; todo pasa por RPC `security definer`. El código de activación se guarda como SHA-256 (el valor en claro solo está en el CSV del lote). Tras 5 intentos fallidos sobre un código, ese código se bloquea 15 minutos. La `service_role` solo se usa en los scripts locales.

## Despliegue

### 1. Supabase
1. Crear un proyecto en [supabase.com](https://supabase.com) (plan gratis).
2. **SQL Editor** → pegar y correr `schema.sql`.
3. **Settings → API**: anotar `Project URL`, la clave `anon` y la `service_role`.

### 2. Cloudflare Pages
1. Subir este repo a GitHub y en Cloudflare: *Workers & Pages → Create → Pages → Connect to Git*.
2. Configuración de build: **Root directory** `qr` · Build command: *(vacío)* · **Output directory** `public`.
3. *Settings → Variables and Secrets* (Production): `SUPABASE_URL` y `SUPABASE_ANON_KEY` (la `anon`, nunca la `service_role`).
4. *Custom domains*: agregar el dominio corto (ej. `qr.tudominio.com`). **Lo que se imprime es siempre este dominio**, nunca `supabase.co` ni `pages.dev`: si algún día cambiás de proveedor, los stickers siguen andando.
5. Recomendado: *Security → WAF → Rate limiting rules*: limitar `URI Path starts with /api/` a, por ejemplo, 10 requests/minuto por IP (el bloqueo por código ya está en la base; esto agrega el límite por IP).

### 3. Primer lote
```bash
cd qr
npm install
cp .env.example .env        # completar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DOMINIO_BASE
node scripts/generar-lote.js --cantidad 5 --lote prueba-1 --dominio qr.tudominio.com
```
Genera `lotes/prueba-1/` con un PNG por QR y `lote-prueba-1.csv` (`codigo,activacion,archivo`) para imprimir en los stickers. **El CSV contiene los códigos en claro: no se sube a git** (ya está en `.gitignore`) y no se puede recuperar después, porque en la base solo queda el hash.

Opciones: `--formato png|svg` (png, 1000 px) · `--nivel L|M|Q|H` (Q) · `--salida lotes` · `--dry-run` (genera archivos sin tocar Supabase).
Los QR llevan 4 módulos de margen y corrección de errores nivel Q; con URLs de ~30 caracteres quedan en versión 3 (29×29 módulos), así que a 2 cm de lado cada módulo mide ~0,7 mm: escanean bien. Evitá bajar de ~1,5 cm y no recortes el margen blanco.

### 4. Anti-pausa
El plan gratis pausa el proyecto tras ~1 semana sin actividad. En GitHub: *Settings → Secrets and variables → Actions* → crear `SUPABASE_URL` y `SUPABASE_ANON_KEY`. El workflow corre cada ~3 días (y a mano desde la pestaña *Actions*). Ojo: GitHub desactiva los cron de repos sin actividad por 60 días; si pasa, hay que reactivarlo desde *Actions*.

### 5. Backups
`npm run backup` guarda `backups/qrs-FECHA.csv` (incluye los hashes: guardalo en un lugar privado). Correrlo de forma periódica. Si el volumen real justifica el costo, evaluar el plan pago de Supabase, que incluye backups.

## Operación (por SQL en Supabase Studio)

```sql
-- Deshabilitar / rehabilitar un QR
update qrs set habilitado = false where codigo = 'ABCD2345';
update qrs set habilitado = true  where codigo = 'ABCD2345';

-- Cambiar el link a mano o desbloquear un código
update qrs set url_destino = 'https://nuevo.com' where codigo = 'ABCD2345';
update qrs set intentos_fallidos = 0, bloqueado_hasta = null where codigo = 'ABCD2345';

-- Resetear un QR para que se pueda volver a activar (la activación original sigue valiendo)
update qrs set activo = false, url_destino = null, activado_en = null where codigo = 'ABCD2345';

-- Estado de un lote
select codigo, activo, habilitado, escaneos, ultimo_escaneo_en from qrs where lote = 'prueba-1';
```

## Pruebas

- Automáticas (`npm test`): generador (unicidad, formato, hash, PNG decodificable) y Functions (redirecciones, estados, validaciones) con Supabase simulado.
- `schema.sql` se probó contra Postgres 16: acceso directo denegado a `anon`, activar/editar/resolver, URL `javascript:` rechazada, bloqueo tras 5 fallos, deshabilitado.
- Manual antes de imprimir en serio (lote de 5): escanear con varios celulares y verificar → sin activar abre `/activar`; activar y escanear redirige; editar link redirige al nuevo; código incorrecto da error genérico; deshabilitar muestra "no disponible"; el contador `escaneos` sube.
