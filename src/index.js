const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function preflight() {
  return new Response(null, { status: 204, headers: HEADERS });
}

function originAllowed(request, env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  if (allowed === '*') return true;
  return request.headers.get('Origin') === allowed || !request.headers.get('Origin');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight();
    if (!originAllowed(request, env)) return json({ error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    if (url.pathname !== '/api/chat' || request.method !== 'POST') {
      return json({ error: 'Not found' }, 404);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Bad JSON' }, 400); }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = body.system || '';

    const contents = [];
    if (system) {
      contents.push({ role: 'user', parts: [{ text: system }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: String(m.content || '') }] });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return json({ error: 'Server misconfigured: missing API key' }, 500);

    const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
    const remote = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
          ]
        })
      }
    );

    const data = await remote.json();
    if (!remote.ok) {
      return json({ error: data?.error?.message || 'Upstream error' }, remote.status);
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('');
    return json({ reply: text });
  }
};
