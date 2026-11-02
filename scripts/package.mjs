import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
const files={};
async function walk(dir,prefix=''){for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name),name=prefix+entry.name;
  if(entry.isDirectory())await walk(path,name+'/');else files[name]=new Uint8Array(await readFile(path));
}}
await walk('dist');
const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
if(manifest.manifest_version!==3)throw Error('Invalid manifest');
for(const file of ['background.js','content.js','popup.html','options.html'])if(!files[file])throw Error(`Missing ${file}`);
files['安装说明.txt']=strToU8(`帧境 ${manifest.version} 正式版\n解压到新的固定目录。在 Edge 的扩展管理页停用旧版，再加载包含 manifest.json 的新目录；刷新视频网页。也可替换原目录后重新加载扩展并刷新网页。\n真人和动画均使用 Framegen v7s，可选 2× / 4×；动画额外识别重复画面。每项显示 GPU 完成状态与累计帧次。其他增强算法保持原设置。旧配置自动迁移。\n补帧、空间增强与输出共用页面内 GPU，不再向扩展内嵌页面搬运全帧像素。需要 WebGPU shader-f16；无需 WebNN 或本机辅助程序。\n初次初始化会测量 GPU 内核配置，准备完成前保持原生播放。\n更多设置 → 1080p 加速测试可运行本机测试并下载报告。模型测试不等于真实视频、长期性能或音画同步验收。\n权重仅限个人及非商业研究使用，详见 licenses/framegen/WEIGHTS_LICENSE.md。\nZIP 为解压加载包，不是自动安装 CRX。\n`);
await mkdir('artifacts',{recursive:true});
const name=`framehaven-edge-${manifest.version}.zip`;const bytes=zipSync(files,{level:9});
await writeFile(`artifacts/${name}`,bytes);
await writeFile(`artifacts/${name}.sha256`,createHash('sha256').update(bytes).digest('hex')+`  ${name}\n`);
console.log(`Packaged artifacts/${name} (${bytes.length} bytes)`);
