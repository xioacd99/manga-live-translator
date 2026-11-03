import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImage } from '../../extension/image-dimensions.js';
const join=(...arrays)=>Buffer.concat(arrays.map(value=>Buffer.from(value)));
const be32=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value);return b;};
const le32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value>>>0);return b;};
const be16=value=>{const b=Buffer.alloc(2);b.writeUInt16BE(value);return b;};
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function pngChunk(type,data){const body=join(Buffer.from(type),data);return join(be32(data.length),body,be32(crc32(body)));}
function png(width=12,height=34,extras=[]){return join([137,80,78,71,13,10,26,10],pngChunk('IHDR',join(be32(width),be32(height),[8,2,0,0,0])),...extras,pngChunk('IDAT',[0]),pngChunk('IEND',[]));}
function jpeg(width=12,height=34,frame=0xc0,entropy=[0x22,0xff,0,0x11,0xff,0xd0,0x33]){
 const segment=(marker,data)=>join([255,marker],be16(data.length+2),data);
 return join([255,216],segment(frame,join([8],be16(height),be16(width),[1,1,0x11,0])),segment(0xda,[1,1,0,0,63,0]),entropy,[255,217]);
}
function bmp(width=12,height=34,bits=24,dib=40){
 const pixels=Math.ceil(width*bits/32)*4*Math.abs(height),b=Buffer.alloc(14+dib+pixels);b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(14+dib,10);b.writeUInt32LE(dib,14);b.writeInt32LE(width,18);b.writeInt32LE(height,22);b.writeUInt16LE(1,26);b.writeUInt16LE(bits,28);b.writeUInt32LE(pixels,34);return b;
}
function riff(chunks){const body=join(Buffer.from('WEBP'),...chunks);return join(Buffer.from('RIFF'),le32(body.length),body);}
function webpChunk(type,data){return join(Buffer.from(type),le32(data.length),data,data.length%2?[0]:[]);}
function lossy(width=12,height=34){const data=Buffer.from([0x10,0,0,0x9d,1,0x2a,0,0,0,0]);data.writeUInt16LE(width,6);data.writeUInt16LE(height,8);return webpChunk('VP8 ',data);}
function lossless(width=12,height=34){return webpChunk('VP8L',join([0x2f],le32((width-1)|((height-1)<<14))));}
function extended(width=12,height=34,flags=0){const data=Buffer.alloc(10);data[0]=flags;data.writeUIntLE(width-1,4,3);data.writeUIntLE(height-1,7,3);return webpChunk('VP8X',data);}
const fixtures=[['PNG','image/png',png()],['JPEG','image/jpeg',jpeg()],['BMP','image/bmp',bmp()],['WebP VP8','image/webp',riff([lossy()])],['WebP VP8L','image/webp',riff([lossless()])],['WebP VP8X','image/webp',riff([extended(),lossy()])]];
for(const [name,mime,bytes] of fixtures){
 test(`${name} reads original dimensions before decoding`,()=>{assert.deepEqual(inspectImage(bytes,mime),{width:12,height:34});});
 test(`${name} rejects every truncated prefix without accidental reads`,()=>{for(let i=0;i<bytes.length;i++)assert.throws(()=>inspectImage(bytes.subarray(0,i),mime),Error,`prefix ${i}`);});
}
test('accepts typed-array windows and ArrayBuffer without reading surrounding bytes',()=>{
 const data=png(),padded=join([0,0,0],data,[0]);assert.deepEqual(inspectImage(padded.subarray(3,-1),'image/png'),{width:12,height:34});
 assert.deepEqual(inspectImage(Uint8Array.from(data).buffer,'image/png'),{width:12,height:34});
 assert.deepEqual(inspectImage(new DataView(Uint8Array.from(data).buffer),'image/png'),{width:12,height:34});
});
test('rejects unknown formats MIME mismatches zero and oversized byte inputs',()=>{
 for(const [bytes,mime] of [[png(),'image/jpeg'],[jpeg(),'image/png'],[png(),'image/gif'],[new Uint8Array(),'image/png'],[new Uint8Array(4*1024*1024+1),'image/png'],['text','image/png'],[png(),undefined]])assert.throws(()=>inspectImage(bytes,mime));
 assert.deepEqual(inspectImage(png(),'IMAGE/PNG; charset=binary'),{width:12,height:34});
});
test('enforces 16 million pixel bound before compressed payload decode',()=>{
 assert.deepEqual(inspectImage(png(4000,4000),'image/png'),{width:4000,height:4000});
 for(const [bytes,mime] of [[png(4001,4000),'image/png'],[jpeg(4001,4000),'image/jpeg'],[riff([lossless(4001,4000)]),'image/webp'],[png(0,1),'image/png'],[png(0xffffffff,0xffffffff),'image/png']])assert.throws(()=>inspectImage(bytes,mime));
 const b=bmp();b.writeInt32LE(4001,18);b.writeInt32LE(4000,22);assert.throws(()=>inspectImage(b,'image/bmp'));
});
test('PNG rejects animation, repeated IHDR, invalid methods and incomplete container',()=>{
 for(const chunk of ['acTL','fcTL','fdAT'])assert.throws(()=>inspectImage(png(12,34,[pngChunk(chunk,[0])]),'image/png'));
 assert.throws(()=>inspectImage(png(12,34,[pngChunk('IHDR',Buffer.alloc(13))]),'image/png'));
 for(const [offset,value] of [[24,3],[25,1],[26,1],[27,1],[28,2]]){const b=png();b[offset]=value;assert.throws(()=>inspectImage(b,'image/png'));}
 const overflow=png();overflow.writeUInt32BE(0xffffffff,8);assert.throws(()=>inspectImage(overflow,'image/png'));
 assert.throws(()=>inspectImage(join(png(),[0]),'image/png'));
});
test('JPEG supports progressive frame markers but rejects malformed frame and animation-like MPO',()=>{
 assert.deepEqual(inspectImage(jpeg(12,34,0xc2),'image/jpeg'),{width:12,height:34});
 assert.throws(()=>inspectImage(jpeg(12,34,0xc3),'image/jpeg'));
 assert.throws(()=>inspectImage(jpeg(0,34),'image/jpeg'));
 const precision=jpeg();precision[6]=12;assert.throws(()=>inspectImage(precision,'image/jpeg'));
 const overflow=jpeg();overflow[4]=255;overflow[5]=255;assert.throws(()=>inspectImage(overflow,'image/jpeg'));
 const mpo=join([255,216,255,226,0,6],Buffer.from('MPF\0'),jpeg().subarray(2));assert.throws(()=>inspectImage(mpo,'image/jpeg'));
 assert.throws(()=>inspectImage(join(jpeg(),[0]),'image/jpeg'));
 assert.throws(()=>inspectImage(jpeg(12,34,0xc0,[255,216]),'image/jpeg'));
});
test('BMP supports top-down 24/32-bit standard headers, rejects compression and pixel truncation',()=>{
 for(const dib of [40,108,124])for(const bits of [24,32])assert.deepEqual(inspectImage(bmp(12,-34,bits,dib),'image/bmp'),{width:12,height:34});
 for(const [offset,value] of [[14,12],[10,20],[18,0],[22,0],[30,1],[34,1]]){const b=bmp();b.writeUInt32LE(value,offset);assert.throws(()=>inspectImage(b,'image/bmp'));}
 const planes=bmp();planes.writeUInt16LE(2,26);assert.throws(()=>inspectImage(planes,'image/bmp'));
 const indexed=bmp();indexed.writeUInt16LE(8,28);assert.throws(()=>inspectImage(indexed,'image/bmp'));
 const truncated=bmp().subarray(0,-1);truncated.writeUInt32LE(truncated.length,2);assert.throws(()=>inspectImage(truncated,'image/bmp'));
});
test('WebP rejects animation flags/chunks duplicate frames canvas mismatch and malformed headers',()=>{
 for(const bytes of [riff([extended(12,34,2),lossy()]),riff([extended(),webpChunk('ANIM',[]),lossy()]),riff([extended(),webpChunk('ANMF',[]),lossy()]),riff([lossy(),lossless()]),riff([extended(13,34),lossy()]),riff([extended()]),riff([webpChunk('VP8L',[0,0,0,0,0])]),riff([webpChunk('VP8L',[0x2f,0,0,0,0xe0])])])assert.throws(()=>inspectImage(bytes,'image/webp'));
 const length=riff([lossy()]);length.writeUInt32LE(0xffffffff,16);assert.throws(()=>inspectImage(length,'image/webp'));
 const version=riff([extended(),lossy()]);version[20]=0x80;assert.throws(()=>inspectImage(version,'image/webp'));
 const keyframe=riff([lossy()]);keyframe[20]=1;assert.throws(()=>inspectImage(keyframe,'image/webp'));
});

test('PNG rejects corrupted header and data CRCs before decoding',()=>{for(const offset of [29,30,31,32,42]){const bytes=png();bytes[offset]^=1;assert.throws(()=>inspectImage(bytes,'image/png'));}});
