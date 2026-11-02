import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
import {mkdir,writeFile,copyFile,cp,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {generate} from './convert-anime.mjs';
import {generateFsrcnnx} from './convert-fsrcnnx.mjs';
import {releaseFiles} from './release-files.mjs';
// Pin both code and weights before touching dist.
const fgRecord=JSON.parse(await readFile('models/export/framegen/manifest.json','utf8'));
const fgSource=JSON.parse(await readFile('vendor/framegen/provenance.json','utf8'));
if(createHash('sha256').update(await readFile('vendor/framegen/rt.js')).digest('hex')!==fgSource.runtimeSha256)throw Error('Framegen runtime hash mismatch');
for(const [name,hash] of Object.entries(fgRecord.files))if(createHash('sha256').update(await readFile('models/export/framegen/'+name)).digest('hex')!==hash)throw Error('Framegen weight hash mismatch: '+name);
await generate();
await generateFsrcnnx();
await viteBuild();
for(const name of ['background','content'])await build({entryPoints:[`src/${name}.ts`],outfile:`dist/${name}.js`,bundle:true,format:name==='background'?'esm':'iife',target:'chrome120',minify:true,legalComments:'eof'});
await mkdir('dist/icons',{recursive:true});
// Build a small raster icon without native dependencies.
const {zlibSync}=await import('fflate');
function crc(bytes){let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const typeBytes=Buffer.from(type);const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const check=Buffer.alloc(4);check.writeUInt32BE(crc(Buffer.concat([typeBytes,data])));return Buffer.concat([length,typeBytes,data,check]);}
for(const size of [16,32,48,128]){
  const pixels=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const offset=y*(size*4+1)+1+x*4;
    const border=(x>size*.19&&x<size*.8&&y>size*.22&&y<size*.77)&&(x<size*.26||x>size*.73||y<size*.29||y>size*.7);
    const beam=Math.abs(x-y)<size*.05&&x>size*.36&&x<size*.65;
    const color=border||beam?[134,213,233]:[20,36,58];pixels.set([...color,255],offset);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  await writeFile(`dist/icons/${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',Buffer.from(zlibSync(pixels))),chunk('IEND',Buffer.alloc(0))]));
}
const pkg=JSON.parse(await readFile('package.json','utf8'));
const manifest={manifest_version:3,name:'帧境 · SDR 视频增强',version:pkg.version,description:'本地 SDR 视频增强：Framegen 2×/4× 补帧、压缩修复、降噪、去色带、锐化及 AI 放大。',minimum_chrome_version:'121',permissions:['storage','scripting','activeTab'],optional_host_permissions:['http://*/*','https://*/*'],action:{default_popup:'popup.html',default_title:'帧境',default_icon:{16:'icons/16.png',32:'icons/32.png'}},icons:{16:'icons/16.png',48:'icons/48.png',128:'icons/128.png'},background:{service_worker:'background.js',type:'module'},options_ui:{page:'options.html',open_in_tab:true},web_accessible_resources:[{resources:['models/framegen/*'],matches:['http://*/*','https://*/*']}],content_security_policy:{extension_pages:"script-src 'self'; object-src 'self'"}};
await writeFile('dist/manifest.json',JSON.stringify(manifest,null,2)+'\n');
await copyFile('THIRD_PARTY_NOTICES.md','dist/THIRD_PARTY_NOTICES.md');
await mkdir('dist/licenses',{recursive:true});
await copyFile('vendor/anime4k-license.txt','dist/licenses/Anime4K.txt');
await copyFile('vendor/cas-license.txt','dist/licenses/AMD-CAS.txt');
await copyFile('vendor/sources.json','dist/licenses/sources.json');
await copyFile('vendor/ffmpeg-lgpl.txt','dist/licenses/FFmpeg-LGPL-2.1.txt');
await copyFile('vendor/libplacebo-lgpl.txt','dist/licenses/libplacebo-LGPL-2.1.txt');
await copyFile('vendor/lgpl-3.0.txt','dist/licenses/FSRCNNX-LGPL-3.0.txt');
await copyFile('vendor/gpl-3.0.txt','dist/licenses/GPL-3.0.txt');
await copyFile('LICENSE','dist/LICENSE');
await mkdir('dist/models/framegen',{recursive:true});
await cp('models/export/framegen','dist/models/framegen',{recursive:true});
await cp('vendor/framegen','dist/licenses/framegen',{recursive:true});
// Include only the current, reproducible public source (no local research or captures).
for(const file of await releaseFiles()){
 const target='dist/source/'+file;await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});await copyFile(file,target);
}
for(const file of ['README.md','PRIVACY.md','CHANGELOG.md','RELEASE_NOTES.md'])await copyFile(file,'dist/'+file);
await cp('LICENSES','dist/LICENSES',{recursive:true});
console.log('Edge extension ready: dist/');
