import {cp, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixtureImage} from './mock-local-service.mjs';

// 只修改临时测试副本。环回 HTTP 保持真实传输；图片获取与付费模型边界明确模拟。
export async function instrumentExtension(directory, endpoint) {
  const extension = join(directory, 'extension'), probe = join(directory, 'permission-probe');
  await cp('dist', extension, {recursive: true});
  await cp('dist', probe, {recursive: true});
  const productionManifest = await readFile('dist/manifest.json', 'utf8');
  const mainManifest = JSON.parse(productionManifest), probeManifest = JSON.parse(productionManifest);
  mainManifest.name += ' Synthetic HTTP integration';
  probeManifest.name += ' Missing loopback permission probe';
  // 静态测试授权不验证 Chrome 的权限弹窗交互，另一个扩展副本验证缺权时后台拒绝。
  mainManifest.host_permissions = ['https://reader.example.com/*', 'https://api.deepseek.com/*', 'http://127.0.0.1/*'];
  probeManifest.host_permissions = ['https://reader.example.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(mainManifest));
  await writeFile(join(probe, 'manifest.json'), JSON.stringify(probeManifest));
  const common = `
    const __fixtureNativeFetch = globalThis.fetch.bind(globalThis);
    const __fixtureEndpoint = ${JSON.stringify(endpoint)};
    const __fixtureBytes = ${JSON.stringify(Array.from(fixtureImage.imageBytes))};
    const __fixtureRecord = detail => {
      if (globalThis.__fixtureDiagnostics) { if(globalThis.__fixtureDiagnostics.length < 300) globalThis.__fixtureDiagnostics.push(detail); return Promise.resolve(); }
      return chrome.runtime.sendMessage({target:'synthetic-test', type:'DIAGNOSTIC', detail});
    };
    globalThis.fetch = async (input, options = {}) => {
      const url = typeof input === 'string' ? input : input.url || String(input);
      options.signal?.throwIfAborted();
      if(url.startsWith(__fixtureEndpoint + '/')) {
        if (!['/status','/models/download','/models/cancel','/ocr','/detect'].includes(new URL(url).pathname)) throw new Error('Unexpected loopback path');
        if(options.credentials !== 'omit' || options.redirect !== 'error' || options.cache !== 'no-store' || options.referrerPolicy !== 'no-referrer') throw new Error('Loopback privacy contract changed');
        try { return await __fixtureNativeFetch(input, options); }
        catch(error) { await __fixtureRecord({kind:'loopback-error',message:String(error.message)}); throw error; }
      }
      if(new URL(url,location.href).origin === 'https://reader.example.com' && ['/page.bmp','/near.bmp','/rest.bmp','/lazy.bmp'].includes(new URL(url).pathname)) {
        if(options.credentials !== 'omit' || options.redirect !== 'error') throw new Error('Image acquisition privacy contract changed');
        await __fixtureRecord({kind:'image',path:new URL(url).pathname});
        return new Response(new Uint8Array(__fixtureBytes),{headers:{'content-type':'image/bmp'}});
      }
      if(url === 'https://api.deepseek.com/chat/completions') {
        if(options.method !== 'POST' || options.credentials !== 'omit' || options.redirect !== 'error' || options.cache !== 'no-store' || options.referrerPolicy !== 'no-referrer') throw new Error('Provider privacy contract changed');
        const body = JSON.parse(options.body);
        if(body.response_format?.type !== 'json_object' || body.messages?.[1]?.role !== 'user') throw new Error('DeepSeek JSON object contract missing');
        const data = JSON.parse(body.messages[1].content);
        if(!Array.isArray(data.regions) || !data.regions.length || data.regions.some(region=>Object.keys(region).sort().join(',') !== 'regionId,sourceText' || typeof region.regionId !== 'string' || typeof region.sourceText !== 'string')) throw new Error('Provider must receive structured text only');
        if(/data:image|image_url|imageBase64/.test(options.body)) throw new Error('Image content reached provider');
        await __fixtureRecord({kind:'provider',input:data,responseFormat:body.response_format});
        return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translations:data.regions.map((region,index)=>({regionId:region.regionId,text:data.context==='overflow-fixture'?'很长的译文'.repeat(100):index===0?'你好，世界。':'字幕译文。'}))})}}]}),{headers:{'content-type':'application/json'}});
      }
      if(url.startsWith(chrome.runtime.getURL('')) || url.startsWith('blob:')) return __fixtureNativeFetch(input, options);
      await __fixtureRecord({kind:'unexpected-fetch',origin:new URL(url,location.href).origin});
      throw new Error('Unexpected external fetch blocked by synthetic test');
    };
  `;
  const background = `
    globalThis.__fixtureDiagnostics = [];
    chrome.runtime.onMessage.addListener((message,sender,reply)=>{
      if(message?.target !== 'synthetic-test' || message.type !== 'DIAGNOSTIC')return;
      if(sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('offscreen.html'))return;
      if(globalThis.__fixtureDiagnostics.length < 300)globalThis.__fixtureDiagnostics.push(message.detail);
      reply({ok:true});
    });
    const __fixtureNativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args)=>{
      const result = await __fixtureNativeSend(...args);
      if(args[0]?.target === 'executor' && ['RUN','PREPARE'].includes(args[0].type)) {
        globalThis.__fixtureDiagnostics.push({kind:args[0].type==='PREPARE'?'preparation-result':'translation-result',response:result});
      }
      return result;
    };
  `;
  for (const file of ['background.js', 'offscreen.js']) {
    const path = join(extension, file), original = await readFile(path, 'utf8');
    await writeFile(path, (file === 'background.js' ? background : '') + common + '\n' + original);
  }
  return {extension, probe, productionManifest};
}
