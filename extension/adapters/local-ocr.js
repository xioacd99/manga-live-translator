import {validateOCRResult} from '../../packages/core/schema.js';
import {validateDetectionResult} from '../../packages/core/pipeline.js';
import {inspectImage} from '../image-dimensions.js';

export const LOCAL_ADAPTER_REVISION='python-paddle-medium1536-rtdetr-v1';
// 环回地址与令牌只来自可信扩展设置；不允许路径、重定向或 DNS 别名。
export function localEndpoint(value) {
  if(typeof value!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value))throw new Error('仅支持 http://127.0.0.1:端口。');
  const url=new URL(value);if(Number(url.port||80)>65535||Number(url.port||80)<1024)throw new Error('无效端口。');return url.origin;
}
export function createLocalOcrAdapter({endpoint,token,fetchImpl=globalThis.fetch,timeoutMs=120000}={}) {
  const origin=localEndpoint(endpoint);
  if(typeof token!=='string'||token.length<32||token.length>128||!/^[A-Za-z0-9_-]+$/.test(token))throw new Error('本地服务令牌无效。');
  async function request(path,{method='GET',bytes,signal,mime}={}) {
    signal?.throwIfAborted();
    const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,['/ocr','/detect'].includes(path)?timeoutMs:Math.min(timeoutMs,5000));
    try {
      const response=await fetchImpl(origin+path,{method,headers:{Authorization:`Bearer ${token}`,...(bytes?{'Content-Type':mime}:{})},...(bytes?{body:bytes}:{}),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error(`本地 OCR 服务未完成请求（HTTP ${response.status}）。`);
      if(Number(response.headers?.get('content-length'))>4*1024*1024)throw new Error('本地结果超过预算。');
      let raw='';
      if(response.body?.getReader){const reader=response.body.getReader();const chunks=[];let n=0;try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>4*1024*1024)throw new Error('本地结果超过预算。');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}const all=new Uint8Array(n);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}raw=new TextDecoder().decode(all);}
      else {raw=await response.text();if(new TextEncoder().encode(raw).length>4*1024*1024)throw new Error('本地结果超过预算。');}
      signal?.throwIfAborted();return JSON.parse(raw);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function imageRequest(path,{imageBytes,width,height,signal}) {
    if(!(imageBytes instanceof Uint8Array)||!imageBytes.length||imageBytes.length>4*1024*1024)throw new Error('图片字节超过预算。');
    let mime;if(imageBytes[0]===0xff&&imageBytes[1]===0xd8)mime='image/jpeg';else if(imageBytes[0]===137&&imageBytes[1]===80)mime='image/png';else if(imageBytes[0]===66&&imageBytes[1]===77)mime='image/bmp';else mime='image/webp';
    const dims=inspectImage(imageBytes,mime);if(dims.width!==width||dims.height!==height)throw new Error('图片尺寸不匹配。');
    const result=await request(path,{method:'POST',bytes:imageBytes,signal,mime});
    if(result.width!==undefined&&(result.width!==width||result.height!==height))throw new Error('服务返回尺寸不匹配。');
    return result;
  }
  return {
    status:({signal}={})=>request('/status',{signal}),
    download:({signal}={})=>request('/models/download',{method:'POST',signal}),
    cancel:({signal}={})=>request('/models/cancel',{method:'POST',signal}),
    async recognize(input){const value=await imageRequest('/ocr',input);return validateOCRResult({regions:value.regions},input);},
    async detect(input){const value=await imageRequest('/detect',input);return validateDetectionResult({regions:value.regions,detectorRevision:value.detectorRevision,experimental:true},input);},
  };
}
