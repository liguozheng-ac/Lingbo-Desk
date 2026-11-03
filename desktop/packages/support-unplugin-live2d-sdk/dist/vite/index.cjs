'use strict';

const node_buffer = require('node:buffer');
const promises = require('node:fs/promises');
const node_path = require('node:path');
const ofetch = require('ofetch');
const vite = require('vite');
const node_fs = require('node:fs');
const yauzl = require('yauzl');

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
    await promises.stat(path);
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
    yauzl.fromBuffer(buffer, { lazyEntries: true }, noError(reject, (zipFile) => {
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          node_fs.mkdirSync(node_path.join(target, entry.fileName), { recursive: true });
          zipFile.readEntry();
          return;
        }
        const dir = node_path.dirname(node_path.join(target, entry.fileName));
        if (!node_fs.existsSync(dir)) {
          node_fs.mkdirSync(dir, { recursive: true });
        }
        pendingWrites++;
        zipFile.openReadStream(entry, noError(reject, (readStream) => {
          const file = node_fs.createWriteStream(node_path.join(target, entry.fileName));
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
      const logger = vite.createLogger();
      const cacheDir = node_path.resolve(node_path.join(config.root, ".cache"));
      const publicDir = node_path.resolve(node_path.join(config.root, "public"));
      try {
        if (!await exists(node_path.resolve(node_path.join(cacheDir, "assets", "js", "CubismSdkForWeb-5-r.3")))) {
          logger.info("Downloading Cubism SDK...");
          const stream = await ofetch.ofetch(from, { responseType: "arrayBuffer" });
          logger.info("Unzipping Cubism SDK...");
          await promises.mkdir(node_path.join(cacheDir, "assets", "js"), { recursive: true });
          await unzip(node_buffer.Buffer.from(stream), node_path.join(cacheDir, "assets", "js"));
          logger.info("Cubism SDK downloaded and unzipped.");
        }
        if (!await exists(node_path.resolve(node_path.join(publicDir, "assets", "js", "CubismSdkForWeb-5-r.3")))) {
          await promises.mkdir(node_path.join(publicDir, "assets", "js", "CubismSdkForWeb-5-r.3", "Core"), { recursive: true }).catch(() => {
          });
          await promises.copyFile(
            node_path.join(cacheDir, "assets", "js", "CubismSdkForWeb-5-r.3", "Core", "live2dcubismcore.min.js"),
            node_path.join(publicDir, "assets", "js", "CubismSdkForWeb-5-r.3", "Core", "live2dcubismcore.min.js")
          );
        }
      } catch (err) {
        console.error(err);
        throw err;
      }
    }
  };
}

exports.DownloadLive2DSDK = DownloadLive2DSDK;
