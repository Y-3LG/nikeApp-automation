export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY no configurada' });
  }

  const { ref, name } = req.body || {};
  if (!ref || !name) {
    return res.status(400).json({ error: 'Faltan ref o name' });
  }

  try {
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
        messages: [
          {
            role: 'system',
            content: `
Eres un asistente que busca productos Nike y redacta descripciones de catálogo.

REGLAS ESTRICTAS:
- Usa solo información verificable de una fuente oficial de Nike.
- No inventes características, materiales, beneficios, tecnologías, colores ni usos.
- Si no puedes verificar una página oficial de Nike para esa referencia, responde con status NO_ENCONTRADO.
- La descripción debe estar en español.
- La descripción debe tener exactamente 4 líneas.
- Cada línea debe ser breve, clara y neutral, tipo catálogo.
- No uses viñetas, números, markdown, títulos ni texto extra.
- Devuelve SOLO un objeto JSON válido, sin explicación adicional.

Formato exacto de salida:
{
  "status": "OK" o "NO_ENCONTRADO",
  "url_nike": "URL oficial de Nike o cadena vacía",
  "description": "texto en 4 líneas exactas o cadena vacía"
}
            `.trim()
          },
          {
            role: 'user',
            content: `
Busca el producto Nike con:
Referencia: "${ref}"
Nombre: "${name}"

Devuelve únicamente el JSON solicitado.
            `.trim()
          }
        ]
      })
    });

    const data = await response.json();

    // 1) Si OpenRouter devolvió error HTTP real
    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        `OpenRouter HTTP ${response.status}`;
      return res.status(response.status).json({ error: message, raw: data });
    }

    // 2) Si vino un error embebido en el body
    if (data?.error) {
      return res.status(422).json({
        error: data.error.message || 'Error devuelto por OpenRouter',
        raw: data
      });
    }

    const raw = data?.choices?.[0]?.message?.content?.trim();

    if (!raw) {
      return res.status(422).json({
        error: 'OpenRouter respondió sin contenido útil',
        raw: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch (e) {
      return res.status(422).json({
        error: 'El modelo no devolvió JSON válido',
        raw
      });
    }

    const status = parsed?.status;
    const url_nike =
      typeof parsed?.url_nike === 'string' ? parsed.url_nike.trim() : '';
    let description =
      typeof parsed?.description === 'string' ? parsed.description.trim() : '';

    if (status !== 'OK' && status !== 'NO_ENCONTRADO') {
      return res.status(422).json({
        error: 'Status inválido devuelto por el modelo',
        raw: parsed
      });
    }

    if (status === 'NO_ENCONTRADO') {
      return res.status(200).json({
        status: 'NO_ENCONTRADO',
        url_nike: '',
        description: ''
      });
    }

    if (!url_nike || !/nike\./i.test(url_nike)) {
      return res.status(422).json({
        error: 'No se verificó una URL oficial de Nike',
        raw: parsed
      });
    }

    description = normalizeDescription(description);

    const lines = description
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length !== 4) {
      return res.status(422).json({
        error: 'La descripción no tiene exactamente 4 líneas',
        raw: parsed
      });
    }

    return res.status(200).json({
      status: 'OK',
      url_nike,
      description: lines.join('\n')
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'Error interno'
    });
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