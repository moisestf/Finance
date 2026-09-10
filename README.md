# Stock Ledger

Dashboard estático que sigue el precio de cierre diario real de una lista de tickers, se actualiza solo con GitHub Actions, y se sirve gratis con GitHub Pages.

Tickers iniciales: `PLTR, CLS, GOOG, AAPL, BRK-B, AXON, FIX`

## Cómo está armado

- `data/tickers.json` — lista de símbolos a seguir. Editar este archivo es la única forma de añadir/quitar tickers.
- `data/prices.json` — histórico diario (fecha, cierre, volumen) por ticker. Esto es la "base de datos": un JSON versionado por git.
- `scripts/fetch_prices.py` — descarga precios reales desde Yahoo Finance (librería `yfinance`, sin API key) y los mezcla en `prices.json`.
- `.github/workflows/update-prices.yml` — GitHub Action que corre el script de lunes a viernes y hace commit de los datos nuevos.
- `index.html` / `style.css` / `app.js` — el sitio (GitHub Pages), con Chart.js.

## Despliegue (una sola vez)

1. **Crea un repositorio nuevo en GitHub** (puede ser público; para Pages gratis en cuentas personales el repo debe ser público).
2. **Sube estos archivos** a la rama `main` (arrastra la carpeta en la web de GitHub, o por git):
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
3. **Permisos de Actions:** en el repo ve a `Settings → Actions → General → Workflow permissions` y elige **"Read and write permissions"**. Sin esto el Action no puede hacer commit de los precios.
4. **Corre el workflow por primera vez** (para no esperar al cron): pestaña `Actions → Update stock prices → Run workflow`. Esto llena `data/prices.json` con ~2 años de histórico para cada ticker.
5. **Activa GitHub Pages:** `Settings → Pages → Source: Deploy from a branch → Branch: main / (root)`.
6. Espera 1-2 minutos y visita `https://TU_USUARIO.github.io/TU_REPO/`.

De ahí en adelante, el Action corre solo de lunes a viernes a las 21:30 UTC (después del cierre del mercado de EE.UU.) y va agregando el día nuevo a `prices.json`.

## Añadir un ticker nuevo

Edita `data/tickers.json` y agrega el símbolo (formato Yahoo Finance, por ejemplo `BRK-B` para Berkshire clase B). Haz commit. En la siguiente ejecución del workflow, el script detecta que es nuevo y descarga 2 años de histórico automáticamente para que el gráfico no empiece vacío.

## Pedirle análisis a Claude

El archivo `data/prices.json` es la fuente de verdad y queda accesible en internet en:

```
https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main/data/prices.json
```

Dos formas de usarlo con Claude:
- Si tu Claude tiene navegación/búsqueda web activada, pégale esa URL y pídele que la revise y analice.
- O descarga el archivo (botón "Raw" en GitHub, o desde el repo clonado) y súbelo directamente al chat.

El formato es simple para que cualquier modelo lo entienda:

```json
{
  "meta": { "last_updated_utc": "2026-09-10T21:30:05+00:00", "tickers": ["PLTR", "..."] },
  "series": {
    "PLTR": [
      { "date": "2026-09-09", "close": 32.15, "volume": 45123000 },
      { "date": "2026-09-10", "close": 33.02, "volume": 39871200 }
    ]
  }
}
```

## Correr localmente (opcional)

```bash
pip install -r requirements.txt
python scripts/fetch_prices.py     # actualiza data/prices.json con precios reales
python -m http.server 8000         # sirve el sitio en http://localhost:8000
```

## Notas

- Los precios vienen de Yahoo Finance a través de `yfinance`; es una librería de terceros no oficial, útil para seguimiento personal, no pensada para uso en producción a gran escala.
- Todo el histórico vive en `data/prices.json` dentro del propio repo — no hay base de datos externa que mantener.
