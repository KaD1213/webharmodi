// Dependency-free release check and cache versioning for GitHub Pages.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const read=name=>readFileSync(new URL(name,root));
const normalize=text=>text.replace(/((?:style\.css|themes\.css|app\.js)\?v=)[^"']+/g,'$1RELEASE').replace(/const release='[^']+';/,"const release='RELEASE';");
const files=['index.html','app.js','style.css','themes.css','adaptive-ji.mjs','tap-tempo.mjs','pendulum-motion.mjs','meter-state.mjs','pitch-detector.mjs','pitch-tuner.mjs','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'];
const hash=createHash('sha256');
for(const name of files){const bytes=read(name);hash.update(name);hash.update(name.endsWith('.png')?bytes:normalize(bytes.toString('utf8')));}
for(const name of ['app.js','adaptive-ji.mjs','tap-tempo.mjs','pendulum-motion.mjs','pitch-detector.mjs','pitch-tuner.mjs','sw.js'])execFileSync(process.execPath,['--input-type=module','--check'],{input:read(name),stdio:['pipe','pipe','pipe']});
const manifest=JSON.parse(read('manifest.webmanifest'));
for(const icon of manifest.icons)read(icon.src);
const release=hash.digest('hex').slice(0,16);
const html=read('index.html').toString('utf8').replace(/((?:style\.css|themes\.css|app\.js)\?v=)[^"]+/g,'$1'+release);
const worker=read('sw.js').toString('utf8').replace(/const release='[^']+';/,"const release='"+release+"';");
writeFileSync(new URL('index.html',root),html);writeFileSync(new URL('sw.js',root),worker);
console.log('WebHarmoDi. release '+release+' checked: '+fileURLToPath(root));
