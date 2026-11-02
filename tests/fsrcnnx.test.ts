import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fsrcnnx} from '../src/generated/fsrcnnx';

it('preserves every FSRCNNX convolution matrix, bias and scalar kernel',()=>{
  const source=readFileSync('vendor/fsrcnnx-x2-8.glsl','utf8');
  const bodies=[...source.matchAll(/vec4 hook\(\)\s*\{([\s\S]*?)\n\}/g)].slice(0,-1).map(m=>m[1]);
  expect(bodies).toHaveLength(13);
  // Every original numeric vector/matrix literal must survive in its original order.
  const literals=(s:string)=>[...s.matchAll(/(?:vec4(?:<f32>)?|mat4(?:x4)?(?:<f32>)?)\(([^()]*)\)/g)].map(m=>m[1]).filter(x=>/^[0-9eE.,+\s-]+$/.test(x));
  bodies.forEach((body,i)=>expect(literals(fsrcnnx[i].code)).toEqual(literals(body)));
});
it('preserves named graph dependencies, overwrites and final subpixel order',()=>{
  const available=new Set(['LUMA']);
  expect(fsrcnnx).toHaveLength(14);
  for(const pass of fsrcnnx){
    for(const input of pass.binds)expect(available.has(input),`${pass.name} requires ${input}`).toBe(true);
    available.add(pass.save);
  }
  expect(fsrcnnx.map(p=>p.scale)).toEqual([...Array(13).fill(1),2]);
  expect(fsrcnnx.at(-1)!.code).toContain('(pos.x%2)*2+pos.y%2');
  expect(fsrcnnx.at(-1)!.code).toContain('y-originalY');
});
it('all retained upstream sources match their recorded cryptographic hashes',()=>{
  const manifest=JSON.parse(readFileSync('vendor/sources.json','utf8'));
  for(const file of manifest.files){
    const actual=createHash('sha256').update(readFileSync(`vendor/${file.name}`)).digest('hex');
    expect(actual,file.name).toBe(file.sha256);
  }
});

import {WgslDebug} from 'wgsl_reflect/wgsl_reflect.module.js';
it('CPU interpreter matches the original feature kernel on a constant colored input',()=>{
  const rgb=[.2,.4,.7],luma=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  const source=readFileSync('vendor/fsrcnnx-x2-8.glsl','utf8');
  const body=[...source.matchAll(/vec4 hook\(\)\s*\{([\s\S]*?)\n\}/g)][0][1];
  const vectors=[...body.matchAll(/vec4\(([-\d.,]+)\)/g)].map(m=>m[1].split(',').map(Number));
  const expected=vectors[0].map((bias,c)=>bias+vectors.slice(1).reduce((sum,v)=>sum+v[c]*luma,0));
  expect(vectors).toHaveLength(26);
  const values=new Float32Array(4*4*4);
  for(let i=0;i<16;i++)values.set([...rgb,1],i*4);
  const texture={texture:[values.buffer],descriptor:{size:[4,4,1],format:'rgba32float',dimension:'2d'}};
  const debug=new WgslDebug(fsrcnnx[0].code);
  // Integer coordinates avoid the documented CPU interpreter float->int discrepancy.
  expect(debug.debugFragment('fs',{position:[0,0,0,1],0:[.125,.125]},{0:{0:texture,1:texture,2:texture,3:texture,4:{sampler:{minFilter:'linear',magFilter:'linear'}}}})).toBe(true);
  let steps=0;while(debug.stepNext())if(++steps>20000)throw Error('Interpreter exceeded budget');
  const result=debug.getReturnValue() as number[];
  expected.forEach((value,c)=>expect(result[c]).toBeCloseTo(value,5));
});
