// SPDX-License-Identifier: GPL-2.0-or-later
// Derived from FFmpeg n7.1 libpostproc/postprocess_template.c dering C fallback.
// Copyright (C) 2001-2002 Michael Niedermayer. WGSL adaptation: Framehaven.
// Immutable input, normalized RGB, fixed block grid and synthetic QP limit.
export const dering=`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var outImage:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> params:vec4<f32>;
var<workgroup> tile:array<vec3<f32>,100>;
var<workgroup> minima:array<vec3<f32>,64>;
var<workgroup> maxima:array<vec3<f32>,64>;
@compute @workgroup_size(8,8) fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>,@builtin(local_invocation_index) index:u32){
 let size=textureDimensions(source);let origin=vec2<i32>(group.xy*8u);
 for(var i=index;i<100u;i+=64u){
   let p=clamp(origin+vec2<i32>(i32(i%10u)-1,i32(i/10u)-1),vec2<i32>(0),vec2<i32>(size)-vec2<i32>(1));
   tile[i]=textureLoad(source,p,0).rgb;
 }
 workgroupBarrier();
 let center=(local.y+1u)*10u+local.x+1u;
 let original=tile[center];minima[index]=original;maxima[index]=original;
 workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){
   if(index<stride){minima[index]=min(minima[index],minima[index+stride]);maxima[index]=max(maxima[index],maxima[index+stride]);}
   workgroupBarrier();
 }
 let avg=(minima[0]+maxima[0])*.5;
 var above=vec3<u32>(1u);var below=vec3<u32>(1u);var filtered=vec3<f32>(0.);
 for(var y=0u;y<3u;y++){
   for(var x=0u;x<3u;x++){
     let value=tile[(local.y+y)*10u+local.x+x];
     above=above&select(vec3<u32>(0u),vec3<u32>(1u),value>avg);below=below&select(vec3<u32>(0u),vec3<u32>(1u),value<=avg);
     let wx=select(1.,2.,x==1u);let wy=select(1.,2.,y==1u);filtered+=value*wx*wy;
   }
 }
 let eligible=select(vec3<u32>(0u),above|below,(maxima[0]-minima[0])>=vec3<f32>(20./255.))!=vec3<u32>(0u);
 let difference=clamp(filtered/16.-original,vec3<f32>(-params.x),vec3<f32>(params.x));
 let result=original+select(vec3<f32>(0.),difference,eligible);
 let p=group.xy*8u+local.xy;
 if(all(p<size)){textureStore(outImage,vec2<i32>(p),vec4<f32>(result,1.));}
}`;
