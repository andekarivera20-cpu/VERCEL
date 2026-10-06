const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 12;
const buckets = globalThis.__imageRateBuckets || (globalThis.__imageRateBuckets = new Map());

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString().split(',')[0].trim();
}

function allowed(ip) {
  const now = Date.now();
  const item = buckets.get(ip) || { start: now, count: 0 };
  if (now - item.start > WINDOW_MS) {
    item.start = now;
    item.count = 0;
  }
  item.count += 1;
  buckets.set(ip, item);
  return item.count <= MAX_REQUESTS;
}

function dimensionsFromSize(size) {
  if (size === '1536x1024') return { width: 1536, height: 1024 };
  if (size === '1024x1536') return { width: 1024, height: 1536 };
  return { width: 1024, height: 1024 };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  if (!allowed(getIp(req))) {
    return res.status(429).json({
      error: 'Demasiadas generaciones seguidas. Prueba de nuevo más tarde.'
    });
  }

  try {
    const { prompt, size = '1024x1024' } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Escribe una descripción más completa.' });
    }

    if (prompt.length > 1800) {
      return res.status(400).json({ error: 'El prompt es demasiado largo.' });
    }

    const { width, height } = dimensionsFromSize(size);
    const seed = Math.floor(Math.random() * 1000000000);

    const url = new URL(
      'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt.trim())
    );
    url.searchParams.set('model', 'flux');
    url.searchParams.set('width', String(width));
    url.searchParams.set('height', String(height));
    url.searchParams.set('seed', String(seed));
    url.searchParams.set('nologo', 'true');
    url.searchParams.set('private', 'true');
    url.searchParams.set('enhance', 'true');

    const apiRes = await fetch(url, {
      headers: { Accept: 'image/*' }
    });

    if (!apiRes.ok) {
      const message = await apiRes.text().catch(() => '');
      return res.status(apiRes.status).json({
        error: message || 'El generador gratuito ha rechazado la solicitud.'
      });
    }

    const contentType = apiRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await apiRes.arrayBuffer());
    const b64 = buffer.toString('base64');

    return res.status(200).json({
      image: `data:${contentType};base64,${b64}`
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Error interno generando la imagen.'
    });
  }
}
