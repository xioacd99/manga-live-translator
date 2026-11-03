// 仅用于云测试准备：生产扩展在用户明确触发后自行下载，构建包不包含模型权重。
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DETECTOR_MODEL} from '../extension/model-store.js';
const path=process.env.TEST_MODEL_PATH||'.test-models/detector.onnx';
function valid(bytes){return bytes.length===DETECTOR_MODEL.bytes&&createHash('sha256').update(bytes).digest('hex')===DETECTOR_MODEL.sha256;}
let bytes;try{bytes=await readFile(path);}catch{}
if(!bytes||!valid(bytes)){
 const response=await fetch(DETECTOR_MODEL.url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error(`测试模型下载失败：HTTP ${response.status}`);
 bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw new Error('测试模型大小或 SHA256 不匹配。');
 await mkdir('.test-models',{recursive:true});await writeFile(path,bytes);
}
console.log(`已校验测试专用模型 ${bytes.length} 字节；不进入 dist。`);
