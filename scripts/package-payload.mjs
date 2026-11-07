import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { workerEnvironment } from '../runtime/worker-environment.mjs';
import { readPythonLock, verifyPythonPackages } from './python-lock.mjs';
export const fileHash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function copyTree(source, target, { dependencies = false, pythonRuntime = false } = {}) {
  fs.cpSync(source, target, { recursive: true, dereference: true, filter: file => {
    const name = path.basename(file);
    return !['.git', '.local', '__pycache__', '.cache', '.bin', 'test', 'test-support', 'tests', '__tests__'].includes(name) && !(pythonRuntime && ['site-packages', 'Scripts', 'include', 'libs'].includes(name)) && !/^\.env(?:\.|$)/.test(name) && !/\.(?:dpapi|pyc|pfx|pem|key|sqlite3?|db)$/i.test(name) && (dependencies || name !== 'node_modules') && (dependencies || !/^test[-.].*\.m?js$/.test(name));
  } });
}
export function preparePayload({ sourceRoot, dependencyRoot, node, python, output }) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 packaging requires a Windows x64 build host');
  const lockFile = path.join(sourceRoot, 'requirements-windows.lock');
  const lockedPackages = readPythonLock(lockFile, path.join(sourceRoot, 'requirements.txt'));
  const inputPython = execFileSync(path.join(python, 'python.exe'), ['-I', '-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8', windowsHide: true }).trim();
  if (!inputPython.startsWith('3.12.')) throw new Error('The wheel lock requires Python 3.12');
  for (const directory of [sourceRoot, dependencyRoot, python]) if (!fs.statSync(directory).isDirectory()) throw new Error('Missing explicit packaging input');
  if (fs.existsSync(output)) throw new Error('Payload target already exists; choose a new output directory');
  const service = path.join(output, 'service'); fs.mkdirSync(service, { recursive: true });
  for (const name of ['backend', 'runtime', 'speech']) copyTree(path.join(sourceRoot, name), path.join(service, name));
  for (const name of ['src', 'scripts']) if (fs.existsSync(path.join(sourceRoot, 'engine', name))) copyTree(path.join(sourceRoot, 'engine', name), path.join(service, 'engine', name));
  fs.copyFileSync(path.join(sourceRoot, 'engine/package.json'), path.join(service, 'engine/package.json'));
  fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(service, 'package.json'));
  if (!process.env.LINGBO_PNPM_CLI) throw new Error('请提供 LINGBO_PNPM_CLI，使用 hoisted 布局装配独立依赖');
  const installEnv = { ...workerEnvironment(), npm_config_registry: 'https://registry.npmjs.org/', npm_config_userconfig: path.join(output, 'empty.npmrc'), pnpm_config_pm_on_fail: 'ignore' };
  fs.writeFileSync(installEnv.npm_config_userconfig, '');
  if (process.env.LINGBO_BUILD_PROXY) Object.assign(installEnv, { HTTPS_PROXY: process.env.LINGBO_BUILD_PROXY, HTTP_PROXY: process.env.LINGBO_BUILD_PROXY });
  for (const name of ['engine', 'speech']) {
    const target = path.join(service, name), lock = path.join(sourceRoot, name, 'package-lock.json');
    if (fs.existsSync(lock)) { fs.copyFileSync(lock, path.join(target, 'package-lock.json')); execFileSync(process.execPath, [process.env.LINGBO_PNPM_CLI, '--dir', target, 'import'], { windowsHide: true, stdio: 'inherit', timeout: 180000, env: installEnv }); }
    execFileSync(process.execPath, [process.env.LINGBO_PNPM_CLI, '--dir', target, 'install', '--prod', '--ignore-scripts', '--node-linker=hoisted'], { windowsHide: true, stdio: 'inherit', timeout: 240000, env: installEnv });
  }
  const nativePackage = fs.realpathSync(path.join(dependencyRoot, 'engine/node_modules/better-sqlite3'));
  const nativeVersion = JSON.parse(fs.readFileSync(path.join(nativePackage, 'package.json'))).version;
  if (JSON.parse(fs.readFileSync(path.join(service, 'engine/node_modules/better-sqlite3/package.json'))).version !== nativeVersion) throw new Error('SQLite 缓存版本与包内版本不一致');
  const nativeTarget = path.join(service, 'engine/node_modules/better-sqlite3/build/Release'); fs.mkdirSync(nativeTarget, { recursive: true });
  const nativeFile = path.join(nativePackage, 'build/Release/better_sqlite3.node'); fs.copyFileSync(nativeFile, path.join(nativeTarget, 'better_sqlite3.node'));
  fs.mkdirSync(path.join(output, 'node-runtime'), { recursive: true }); fs.copyFileSync(node, path.join(output, 'node-runtime/node.exe'));
  copyTree(python, path.join(output, 'python'), { dependencies: true, pythonRuntime: true });
  const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-compile', '--require-hashes', '--only-binary=:all:', '--index-url', 'https://pypi.org/simple', '--target', path.join(output, 'python/Lib/site-packages'), '-r', lockFile];
  if (process.env.LINGBO_BUILD_PROXY) pipArgs.push('--proxy', process.env.LINGBO_BUILD_PROXY);
  execFileSync(path.join(python, 'python.exe'), pipArgs, { windowsHide: true, stdio: 'inherit', timeout: 240000, env: { ...process.env, PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PYTHONNOUSERSITE: '1' } });
  fs.copyFileSync(path.join(sourceRoot, 'THIRD-PARTY-NOTICES.md'), path.join(output, 'THIRD-PARTY-NOTICES.md'));
  const runtimeVersion = execFileSync(node, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
  const pythonVersion = execFileSync(path.join(output, 'python/python.exe'), ['-I', '-c', 'import sys,json,av,numpy,docx,pptx,openpyxl,lxml,pypdf;from importlib.metadata import distributions;print(json.dumps({"python":sys.version.split()[0],"packages":{d.metadata["Name"]:d.version for d in distributions()}}))'], { encoding: 'utf8', windowsHide: true }).trim();
  const pythonInfo = JSON.parse(pythonVersion);
  if (!pythonInfo.python.startsWith('3.12.')) throw new Error('The wheel lock requires Python 3.12');
  verifyPythonPackages(lockedPackages, pythonInfo.packages);
  fs.copyFileSync(lockFile, path.join(output, 'python/requirements-windows.lock'));
  execFileSync(path.join(output, 'node-runtime/node.exe'), ['--input-type=module', '-e', 'import Database from "better-sqlite3"; const db=new Database(":memory:");db.exec("SELECT 1");db.close();'], { cwd: path.join(service, 'engine'), windowsHide: true, stdio: 'pipe' });
  const manifest = { format: 1, version: '0.3.4-test', serviceEntry: 'service/backend/server.mjs', node: { version: runtimeVersion, sha256: fileHash(node) }, sqlite: { version: nativeVersion, sha256: fileHash(nativeFile), source: 'same-version cached native addon; in-package ABI probe passed' }, python: { ...pythonInfo, requirementsSha256: fileHash(path.join(sourceRoot, 'requirements.txt')), lockFile: 'python/requirements-windows.lock', lockSha256: fileHash(lockFile) }, sourceFiles: {} };
  for (const relative of ['backend/server.mjs', 'backend/event-feed.mjs', 'backend/privacy.html', 'backend/work-service.mjs', 'backend/service-config.mjs', 'backend/windows-secret-store.mjs', 'backend/service-probe.mjs', 'backend/audio-decoder.mjs', 'backend/work-tools.mjs', 'backend/work-office.py', 'backend/documents.py', 'backend/work-schema.mjs', 'backend/work-acceptance.mjs', 'runtime/worker-process.mjs', 'runtime/worker-environment.mjs', 'engine/src/llm.js', 'engine/src/runtime/action-contract.js']) manifest.sourceFiles[relative] = fileHash(path.join(service, relative));
  fs.writeFileSync(path.join(output, 'package-manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
