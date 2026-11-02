import {readdir} from 'node:fs/promises';
const legacySource=/^(src\/(renderer|webnn-lab)\.ts|src\/engine\/(bridge|frame-transport|interpolation|rife[^/]*|runtime-files|tensor-io|webnn[^/]*)\.ts)$/;
const legacyTests=/^tests\/(bridge|frame-transport|runtime-assets|rife-webgpu|tensor-io|webnn-blocks)\.test\.ts$/;
export async function releaseFiles(){
 const files=[];
 async function walk(dir,filter=()=>true){for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())await walk(path,filter);else if(filter(path))files.push(path);}}
 await walk('src',p=>!legacySource.test(p));await walk('tests',p=>!legacyTests.test(p));
 await walk('.github');await walk('LICENSES');await walk('vendor/framegen');await walk('models/export/framegen');
 for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vite.config.ts','popup.html','options.html','demo.html','model-lab.html','.gitignore','LICENSE','THIRD_PARTY_NOTICES.md','README.md','PRIVACY.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','RELEASE_NOTES.md','docs/COMPATIBILITY.md','docs/PERFORMANCE.md','docs/LICENSING.md'])files.push(file);
 for(const file of ['build.mjs','package.mjs','convert-anime.mjs','convert-fsrcnnx.mjs','serve.mjs','release-files.mjs','verify-release.mjs'])files.push('scripts/'+file);
 for(const file of ['anime4k-license.txt','anime4k-restore-s.glsl','anime4k-upscale-s.glsl','cas-license.txt','cas.h','ffmpeg-bilateral.c','ffmpeg-deblock.c','ffmpeg-lgpl.txt','ffmpeg-postprocess.c','fsrcnnx-x2-8.glsl','gpl-3.0.txt','lgpl-3.0.txt','libplacebo-lgpl.txt','libplacebo-sampling.c','sources.json'])files.push('vendor/'+file);
 return files.sort();
}
