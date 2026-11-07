// Never inherit credentials, Node preload hooks or proxy settings from the host.
const osKeys = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'LANG', 'LC_ALL', 'TZ']);
const workerKeys = new Set(['LINGBO_MODEL_GATEWAY', 'LINGBO_MODEL_TOKEN', 'WORK_BROKER', 'WORK_TASK_ID', 'WORK_TICKET', 'VALIDATION_DATA', 'VALIDATION_MAX_TOKENS']);
export function workerEnvironment(extra = {}, parent = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(parent)) if (osKeys.has(key.toUpperCase()) && typeof value === 'string') result[key] = value;
  for (const [key, value] of Object.entries(extra)) {
    if (!workerKeys.has(key)) throw new Error('Unsupported worker environment field: ' + key);
    if (typeof value !== 'string') throw new Error('Worker environment fields must be strings');
    result[key] = value;
  }
  result.LINGBO_DIAGNOSTICS_METADATA_ONLY = '1';
  return result;
}
export const documentEnvironment = () => ({ ...workerEnvironment(), PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' });
