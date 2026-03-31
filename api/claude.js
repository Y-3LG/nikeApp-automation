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

  const cleanRef = String(ref).trim();
  const cleanName = String(name).trim();

  const nikeSearchUrls = buildNikeSearchUrls(cleanRef);

  try {
    // PASO 1: localizar URL del producto usando URLs de búsqueda ya construidas
    const findResult = await findNikeProductUrl({
      apiKey,
      ref: cleanRef,
      name: cleanName,
      nikeSearchUrls
    });

    if (findResult.status !== 'OK' || !findResult.url_nike) {
      return res.status(200).json({
        status: 'NO_ENCONTRADO',
        url_nike: '',
        description: ''
      });
    }

    // PASO 2: generar descripción usando la URL del producto encontrada
    const descResult = await generateDescription({
      apiKey,
      ref: cleanRef,
      name: cleanName,
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

function buildNikeSearchUrls(ref) {
  const q = encodeURIComponent(ref);

  return [
    `https://www.nike.com/w?q=${q}&vst=${q}`,
    `https://www.nike.com/us/es/w?q=${q}&vst=${q}`
  ];
}

async function findNikeProductUrl({ apiKey, ref, name, nikeSearchUrls }) {
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
Eres un asistente que localiza páginas oficiales de productos Nike usando una referencia exacta.

REGLAS:
- NO busques desde cero libremente.
- Usa primero las URLs de búsqueda Nike proporcionadas por el usuario.
- Intenta localizar la página oficial del producto a partir de esas búsquedas.
- Prioriza coincidencia exacta de la referencia.
- Solo acepta URLs oficiales de Nike del producto, no la URL de búsqueda.
- Si encuentras una URL del producto claramente asociada a la referencia, responde "OK".
- Si no puedes encontrar una URL del producto confiable, responde "NO_ENCONTRADO".
- Devuelve SOLO JSON válido.
          `.trim()
        },
        {
          role: 'user',
          content: `
Referencia exacta: "${ref}"
Nombre: "${name}"

Prueba estas búsquedas Nike:
1. ${nikeSearchUrls[0]}
2. ${nikeSearchUrls[1]}

Devuelve este formato:
{
  "status": "OK" o "NO_ENCONTRADO",
  "url_nike": "URL oficial del producto Nike o cadena vacía"
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
    if (!url_nike || !isNikeProductUrl(url_nike, ref)) {
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

function isNikeProductUrl(url, ref) {
  try {
    const parsed = new URL(url);

    if (!/(^|\.)nike\./i.test(parsed.hostname)) return false;
    if (/\/w\?/i.test(parsed.pathname + parsed.search)) return false;

    const full = `${parsed.pathname}${parsed.search}${parsed.hash}`.toUpperCase();
    return full.includes(String(ref).toUpperCase());
  } catch {
    return false;
  }
}