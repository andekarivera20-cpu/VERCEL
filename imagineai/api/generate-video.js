const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 8;
const buckets = globalThis.__videoRateBuckets || (globalThis.__videoRateBuckets = new Map());

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  if (!process.env.POLLINATIONS_API_KEY) {
    return res.status(500).json({
      error: 'Falta configurar POLLINATIONS_API_KEY en Vercel para generar vídeos.'
    });
  }

  if (!allowed(getIp(req))) {
    return res.status(429).json({
      error: 'Has generado demasiados vídeos seguidos. Prueba de nuevo más tarde.'
    });
  }

  try {
    const {
      prompt,
      duration = 5,
      aspectRatio = '16:9',
      model = 'wan',
      audio = false
    } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Describe mejor el vídeo que quieres generar.' });
    }

    const safeDurations = new Set([5, 8, 10]);
    const safeRatios = new Set(['16:9', '9:16', '1:1']);
    const safeModels = new Set(['wan', 'veo', 'seedance']);

    const url = new URL(
      'https://gen.pollinations.ai/video/' + encodeURIComponent(prompt.trim())
    );
    url.searchParams.set('duration', String(safeDurations.has(Number(duration)) ? Number(duration) : 5));
    url.searchParams.set('aspectRatio', safeRatios.has(aspectRatio) ? aspectRatio : '16:9');
    url.searchParams.set('model', safeModels.has(model) ? model : 'wan');
    url.searchParams.set('audio', audio ? 'true' : 'false');

    const apiRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`,
        Accept: 'video/mp4,video/*'
      }
    });

    if (!apiRes.ok) {
      const raw = await apiRes.text().catch(() => '');
      let message = raw;
      try {
        const parsed = JSON.parse(raw);
        message = parsed?.error?.message || parsed?.error || parsed?.message || raw;
      } catch {}
      return res.status(apiRes.status).json({
        error: message || 'El proveedor de vídeo ha rechazado la solicitud.'
      });
    }

    const contentType = apiRes.headers.get('content-type') || 'video/mp4';
    const buffer = Buffer.from(await apiRes.arrayBuffer());
    const b64 = buffer.toString('base64');

    return res.status(200).json({
      video: `data:${contentType};base64,${b64}`
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Error interno generando el vídeo.'
    });
  }
}
