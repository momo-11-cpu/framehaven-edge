import {describe,it,expect} from 'vitest';
import {WgslReflect} from 'wgsl_reflect/wgsl_reflect.module.js';
import {animeRestore,animeUpscale} from '../src/generated/anime';
import {ingest,cas,present} from '../src/engine/shaders';
import {deblock,deband} from '../src/engine/filters';
import {fsrcnnx} from '../src/generated/fsrcnnx';
const shaders=[['ingest',ingest],['CAS',cas],['present',present],['deblock',deblock],['deband',deband],
  ...fsrcnnx.map((p,i)=>[`fsrcnnx-${i}`,p.code]),...animeRestore.map((p,i)=>[`restore-${i}`,p.code]),...animeUpscale.map((p,i)=>[`upscale-${i}`,p.code])];
describe('WGSL offline parser and resource contracts (not GPU compilation)',()=>{
  it.each(shaders)('parses %s with complete shader entry points',(_name,code)=>{
    const reflection=new WgslReflect(code);
    expect(reflection.entry.vertex.map(x=>x.name)).toEqual(['vs']);
    expect(reflection.entry.fragment.map(x=>x.name)).toEqual(['fs']);
    for(const uniform of reflection.uniforms)expect(uniform.size).toBe(16);
  });
  it('model layouts match the renderer explicit binding slots',()=>{
    for(const p of fsrcnnx){
      const r=new WgslReflect(p.code);
      expect(r.textures.map(v=>v.binding).sort()).toEqual([0,1,2,3]);
      expect(r.samplers.map(v=>v.binding)).toEqual([4]);
      expect(r.uniforms).toHaveLength(0);
    }
    for(const p of [...animeRestore,...animeUpscale]){
      const r=new WgslReflect(p.code);
      expect(r.textures.map(v=>v.binding).sort()).toEqual([0,1]);
      expect(r.samplers.map(v=>v.binding)).toEqual([2]);
      expect(r.uniforms.map(v=>v.binding)).toEqual([3]);
    }
  });
});
