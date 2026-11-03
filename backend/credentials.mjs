import fs from 'node:fs';
export function credentials() {
  const configured=process.env.LINGBO_SPEECH_CONFIG;
  const speech=configured?JSON.parse(fs.readFileSync(configured,'utf8')):{
    asr:{aliyunApiKey:process.env.ALIYUN_ASR_API_KEY || ''},
    tts:{provider:'doubao',keys:{doubaoKey:process.env.DOUBAO_TTS_API_KEY || ''}},
  };
  const deepseekKey=process.env.DEEPSEEK_API_KEY || '';
  if(!deepseekKey) throw new Error('请设置 DEEPSEEK_API_KEY。可参考仓库根目录 .env.example。');
  return {deepseekKey,speech};
}
