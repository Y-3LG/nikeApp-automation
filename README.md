# Nike Automation – Descripción de productos con IA

Este proyecto permite rellenar automáticamente las descripciones de un catálogo de productos Nike a partir de un archivo Excel con las columnas **referencia**, **nombre** y **descripción**. Solo se completan las filas sin descripción, utilizando un modelo de IA a través de OpenRouter.

## Flujo de trabajo

1. **Cargar un Excel** (`.xlsx`) que tenga la estructura: `referencia` | `nombre` | `descripción`.
2. La aplicación detecta las filas donde la descripción está vacía y se procesan una a una.
3. Para cada referencia vacía se hace una consulta a la API `/api/claude` que utiliza OpenRouter para buscar la ficha oficial en Nike, extraer la descripción y resumirla a 4 líneas neutrales en español.
4. Si la referencia se repite, se reutiliza la descripción previamente obtenida.
5. Al finalizar, se puede descargar un Excel actualizado con las columnas adicionales `status` y `url_nike`.

## Instalación y uso local

1. Necesitas **Node.js ≥ 18** instalado.
2. Instala las dependencias (no hay dependencias externas por defecto, pero se recomienda usar pnpm o npm para consistencia):
   ```bash
   npm install
   ```
3. Define la variable de entorno `OPENROUTER_API_KEY` con tu clave de OpenRouter. Esto se puede hacer creando un archivo `.env` o configurándolo en tu entorno de despliegue (por ejemplo, en Vercel).

   ```bash
   export OPENROUTER_API_KEY=sk-xxxx
   ```
4. Ejecuta el proyecto en modo de desarrollo con Vercel u otro servidor que soporte funciones serverless:

   ```bash
   vercel dev
   ```
   
   o desplegarlo directamente en [vercel.com](https://vercel.com/).

## API

La ruta `/api/claude` es el endpoint responsable de comunicarse con OpenRouter. Envía una referencia y un nombre en la carga `JSON` y devuelve un objeto con:

```
{
  "status": "OK" | "NO_ENCONTRADO",
  "url_nike": "URL oficial de Nike o cadena vacía",
  "description": "Descripción en 4 líneas o cadena vacía"
}
```

Si el modelo no puede verificar una página oficial de Nike, devuelve `NO_ENCONTRADO` y deja la descripción vacía. La variable de entorno `OPENROUTER_API_KEY` debe estar configurada para que este endpoint funcione correctamente.

## Configuración en Vercel

1. Importa el repositorio y elige la opción `Framework: Other`.
2. Define la variable de entorno `OPENROUTER_API_KEY` en el panel de configuración de Vercel.
3. Despliega el proyecto; Vercel detectará `vercel.json` y servirá el contenido de `/public` como frontend y las funciones en `/api` como API serverless.

## Limitaciones

Esta implementación utiliza un modelo de lenguaje para obtener y resumir la información. Aunque se han establecido reglas estrictas para no inventar descripciones y solo tomar información de páginas oficiales de Nike, la calidad y completitud de las respuestas dependen del servicio de OpenRouter y del estado de sus modelos. Para un flujo totalmente determinista se recomienda implementar un scraper de Nike y un resumidor propio.