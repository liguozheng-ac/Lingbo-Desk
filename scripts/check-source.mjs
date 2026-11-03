import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const denyArg=process.argv.find(a=>a.startsWith('--deny-regex='));
const deny=denyArg?new RegExp(denyArg.slice('--deny-regex='.length),'i'):null;
const violations=[];let textFiles=0,bytes=0;
for(const relative of paths){
 const file=path.join(root,relative);const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()){violations.push({file:relative,reason:'Only regular source files can be published'});continue;}
 bytes+=stat.size;
 if(stat.size>50*1024*1024)violations.push({file:relative,reason:'Large generated or binary file'});
 if(/(?:^|\/)(?:node_modules|\.local|runs|out|\.git|\.venv)(?:\/|$)|\.(?:dpapi|pfx|pem|sqlite3?|db|exe|dll|moc3?|vrm|zip)$/i.test(relative))violations.push({file:relative,reason:'Private, runtime or locally licensed asset'});
 const buffer=fs.readFileSync(file);
 if(buffer.includes(0))continue;
 const text=buffer.toString('utf8');textFiles++;
 if(deny&&(deny.test(relative)||deny.test(text)))violations.push({file:relative,reason:'Rejected name or identifier'});
 if(/(?:D:[\\/]Agent-Projects[\\/]|C:[\\/]Users[\\/](?!Public\b|Default\b)[^\s'"<>]+)/i.test(text))violations.push({file:relative,reason:'Machine-specific absolute path'});
 // Show file names only. Never echo a matched credential.
 if(!/(?:^|\/)test(?:-support)?\//.test(relative)&&/\bsk-[a-f0-9]{32}\b/i.test(text))violations.push({file:relative,reason:'Credential-shaped literal'});
}
console.log(JSON.stringify({files:paths.length,textFiles,bytes,violations,passed:violations.length===0},null,2));
process.exitCode=violations.length?1:0;
