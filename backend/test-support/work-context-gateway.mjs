// Fixture-only model echo: exercises the real HTTP routing without external API.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.deepseek.com') {
    const value = JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({system:value.messages.filter(m=>m.role==='system').map(m=>m.content),tools:value.tools})}}]}),{headers:{'Content-Type':'application/json'}});
  }
  return originalFetch(input, options);
};
await import('../server.mjs');
