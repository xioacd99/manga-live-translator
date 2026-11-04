import {build} from 'esbuild';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const entry of ['background','content','offscreen','popup','options'])await build({entryPoints:[`extension/${entry}.js`],bundle:true,outfile:`dist/${entry}.js`,format:'iife',platform:'browser',target:'chrome116',logLevel:'warning'});
for(const file of ['manifest.json','popup.html','options.html','offscreen.html','ui.css'])await cp(`extension/${file}`,`dist/${file}`);
await cp('LICENSE','dist/LICENSE');await cp('extension/notices','dist/notices',{recursive:true});
// Python 服务单独安装；浏览器产物不再携带废弃的 Tesseract 或 WASM OCR 权重。
const assets={};for(const file of await readdir('dist')){if(!/\.(js|html|css|json)$/.test(file))continue;const bytes=await readFile(`dist/${file}`);assets[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}
await writeFile('dist/asset-manifest.json',JSON.stringify(assets,null,2)+'\n');
console.log('Built dist/: authenticated Python loopback OCR; no browser OCR model bundled.');
