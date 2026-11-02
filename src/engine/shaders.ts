export const vertex=`
struct Vertex { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let p=array<vec2<f32>,3>(vec2<f32>(-1.,-1.),vec2<f32>(3.,-1.),vec2<f32>(-1.,3.));
 var o:Vertex;o.position=vec4<f32>(p[i],0.,1.);o.uv=vec2<f32>((p[i].x+1.)*.5,(1.-p[i].y)*.5);return o;
}`;
export const ingest=vertex+`
@group(0) @binding(0) var source:texture_external;
@group(0) @binding(1) var smp:sampler;
@fragment fn fs(@location(0) uv:vec2<f32>)->@location(0) vec4<f32>{
 return vec4<f32>(textureSampleBaseClampToEdge(source,smp,uv).rgb,1.);
}`;
// CAS sharpen-only, green-channel weight, no diagonal enhancement.
// Derived from AMD FidelityFX CAS (MIT), full-precision arithmetic.
export const cas=vertex+`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var smp:sampler;
struct Params { strength:f32,compare:f32,unused0:f32,unused1:f32 }
@group(0) @binding(2) var<uniform> params:Params;
fn load(p:vec2<i32>)->vec3<f32>{return textureLoad(source,clamp(p,vec2<i32>(0),vec2<i32>(textureDimensions(source))-vec2<i32>(1)),0).rgb;}
@fragment fn fs(@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>)->@location(0) vec4<f32>{
 let p=vec2<i32>(pos.xy);let b=load(p+vec2<i32>(0,-1));let d=load(p+vec2<i32>(-1,0));
 let e=load(p);let f=load(p+vec2<i32>(1,0));let h=load(p+vec2<i32>(0,1));
 let mn=min(min(min(b.g,d.g),min(f.g,h.g)),e.g);
 let mx=max(max(max(b.g,d.g),max(f.g,h.g)),e.g);
 let amp=sqrt(clamp(min(mn,1.-mx)/max(mx,0.00001),0.,1.));
 let w=amp*(-1./mix(8.,5.,params.strength));
 return vec4<f32>(clamp(((b+d+f+h)*w+e)/(1.+4.*w),vec3<f32>(0.),vec3<f32>(1.)),1.);
}`;
export const present=vertex+`
@group(0) @binding(0) var enhanced:texture_2d<f32>;
@group(0) @binding(1) var original:texture_2d<f32>;
@group(0) @binding(2) var smp:sampler;
struct Params { strength:f32,compare:f32,unused0:f32,unused1:f32 }
@group(0) @binding(3) var<uniform> params:Params;
@fragment fn fs(@location(0) uv:vec2<f32>)->@location(0) vec4<f32>{
 if(params.compare>0.5&&uv.x<0.5){return vec4<f32>(textureSampleLevel(original,smp,uv,0.).rgb,1.);}
 if(params.compare>0.5&&abs(uv.x-0.5)<0.001){return vec4<f32>(0.4,0.8,0.95,1.);}
 return vec4<f32>(clamp(textureSampleLevel(enhanced,smp,uv,0.).rgb,vec3<f32>(0.),vec3<f32>(1.)),1.);
}`;
