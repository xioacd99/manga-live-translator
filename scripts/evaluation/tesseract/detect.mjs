import {pathToFileURL} from 'node:url';
import path from 'node:path';
const [root,modelDir,ortDir,repoRoot]=process.argv.slice(2);
if(!root||!modelDir||!ortDir||!repoRoot)throw Error('需要output model-dir ort-dir repo-root四个参数');
const ort=await import(pathToFileURL(path.join(ortDir,'dist/ort.node.min.mjs')).href);
import fs from 'node:fs/promises';
const {planDetectorTiles,decodePretrainedOutputs,selectPretrainedRegions}=await import(pathToFileURL(path.join(repoRoot,'extension/adapters/pretrained-regions.js')).href);

ort.env.wasm.numThreads=1;
let t=performance.now();const session=await ort.InferenceSession.create(new Uint8Array(await fs.readFile(path.join(modelDir,'detector-v4-s_int8.onnx'))),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
const out={runtime:'onnxruntime-web WASM single thread',init_ms:performance.now()-t,samples:[]};
for (const s of JSON.parse(await fs.readFile(`${root}/detector-input.json`,'utf8'))) {
 const tiles=planDetectorTiles(s.width,s.height);if(JSON.stringify(tiles)!==JSON.stringify(s.tiles.map(({raw,...x})=>x)))throw Error('Tile plan mismatch');
 const sample={id:s.id,preprocess_ms:s.preprocess_ms,runs:[]};
 for(let rep=0;rep<3;rep++){
  t=performance.now();const candidates=[];let inference_ms=0;
  for(const tile of s.tiles){
   const pixels=await fs.readFile(tile.raw),a=new Float32Array(3*640*640);
   for(let i=0;i<640*640;i++)for(let c=0;c<3;c++)a[c*640*640+i]=pixels[i*3+c]/255;
   const feeds={images:new ort.Tensor('float32',a,[1,3,640,640]),orig_target_sizes:new ort.Tensor('int64',BigInt64Array.from([BigInt(tile.width),BigInt(tile.height)]),[1,2])};
   const it=performance.now(),o=await session.run(feeds);inference_ms+=performance.now()-it;
   candidates.push(...decodePretrainedOutputs(o,tile));for(const x of Object.values(o))x.dispose();for(const x of Object.values(feeds))x.dispose();
  }
  const selection=selectPretrainedRegions(candidates,s.width,s.height);sample.runs.push({phase:['first','warm1','warm2'][rep],selection,candidates,inference_ms,total_ms:performance.now()-t});
 }
 out.samples.push(sample);console.log('detect',s.id,sample.runs[0].selection.regions.length);
}
await session.release();await fs.writeFile(`${root}/detector-results.json`,JSON.stringify(out,null,2));
