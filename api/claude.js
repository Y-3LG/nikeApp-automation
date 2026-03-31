export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY no configurada' });
  }

  const { ref, name } = req.body || {};

  if (!ref || !name) {
    return res.status(400).json({ error: 'Faltan ref o name' });
  }

  try {
    // PASO 1: Encontrar URL oficial de Nike
    const findResult = await findNikeUrl({ apiKey, ref, name });

    if (findResult.status !== 'OK' || !findResult.url_nike) {
      return res.status(200).json({
        status: 'NO_ENCONTRADO',
        url_nike: '',
        description: ''
      });
    }

    // PASO 2: Generar descripción usando la URL encontrada
    const descResult = await generateDescription({
      apiKey,
      ref,
      name,
      url_nike: findResult.url_nike
    });

    if (descResult.status !== 'OK' || !descResult.description) {
      return res.status(200).json({
        status: 'NO_ENCONTRADO',
        url_nike: '',
        description: ''
      });
    }

    const normalized = normalizeDescription(descResult.description);
    const lines = normalized
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length !== 4) {
      return res.status(422).json({
        error: 'La descripción no tiene exactamente 4 líneas',
        raw: descResult
      });
    }

    return res.status(200).json({
      status: 'OK',
      url_nike: findResult.url_nike,
      description: lines.join('\n')
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Error interno'
    });
  }
}

async function findNikeUrl({ apiKey, ref, name }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://nikeapp-automation.vercel.app',
      'X-Title': 'Nike Description Automation'
    },
    body: JSON.stringify({
      model: 'perplexity/sonar',
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nike_url_result',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['OK', 'NO_ENCONTRADO']
              },
              url_nike: {
                type: 'string'
              }
            },
            required: ['status', 'url_nike'],
            additionalProperties: false
          }
        }
      },
      messages: [
        {
          role: 'system',
          content: `
Eres un asistente que localiza productos Nike por referencia exacta.

REGLAS:
- Busca una URL oficial de Nike para la referencia exacta.
- Prioriza coincidencia exacta de la referencia sobre el nombre.
- Solo acepta dominios oficiales de Nike.
- Si encuentras una URL oficial razonablemente confiable, responde status "OK".
- Si no la encuentras, responde status "NO_ENCONTRADO".
- Devuelve SOLO JSON válido.
          `.trim()
        },
        {
          role: 'user',
          content: `
Referencia exacta: "${ref}"
Nombre: "${name}"

Devuelve este formato:
{
  "status": "OK" o "NO_ENCONTRADO",
  "url_nike": "URL oficial de Nike o cadena vacía"
}
          `.trim()
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`
    );
  }

  if (data?.error) {
    throw new Error(data.error.message || 'Error devuelto por OpenRouter');
  }

  const parsed = extractStructuredContent(data);

  if (!parsed) {
    throw new Error('No se pudo obtener JSON válido al buscar la URL');
  }

  const status = parsed?.status;
  const url_nike = typeof parsed?.url_nike === 'string' ? parsed.url_nike.trim() : '';

  if (status !== 'OK' && status !== 'NO_ENCONTRADO') {
    throw new Error('Status inválido en búsqueda de URL');
  }

  if (status === 'OK') {
    if (!url_nike || !isNikeUrl(url_nike)) {
      return { status: 'NO_ENCONTRADO', url_nike: '' };
    }
    return { status: 'OK', url_nike };
  }

  return { status: 'NO_ENCONTRADO', url_nike: '' };
}

async function generateDescription({ apiKey, ref, name, url_nike }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://nikeapp-automation.vercel.app',
      'X-Title': 'Nike Description Automation'
    },
    body: JSON.stringify({
      model: 'perplexity/sonar',
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nike_description_result',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['OK', 'NO_ENCONTRADO']
              },
              description: {
                type: 'string'
              }
            },
            required: ['status', 'description'],
            additionalProperties: false
          }
        }
      },
      messages: [
        {
          role: 'system',
          content: `
Eres un asistente que redacta descripciones de catálogo de productos Nike.

REGLAS:
- Usa solo información verificable del producto enlazado.
- No inventes características, materiales, tecnologías, colores ni beneficios.
- Escribe en español.
- Devuelve exactamente 4 líneas.
- Cada línea debe ser breve, neutral y tipo catálogo.
- No uses viñetas, markdown, títulos ni texto extra.
- Si no puedes redactar con confianza usando la URL dada, responde NO_ENCONTRADO.
- Devuelve SOLO JSON válido.
          `.trim()
        },
        {
          role: 'user',
          content: `
Referencia: "${ref}"
Nombre: "${name}"
URL oficial de Nike: "${url_nike}"

Devuelve este formato:
{
  "status": "OK" o "NO_ENCONTRADO",
  "description": "texto en 4 líneas exactas o cadena vacía"
}
          `.trim()
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`
    );
  }

  if (data?.error) {
    throw new Error(data.error.message || 'Error devuelto por OpenRouter');
  }

  const parsed = extractStructuredContent(data);

  if (!parsed) {
    throw new Error('No se pudo obtener JSON válido al generar la descripción');
  }

  const status = parsed?.status;
  const description =
    typeof parsed?.description === 'string' ? parsed.description.trim() : '';

  if (status !== 'OK' && status !== 'NO_ENCONTRADO') {
    throw new Error('Status inválido en generación de descripción');
  }

  if (status === 'NO_ENCONTRADO') {
    return { status: 'NO_ENCONTRADO', description: '' };
  }

  return { status: 'OK', description };
}

function extractStructuredContent(data) {
  // Si el modelo devuelve contenido como string JSON
  const raw = data?.choices?.[0]?.message?.content?.trim();

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(extractJson(raw));
    } catch {
      return null;
    }
  }
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

function normalizeDescription(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[•*-]\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isNikeUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)nike\./i.test(parsed.hostname);
  } catch {
    return false;
  }
}