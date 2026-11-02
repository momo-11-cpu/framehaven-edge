import {expect,it} from 'vitest';
import {WgslDebug} from 'wgsl_reflect/wgsl_reflect.module.js';
import {deblock,deband} from '../src/engine/filters';
import {cas} from '../src/engine/shaders';
function pixels(width:number,height:number,value:(x:number,y:number)=>number){
  const image=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)image.set([value(x,y),value(x,y),value(x,y),1],(y*width+x)*4);
  return image;
}
function fragment(code:string,width:number,height:number,image:Float32Array,x:number,y:number,params:number[],casLayout=false){
  const debug=new WgslDebug(code);
  const texture={texture:[image.buffer],descriptor:{size:[width,height,1],format:'rgba32float',dimension:'2d'}};
  const uniform={uniform:new Float32Array(params).buffer};
  const bindings:Parameters<WgslDebug['debugFragment']>[2][string]=casLayout?{0:texture,1:{sampler:{magFilter:'linear',minFilter:'linear'}},2:uniform}:{0:texture,1:uniform};
  // v1.6 interpreter retains fractional values in vector float-to-int construction.
  // Supply integer pixel coordinates here; actual pixel-center conversion is a GPU test.
  expect(debug.debugFragment('fs',{position:[x,y,0,1],0:[(x+.5)/width,(y+.5)/height]},{0:bindings})).toBe(true);
  let steps=0;while(debug.stepNext()){if(++steps>10000)throw Error('Shader interpreter exceeded test budget');}
  const result=debug.getReturnValue();expect(Array.isArray(result)).toBe(true);return result as number[];
}
it('CPU-interpreted deblock smooths the four boundary samples using upstream weak equations',()=>{
  const image=pixels(16,4,x=>x<8?.4:.42);
  const actual=[6,7,8,9].map(x=>fragment(deblock,16,4,image,x,2,[1,1,0,0])[0]);
  const expected=[.4025,.41,.41,.4175];
  actual.forEach((value,i)=>expect(value).toBeCloseTo(expected[i],5));
});
it('deblock preserves a strong real edge and out-of-block pixels',()=>{
  const image=pixels(16,4,x=>x<8?.1:.9);
  expect(fragment(deblock,16,4,image,7,2,[1,1,0,0])[0]).toBeCloseTo(.1,6);
  expect(fragment(deblock,16,4,image,8,2,[1,1,0,0])[0]).toBeCloseTo(.9,6);
  expect(fragment(deblock,16,4,image,4,2,[1,1,0,0])[0]).toBeCloseTo(.1,6);
});
it('deblock applies the same boundary correction vertically',()=>{
  const image=pixels(4,16,(_x,y)=>y<8?.4:.42);
  expect(fragment(deblock,4,16,image,2,7,[1,0,0,0])[0]).toBeCloseTo(.41,5);
});
it('deband preserves flat regions and keeps alpha opaque',()=>{
  const image=pixels(16,16,()=>.4);
  const result=fragment(deband,16,16,image,8,8,[1,0,0,0]);
  result.slice(0,3).forEach(x=>expect(x).toBeCloseTo(.4,5));expect(result[3]).toBe(1);
});
it('deband preserves a high-contrast edge instead of averaging across it',()=>{
  const image=pixels(16,16,x=>x<8?.1:.9);
  expect(fragment(deband,16,16,image,7,8,[1,0,0,0])[0]).toBeCloseTo(.1,5);
});
it('CAS preserves a constant neutral patch in the CPU interpreter',()=>{
  const image=pixels(8,8,()=>.4);
  const result=fragment(cas,8,8,image,4,4,[.5,0,0,0],true);
  result.slice(0,3).forEach(x=>expect(x).toBeCloseTo(.4,5));expect(result[3]).toBe(1);
});
