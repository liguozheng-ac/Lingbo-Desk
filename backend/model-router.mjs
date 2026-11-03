export const profiles = Object.freeze({
  deepseek: { id: 'deepseek', name: 'DeepSeek 云端', model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/chat/completions', timeout: 60000 },
  ollama: { id: 'ollama', name: 'Ollama 本地 Qwen3.5-9B', model: 'qwen3.5:9b', endpoint: 'http://127.0.0.1:11434/v1/chat/completions', timeout: 180000 },
});
export class ModelRouter {
  constructor(store, cloudKey, fetchImpl = fetch) { this.store = store; this.cloudKey = cloudKey; this.fetch = fetchImpl; this.turns = new Map(); this.active = 0; }
  choice(id = this.store.state.model) { if (!profiles[id]) throw new Error('模型选择无效'); return profiles[id]; }
  forTurn(session, turn) {
    const now = Date.now(); for (const [key, value] of this.turns) if (value.expires < now) this.turns.delete(key);
    if (!turn) return this.choice();
    const key = JSON.stringify([session, turn]);
    if (!this.turns.has(key)) { if (this.turns.size >= 200) this.turns.delete(this.turns.keys().next().value); this.turns.set(key, { id: this.store.state.model, expires: now + 30 * 60 * 1000 }); }
    return this.choice(this.turns.get(key).id);
  }
  body(value, profile) {
    const body = { ...value, model: profile.model, max_tokens: Math.min(Math.max(1, Number(value.max_completion_tokens ?? value.max_tokens) || 600), 6000) };
    delete body.max_completion_tokens;
    delete body.thinking; delete body.reasoning; delete body.reasoning_effort;
    if (profile.id === 'deepseek') body.thinking = { type: 'disabled' };
    else body.reasoning_effort = 'none';
    return body;
  }
  async request(value, profile, signal) {
    if (profile.id === 'deepseek' && !this.cloudKey) throw new Error('DeepSeek 凭据未配置');
    try {
      return await this.fetch(profile.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${profile.id === 'deepseek' ? this.cloudKey : 'ollama'}`, 'Content-Type': 'application/json' }, body: JSON.stringify(this.body(value, profile)), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(profile.timeout)]) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`${profile.name} 连接失败或超时；请检查对应服务。没有自动切换到其他模型。`, { cause: error });
    }
  }
  async probe(id, signal) {
    const profile = this.choice(id), begin = Date.now();
    const response = await this.request({ messages: [{ role: 'user', content: '只回复 OK。' }], max_tokens: 24, stream: false }, profile, signal);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${profile.name} 检查失败（HTTP ${response.status}）`); }
    const value = await response.json();
    if (!value.choices?.[0]?.message?.content?.trim()) throw new Error(`${profile.name} 没有返回正文`);
    return { id, model: profile.model, elapsedMs: Date.now() - begin, reply: value.choices[0].message.content };
  }
}
