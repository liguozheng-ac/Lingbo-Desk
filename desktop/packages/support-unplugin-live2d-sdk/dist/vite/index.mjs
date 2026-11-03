import { Buffer } from 'node:buffer';
import { stat, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { ofetch } from 'ofetch';
import { createLogger } from 'vite';
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { fromBuffer } from 'yauzl';

function rejectIfError(error, reject, handler) {
  if (error) {
    reject(error);
    !!handler && handler(error);
  }
}
function onError(reject, handler) {
  return (error) => rejectIfError(error, reject, handler);
}
function noError(reject, fn) {
  return (err, ...args) => {
    if (err) {
      rejectIfError(err, reject);
      return;
    }
    return fn(...args);
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isENOENTError(error))
      return false;
    throw error;
  }
}
function isENOENTError(error) {
  if (!(error instanceof Error))
    return false;
  if (!("code" in error))
    return false;
  if (error.code !== "ENOENT")
    return false;
  return true;
}

async function unzip(buffer, target) {
  return new Promise((resolve, reject) => {
    let pendingWrites = 0;
    let isReadingComplete = false;
    function tryResolve() {
      if (isReadingComplete && pendingWrites === 0) {
        resolve();
      }
    }
    fromBuffer(buffer, { lazyEntries: true }, noError(reject, (zipFile) => {
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          mkdirSync(join(target, entry.fileName), { recursive: true });
          zipFile.readEntry();
          return;
        }
        const dir = dirname(join(target, entry.fileName));
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        pendingWrites++;
        zipFile.openReadStream(entry, noError(reject, (readStream) => {
          const file = createWriteStream(join(target, entry.fileName));
          readStream.pipe(file);
          file.on("error", (err) => {
            pendingWrites--;
            zipFile.close();
            reject(err);
          });
          file.on("finish", () => {
            file.close(() => {
              pendingWrites--;
              tryResolve();
              zipFile.readEntry();
            });
          });
        }));
      });
      zipFile.on("error", onError(reject, zipFile.close));
      zipFile.on("end", noError(reject, () => {
        isReadingComplete = true;
        tryResolve();
      }));
    }));
  });
}

function DownloadLive2DSDK(options) {
  return {
    name: `download-live2d-cubism-sdk`,
    async configResolved(config) {
      const {
        from = "https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.3.zip"
      } = options || {
        from: "https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.3.zip"
      };
      const logger = createLogger();
      const cacheDir = resolve(join(config.root, ".cache"));
      const publicDir = resolve(join(config.root, "public"));
      try {
        if (!await exists(resolve(join(cacheDir, "assets", "js", "CubismSdkForWeb-5-r.3")))) {
          logger.info("Downloading Cubism SDK...");
          const stream = await ofetch(from, { responseType: "arrayBuffer" });
          logger.info("Unzipping Cubism SDK...");
          await mkdir(join(cacheDir, "assets", "js"), { recursive: true });
          await unzip(Buffer.from(stream), join(cacheDir, "assets", "js"));
          logger.info("Cubism SDK downloaded and unzipped.");
        }
        if (!await exists(resolve(join(publicDir, "assets", "js", "CubismSdkForWeb-5-r.3")))) {
          await mkdir(join(publicDir, "assets", "js", "CubismSdkForWeb-5-r.3", "Core"), { recursive: true }).catch(() => {
          });
          await copyFile(
            join(cacheDir, "assets", "js", "CubismSdkForWeb-5-r.3", "Core", "live2dcubismcore.min.js"),
            join(publicDir, "assets", "js", "CubismSdkForWeb-5-r.3", "Core", "live2dcubismcore.min.js")
          );
        }
      } catch (err) {
        console.error(err);
        throw err;
      }
    }
  };
}

export { DownloadLive2DSDK };
