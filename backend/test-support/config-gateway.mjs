// Only the two LLM endpoints are replaced; no cloud request is made by this fixture.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.deepseek.com' || (url.hostname === '127.0.0.1' && url.port === '11434')) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, options);
};
await import('../server.mjs');
