import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export const python=process.env.VOICE_PYTHON || (fs.existsSync(local)?local:process.platform==='win32'?'python':'python3');
