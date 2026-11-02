import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {vertex} from './convert-anime.mjs';
export function convertFsrcnnx(source){
  return source.split('//!HOOK LUMA').slice(1).map((part,index)=>{
    const name=part.match(/\/\/!DESC (.+)/)?.[1]?.trim();
    const binds=[...part.matchAll(/\/\/!BIND (\w+)/g)].map(m=>m[1]);
    const save=part.match(/\/\/!SAVE (\w+)/)?.[1]??'LUMA';
    if(!name||!binds.length||binds.length>3)throw Error(`Unsupported FSRCNNX pass ${index}`);
    const declarations=Array.from({length:4},(_,i)=>`@group(0) @binding(${i}) var tex${i}:texture_2d<f32>;`).join('\n');
    const shared=`${vertex}\n${declarations}
@group(0) @binding(4) var smp:sampler;
var<private> pixel:vec2<i32>;
fn clampPixel(p:vec2<i32>,size:vec2<u32>)->vec2<i32>{return clamp(p,vec2<i32>(0),vec2<i32>(size)-vec2<i32>(1));}
`;
    if(name==='aggregation')return {name,binds,save,scale:2,code:shared+`
@fragment fn fs(@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>)->@location(0) vec4<f32>{
 let pos=vec2<i32>(p.xy);let channel=u32((pos.x%2)*2+pos.y%2);
 let y=textureLoad(tex0,pos/2,0)[channel];
 let rgb=textureSampleLevel(tex3,smp,uv,0.).rgb;
 let originalY=dot(rgb,vec3<f32>(.2126,.7152,.0722));
 return vec4<f32>(rgb+vec3<f32>(y-originalY),1.);
}`};
    let body=part.match(/vec4 hook\(\)\s*\{([\s\S]*)\}/)?.[1];
    if(!body)throw Error(`Missing hook ${name}`);
    body=body.replace(/mat4(?:x4)?\(/g,'mat4x4<f32>(').replace(/vec4\(/g,'vec4<f32>(')
      .replace(/vec4 res\s*=/,'var res:vec4<f32> =').replace(/float\(/g,'f32(');
    let functions='';
    binds.forEach((bind,binding)=>{
      const sample=`textureLoad(tex${binding},clampPixel(pixel+offset,textureDimensions(tex${binding})),0)`;
      const value=bind==='LUMA'?`dot(${sample}.rgb,vec3<f32>(.2126,.7152,.0722))`:sample;
      functions+=`fn sample${binding}(offset:vec2<i32>)->${bind==='LUMA'?'f32':'vec4<f32>'}{return ${value};}\n`;
      body=body.replace(new RegExp(`${bind}_texOff\\(vec2\\(([^)]+)\\)\\)`,'g'),`sample${binding}(vec2<i32>($1))`)
        .replace(new RegExp(`${bind}_texOff\\(0\\)`,'g'),`sample${binding}(vec2<i32>(0))`);
    });
    if(/_texOff|\bvec[234]\(|\bmat4\(/.test(body))throw Error(`Unconverted syntax in ${name}`);
    return {name,binds,save,scale:1,code:shared+functions+`
@fragment fn fs(@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>)->@location(0) vec4<f32>{
 pixel=vec2<i32>(p.xy);${body}
}`};
  });
}
export async function generateFsrcnnx(){
  const passes=convertFsrcnnx(await readFile('vendor/fsrcnnx-x2-8.glsl','utf8'));
  await mkdir('src/generated',{recursive:true});
  await writeFile('src/generated/fsrcnnx.ts',`// SPDX-License-Identifier: LGPL-3.0-or-later\n// Copyright (C) 2017-2021 igv. WGSL adaptation for Framehaven.\n// Generated from original FSRCNNX 1.1 small model; see THIRD_PARTY_NOTICES.md.\nexport const fsrcnnx = ${JSON.stringify(passes)};\n`);
  console.log(`FSRCNNX: ${passes.length} passes, original CNN coefficients`);
}
