import type { FastifyReply, FastifyRequest } from 'fastify';

const DEFAULT_OPENCODE_URL = 'http://127.0.0.1:4096';

function authHeaders(): HeadersInit {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return {};
  const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}

function candidateUrls(): string[] {
  const urls = [process.env.OPENCODE_SERVER_URL, DEFAULT_OPENCODE_URL].filter(Boolean) as string[];
  return [...new Set(urls.map((url) => url.replace(/\/+$/, '')))];
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 700): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

export async function findOpenCodeServer(): Promise<string | null> {
  for (const url of candidateUrls()) {
    try {
      const res = await fetchWithTimeout(`${url}/global/health`);
      if (res.ok) return url;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function openCodeServerStatus(): Promise<{ connected: boolean; url: string | null; version: string | null }> {
  const url = await findOpenCodeServer();
  if (!url) return { connected: false, url: null, version: null };
  try {
    const res = await fetchWithTimeout(`${url}/global/health`);
    const body = await res.json() as { version?: string };
    return { connected: true, url, version: body.version ?? null };
  } catch {
    return { connected: true, url, version: null };
  }
}

async function openEventStream(url: string): Promise<Response> {
  const headers = { ...authHeaders(), Accept: 'text/event-stream' };
  try {
    const res = await fetch(`${url}/event`, { headers });
    if (res.ok && res.body) return res;
  } catch {
    // Older docs also mention /global/event.
  }
  return fetch(`${url}/global/event`, { headers });
}

export async function proxyOpenCodeEvents(
  req: FastifyRequest,
  reply: FastifyReply,
  onEvent: () => void,
): Promise<void> {
  const url = await findOpenCodeServer();
  if (!url) {
    reply.code(204).send();
    return;
  }

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write(`event: connected\ndata: ${JSON.stringify({ url })}\n\n`);

  const controller = new AbortController();
  req.raw.on('close', () => controller.abort());

  try {
    const res = await openEventStream(url);
    if (!res.ok || !res.body) {
      raw.write(`event: error\ndata: ${JSON.stringify({ status: res.status })}\n\n`);
      raw.end();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.includes('data:')) onEvent();
      raw.write(chunk);
    }
  } catch {
    if (!raw.destroyed) raw.write(`event: error\ndata: {}\n\n`);
  } finally {
    if (!raw.destroyed) raw.end();
  }
}
