import fs from 'node:fs';

const canonical = name => name.toLowerCase().replace(/[-_.]+/g, '-');

// This lock deliberately selects one wheel per package for Windows x64 / Python 3.12.
export function readPythonLock(file, requirementsFile) {
  const packages = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s]+) --hash=sha256:([a-f0-9]{64})$/.exec(line);
    if (!match || packages[canonical(match[1])]) throw new Error('Invalid or duplicate Python wheel lock entry');
    packages[canonical(match[1])] = match[2];
  }
  if (!Object.keys(packages).length) throw new Error('Empty Python wheel lock');
  if (requirementsFile) for (const raw of fs.readFileSync(requirementsFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z0-9_.-]+)==([^\s]+)$/.exec(line);
    if (!match || packages[canonical(match[1])] !== match[2]) throw new Error('Python lock differs from direct requirements');
  }
  return packages;
}

export function verifyPythonPackages(expected, actual) {
  const normalized = Object.fromEntries(Object.entries(actual).map(([name, version]) => [canonical(name), version]));
  if (Object.keys(expected).length !== Object.keys(normalized).length || Object.entries(expected).some(([name, version]) => normalized[name] !== version)) throw new Error('Bundled Python distributions differ from the wheel lock');
}
