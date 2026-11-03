import {build} from 'esbuild';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await rm('dist',{recursive:true,force:true});await mkdir('dist/vendor/core',{recursive:true});await mkdir('dist/vendor/lang',{recursive:true});
for(const entry of ['background','content','offscreen','popup','options'])await build({entryPoints:[`extension/${entry}.js`],bundle:true,outfile:`dist/${entry}.js`,format:'iife',platform:'browser',target:'chrome116',logLevel:'warning'});
for(const file of ['manifest.json','popup.html','options.html','offscreen.html','ui.css'])await cp(`extension/${file}`,`dist/${file}`);
await cp('node_modules/tesseract.js/dist/worker.min.js','dist/vendor/worker.min.js');
for(const file of await readdir('node_modules/tesseract.js-core'))if(/\.wasm(?:\.js)?$/.test(file))await cp(`node_modules/tesseract.js-core/${file}`,`dist/vendor/core/${file}`);
await cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','dist/vendor/lang/eng.traineddata.gz');
const modelHash=createHash('sha256').update(await readFile('dist/vendor/lang/eng.traineddata.gz')).digest('hex');
if(modelHash!=='45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91')throw new Error('Pinned OCR model hash mismatch.');
const assets={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await walk(path);else assets[path.slice(5)]={sha256:createHash('sha256').update(await readFile(path)).digest('hex'),bytes:(await readFile(path)).length};}}await walk('dist/vendor');
await writeFile('dist/asset-manifest.json',JSON.stringify(assets,null,2)+'\n');
await cp('LICENSE','dist/LICENSE');await mkdir('dist/notices',{recursive:true});
for(const [pkg,name] of [['tesseract.js','tesseract-js'],['tesseract.js-core','tesseract-core']])await cp(`node_modules/${pkg}/${pkg==='tesseract.js'?'LICENSE.md':'LICENSE'}`,`dist/notices/${name}-LICENSE`);
console.log('Built dist/ with local OCR worker, WASM and English model assets.');

await cp('extension/notices','dist/notices',{recursive:true});
await cp('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt','dist/vendor/worker.min.js.LICENSE.txt');
