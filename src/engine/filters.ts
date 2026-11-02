// SPDX-License-Identifier: LGPL-2.1-or-later
// Portions copyright (c) 2018 Paul B Mahol and libplacebo contributors.
// Modified for Framehaven: normalized RGB GPU passes, pixel-seeded PRNG,
// bounded iteration count and explicit uniform configuration.
import {vertex} from './shaders';
// FFmpeg n7.1 vf_deblock.c weak H/V equations, LGPL-2.1-or-later.
// RGB float adaptation: normalized thresholds, no codec block metadata.
export const deblock=vertex+`
@group(0) @binding(0) var source:texture_2d<f32>;
struct Params { strength:f32, axis:f32, unused0:f32, unused1:f32 }
@group(0) @binding(1) var<uniform> params:Params;
fn load(p:vec2<i32>)->vec3<f32>{return textureLoad(source,clamp(p,vec2<i32>(0),vec2<i32>(textureDimensions(source))-vec2<i32>(1)),0).rgb;}
@fragment fn fs(@builtin(position) pos:vec4<f32>)->@location(0) vec4<f32>{
 let p=vec2<i32>(pos.xy);let axis=select(vec2<i32>(0,1),vec2<i32>(1,0),params.axis>0.5);
 let coord=select(p.y,p.x,params.axis>0.5);let bound=((coord+2)/8)*8;let relative=coord-bound;
 let limit=select(i32(textureDimensions(source).y),i32(textureDimensions(source).x),params.axis>0.5);
 let original=load(p);
 if(bound<2||bound+1>=limit||relative < -2||relative > 1){return vec4<f32>(original,1.);}
 let center=p+axis*(bound-coord);
 let a=load(center-axis*2);let b=load(center-axis);let c=load(center);let d=load(center+axis);
 let delta=c-b;
 var candidate=original;
 if(relative == -2){candidate=a+delta*.125;}
 if(relative == -1){candidate=b+delta*.5;}
 if(relative == 0){candidate=c-delta*.5;}
 if(relative == 1){candidate=d-delta*.125;}
 candidate=select(original,candidate,abs(delta)<vec3<f32>(0.098*params.strength));
 candidate=select(original,candidate,abs(b-a)<vec3<f32>(0.05*params.strength));
 candidate=select(original,candidate,abs(c-d)<vec3<f32>(0.05*params.strength));
 return vec4<f32>(clamp(candidate,vec3<f32>(0.),vec3<f32>(1.)),1.);
}`;
// Adapted from libplacebo pl_shader_deband, LGPL-2.1-or-later.
// Two iterations, nearest samples, stable pixel-seeded PRNG, no grain.
export const deband=vertex+`
@group(0) @binding(0) var source:texture_2d<f32>;
struct Params { strength:f32, unused0:f32, unused1:f32, unused2:f32 }
@group(0) @binding(1) var<uniform> params:Params;
fn load(p:vec2<i32>)->vec3<f32>{return textureLoad(source,clamp(p,vec2<i32>(0),vec2<i32>(textureDimensions(source))-vec2<i32>(1)),0).rgb;}
fn hash(p:vec2<u32>)->f32{
 var h=p.x*1664525u+p.y*1013904223u+374761393u;h=(h^(h>>13u))*1274126177u;h=h^(h>>16u);
 return f32(h&16777215u)/16777216.;
}
@fragment fn fs(@builtin(position) pos:vec4<f32>)->@location(0) vec4<f32>{
 let p=vec2<i32>(pos.xy);var result=load(p);let seed=vec2<u32>(p);
 let angle=hash(seed+vec2<u32>(113u,79u))*6.28318530718;
 let distance=hash(seed)*16.;
 for(var i=1;i<=2;i=i+1){
  let d=vec2<f32>(cos(angle),sin(angle))*distance*f32(i);
  // Offset a pixel-center coordinate before nearest sampling, matching the source sampler.
  let d1=vec2<i32>(floor(vec2<f32>(p)+vec2<f32>(.5)+d));
  let d2=vec2<i32>(floor(vec2<f32>(p)+vec2<f32>(.5)+vec2<f32>(-d.x,d.y)));
  let d3=vec2<i32>(floor(vec2<f32>(p)+vec2<f32>(.5)-d));
  let d4=vec2<i32>(floor(vec2<f32>(p)+vec2<f32>(.5)+vec2<f32>(d.x,-d.y)));
  let avg=(load(d1)+load(d2)+load(d3)+load(d4))*.25;
  result=select(avg,result,abs(result-avg)>vec3<f32>(params.strength*.02/f32(i)));
 }
 return vec4<f32>(result,1.);
}`;
