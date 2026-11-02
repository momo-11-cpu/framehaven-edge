// SPDX-License-Identifier: MIT
// Adapted from FFmpeg n7.1 vf_bilateral.c (MIT).
// Copyright (c) 2017 Ming Yang; (c) 2019 Paul B Mahol.
// Normalized independent RGB planes, continuous range weights, FP32 recurrence.
export function bilateralParameters(strength:number){
  const amount=Math.max(0,Math.min(1,strength));
  return {alpha:Math.exp(-Math.SQRT2/(.5+2.5*amount)),sigmaR:.01+.09*amount};
}
export const bilateral=`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:vec4<f32>;
@group(0) @binding(2) var<storage,read_write> horizontalColor:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> horizontalNorm:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> verticalColor:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> verticalNorm:array<vec4<f32>>;
@group(0) @binding(6) var outImage:texture_storage_2d<rgba16float,write>;
fn sampleAt(x:u32,y:u32)->vec3<f32>{return textureLoad(source,vec2<i32>(i32(x),i32(y)),0).rgb;}
fn weight(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{return params.z*exp(-abs(a-b)/params.w);}
@compute @workgroup_size(64) fn horizontal(@builtin(global_invocation_id) id:vec3<u32>){
 let width=u32(params.x);let height=u32(params.y);let y=id.x;
 if(y>=height){return;}
 let inverse=1.-params.z;let base=y*width;
 var color=sampleAt(0u,y);var norm=vec3<f32>(1.);var guide=color;
 horizontalColor[base]=vec4<f32>(color,0.);horizontalNorm[base]=vec4<f32>(norm,0.);
 for(var x=1u;x<width;x++){
   let input=sampleAt(x,y);let a=weight(input,guide);
   color=inverse*input+a*color;norm=vec3<f32>(inverse)+a*norm;guide=input;
   horizontalColor[base+x]=vec4<f32>(color,0.);horizontalNorm[base+x]=vec4<f32>(norm,0.);
 }
 color=sampleAt(width-1u,y);guide=color;norm=vec3<f32>(1.);
 horizontalColor[base+width-1u]+=vec4<f32>(color,0.);horizontalNorm[base+width-1u]+=vec4<f32>(norm,0.);
 for(var x=i32(width)-2;x>=0;x--){
   let input=sampleAt(u32(x),y);let a=weight(input,guide);
   color=inverse*input+a*color;norm=vec3<f32>(inverse)+a*norm;guide=input;
   horizontalColor[base+u32(x)]+=vec4<f32>(color,0.);horizontalNorm[base+u32(x)]+=vec4<f32>(norm,0.);
 }
}
@compute @workgroup_size(64) fn vertical(@builtin(global_invocation_id) id:vec3<u32>){
 let width=u32(params.x);let height=u32(params.y);let x=id.x;
 if(x>=width){return;}
 let inverse=1.-params.z;
 var color=horizontalColor[x].rgb;var norm=horizontalNorm[x].rgb;var guide=sampleAt(x,0u);
 verticalColor[x]=vec4<f32>(color,0.);verticalNorm[x]=vec4<f32>(norm,0.);
 for(var y=1u;y<height;y++){
   let index=y*width+x;let input=sampleAt(x,y);let a=weight(input,guide);
   color=inverse*horizontalColor[index].rgb+a*color;
   norm=inverse*horizontalNorm[index].rgb+a*norm;guide=input;
   verticalColor[index]=vec4<f32>(color,0.);verticalNorm[index]=vec4<f32>(norm,0.);
 }
 let last=(height-1u)*width+x;color=horizontalColor[last].rgb;norm=horizontalNorm[last].rgb;guide=sampleAt(x,height-1u);
 textureStore(outImage,vec2<i32>(i32(x),i32(height)-1),vec4<f32>((verticalColor[last].rgb+color)/(verticalNorm[last].rgb+norm),1.));
 for(var y=i32(height)-2;y>=0;y--){
   let index=u32(y)*width+x;let input=sampleAt(x,u32(y));let a=weight(input,guide);
   color=inverse*horizontalColor[index].rgb+a*color;
   norm=inverse*horizontalNorm[index].rgb+a*norm;guide=input;
   textureStore(outImage,vec2<i32>(i32(x),y),vec4<f32>((verticalColor[index].rgb+color)/(verticalNorm[index].rgb+norm),1.));
 }
}`;
