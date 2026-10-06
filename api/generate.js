const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const buckets = globalThis.__imageRateBuckets || (globalThis.__imageRateBuckets = new Map());

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim();
}
function allowed(ip) {
  const now = Date.now();
  const item = buckets.get(ip) || { start: now, count: 0 };
  if (now - item.start > WINDOW_MS) { item.start = now; item.count = 0; }
  item.count += 1;
  buckets.set(ip, item);
  return item.count <= MAX_REQUESTS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'Falta configurar OPENAI_API_KEY en Vercel.' });
  if (!allowed(getIp(req))) return res.status(429).json({ error: 'Demasiadas generaciones seguidas. Prueba de nuevo más tarde.' });

  try {
    const { prompt, size = '1024x1024', quality = 'medium' } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Escribe una descripción más completa.' });
    }
    if (prompt.length > 2200) return res.status(400).json({ error: 'El prompt es demasiado largo.' });

    const safeSizes = new Set(['1024x1024', '1536x1024', '1024x1536']);
    const safeQualities = new Set(['low', 'medium', 'high']);

    const apiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-2.5-sunburst',
        prompt: prompt.trim(),
        size: safeSizes.has(size) ? size : '1024x1024',
        quality: safeQualities.has(quality) ? quality : 'medium',
        n: 1,
        output_format: 'jpeg',
        output_compression: 82
      })
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      const message = data?.error?.message || 'La API de imágenes ha rechazado la solicitud.';
      return res.status(apiRes.status).json({ error: message });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: 'La API no devolvió ninguna imagen.' });
    return res.status(200).json({ image: `data:image/jpeg;base64,${b64}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno generando la imagen.' });
  }
}
