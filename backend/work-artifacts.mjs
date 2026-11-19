import fs from 'node:fs';
import path from 'node:path';
import { hashFile, realTarget, within } from './work-policy.mjs';

const samePath = (a, b) => typeof a === 'string' && path.relative(a, b) === '';
const safeName = name => typeof name === 'string' && name.length > 0 && name.length < 240 && !/[\\/:\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && name !== '.' && name !== '..';

function sourceJob(service, job, id) {
  const source = service.find(job.sessionId, id);
  if (source.id === job.id || source.status !== 'completed' || source.worker || source.inTool || source.uncertain) throw new Error('只能导出当前会话中已完成且状态确定的其他工作任务产物');
  return source;
}
function artifact(service, source, name) {
  if (!safeName(name)) throw new Error('产物名称必须是单个文件名，不能包含目录或数据流');
  const file = service.policy.resolve(source, name);
  service.tools.checkSize(file);
  const receipt = source.receipts.findLast(r => r.ok && r.mutation && (samePath(r.path, file) || (['work_move', 'work_delete'].includes(r.tool) && samePath(r.source, file))));
  if (!receipt?.sha256 || !samePath(receipt.path, file) || receipt.tool === 'work_delete' || hashFile(file) !== receipt.sha256) throw new Error('产物缺少有效文件动作回执，或文件已经变化；请先在来源任务中核对');
  return { name, path: file, sha256: receipt.sha256, bytes: fs.statSync(file).size };
}
function destinationDirectory(service, job, directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('导出目标须为已授权资料文件夹的绝对路径');
  const target = service.policy.resolve(job, directory);
  // A read grant plus this one-file confirmation is enough; it never becomes a
  // general write grant. Internal output/config directories remain prohibited.
  if (!service.policy.state.roots.some(r => job.rootIds.includes(r.id) && within(r.path, target))) throw new Error('导出目标必须在本任务仍有效的资料文件夹授权内');
  if (!fs.statSync(target).isDirectory()) throw new Error('导出目标不是文件夹');
  return target;
}

export async function executeArtifactTool(service, job, tool, args, confirm, intent) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 8192 || typeof args.sourceTaskId !== 'string' || !/^work-[a-f0-9-]{36}$/.test(args.sourceTaskId)) throw new Error('产物工具参数无效');
  job.controller.signal.throwIfAborted();
  const source = sourceJob(service, job, args.sourceTaskId);
  if (tool === 'work_artifacts') {
    const files = fs.readdirSync(source.output, { withFileTypes: true }).filter(e => e.isFile() && !e.isSymbolicLink()).slice(0, 200).flatMap(e => {
      try { return [artifact(service, source, e.name)]; } catch { return []; }
    });
    return { value: { ok: true, sourceTaskId: source.id, files }, evidence: { sourceTaskId: source.id } };
  }
  const initial = artifact(service, source, args.name);
  const directory = destinationDirectory(service, job, args.directory);
  const refusalKey = JSON.stringify([job.version, source.id, initial.name, initial.sha256, directory]);
  if (job.declinedExports?.includes(refusalKey)) throw new Error('用户已拒绝这个版本的产物导出；不得换文件名重试，请修改要求后重新确认');
  const requestedPath = path.join(directory, initial.name), ext = path.extname(initial.name), stem = path.basename(initial.name, ext);
  let destination = requestedPath, suffix = 0;
  while (fs.existsSync(destination) && suffix < 1000) destination = path.join(directory, `${stem}(${++suffix})${ext}`);
  if (fs.existsSync(destination)) throw new Error('同名文件过多，请整理目标文件夹或选择其他目录');
  realTarget(destination);
  try {
    await confirm({ tool: 'work_export', sourceTaskId: source.id, path: initial.path, destination, requestedPath, sha256: initial.sha256, bytes: initial.bytes, warning: '仅复制这一份已完成产物；不覆盖、不删除、不移动任何现有文件。此次确认不增加文件夹的通用写权限。' });
  } catch (error) {
    if (error.code === 'USER_REFUSED') job.declinedExports = [...(job.declinedExports || []), refusalKey];
    throw error;
  }
  job.controller.signal.throwIfAborted();
  const current = artifact(service, sourceJob(service, job, source.id), args.name);
  if (current.sha256 !== initial.sha256) throw new Error('确认期间来源产物发生变化，请重新核对');
  destinationDirectory(service, job, directory); realTarget(destination);
  if (fs.existsSync(destination)) throw new Error('确认期间目标文件已出现，请重新请求导出并核对新文件名；未覆盖');
  intent({ tool: 'work_export', sourceTaskId: source.id, source: current.path, path: destination, destination, requestedPath, sha256: current.sha256 });
  fs.copyFileSync(current.path, destination, fs.constants.COPYFILE_EXCL);
  if (hashFile(destination) !== current.sha256 || hashFile(current.path) !== current.sha256) throw new Error('复制后的来源或目标 SHA256 校验失败，请检查记录；未自动重放');
  return { value: { ok: true, sourceTaskId: source.id, source: current.path, path: destination, requestedPath, sha256: current.sha256, renamed: destination !== requestedPath }, evidence: { mutation: true, sourceTaskId: source.id, source: current.path, path: destination, requestedPath, sha256: current.sha256 } };
}
