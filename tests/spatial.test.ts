import {expect,it} from 'vitest';
import {WgslReflect,WgslParser,WgslExec} from 'wgsl_reflect/wgsl_reflect.module.js';
import {bilateral,bilateralParameters} from '../src/engine/bilateral';
import {dering} from '../src/engine/dering';
it('compute entry points, storage bindings and uniform sizes match their host layouts',()=>{
  const b=new WgslReflect(bilateral),d=new WgslReflect(dering);
  expect(b.entry.compute.map(e=>e.name)).toEqual(['horizontal','vertical']);
  expect(b.storage.filter(x=>x.type.name==='array').map(x=>x.binding)).toEqual([2,3,4,5]);
  expect(b.uniforms.map(x=>[x.binding,x.size])).toEqual([[1,16]]);
  expect(d.entry.compute.map(e=>e.name)).toEqual(['main']);expect(d.uniforms[0].size).toBe(16);
});
it('bilateral parameters stay finite and increase smoothing with strength',()=>{
  const weak=bilateralParameters(0),strong=bilateralParameters(1);
  expect(strong.alpha).toBeGreaterThan(weak.alpha);expect(strong.sigmaR).toBeGreaterThan(weak.sigmaR);
  expect(bilateralParameters(-4)).toEqual(weak);expect(bilateralParameters(4)).toEqual(strong);
});
it('horizontal WGSL recurrence preserves unnormalized forward/backward factors',()=>{
  const colors=[.2,.21,.8],alpha=.5,sigma=.1;
  const expectedColor=Array(3).fill(0),expectedNorm=Array(3).fill(0);
  for(const order of [[0,1,2],[2,1,0]]){
    let color=colors[order[0]],norm=1,previous=color;expectedColor[order[0]]+=color;expectedNorm[order[0]]+=norm;
    for(const i of order.slice(1)){
      const a=alpha*Math.exp(-Math.abs(colors[i]-previous)/sigma);
      color=(1-alpha)*colors[i]+a*color;norm=1-alpha+a*norm;previous=colors[i];expectedColor[i]+=color;expectedNorm[i]+=norm;
    }
  }
  const input=new Float32Array(colors.flatMap(c=>[c,c,c,1]));const buffers=Array.from({length:4},()=>new Float32Array(12));
  const exec=new WgslExec(new WgslParser().parse(bilateral));
  exec.dispatchWorkgroups('horizontal',1,{0:{0:{texture:[input.buffer],descriptor:{size:[3,1,1],format:'rgba32float',dimension:'2d'}},1:{uniform:new Float32Array([3,1,alpha,sigma]).buffer},...Object.fromEntries(buffers.map((b,i)=>[i+2,{uniform:b.buffer}]))}});
  for(let i=0;i<3;i++){
    expect(buffers[0][i*4]).toBeCloseTo(expectedColor[i],6);expect(buffers[1][i*4]).toBeCloseTo(expectedNorm[i],6);
  }
});
