import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {animeRestore,animeUpscale} from '../src/generated/anime';
describe('Anime4K shader conversion',()=>{
  it('preserves all convolution matrices and biases without rounding coefficients',()=>{
    for(const [filename,passes]of [['anime4k-restore-s.glsl',animeRestore],['anime4k-upscale-s.glsl',animeUpscale]] as const){
      const source=readFileSync(`vendor/${filename}`,'utf8');
      const matrices=[...source.matchAll(/mat4\(([^)]+)\)/g)].map(m=>m[1]);
      const generated=passes.map(p=>p.code).join('\n');
      const converted=[...generated.matchAll(/mat4x4<f32>\(([^)]+)\)/g)].map(m=>m[1]);
      expect(converted).toEqual(matrices);
      expect(matrices.length).toBeGreaterThan(50);
      expect(generated).not.toContain('MAIN_tex(');
      expect(generated).not.toContain('//!BIND');
    }
  });
  it('keeps Restore at source size and places depth-to-space only at upscale output',()=>{
    expect(animeRestore).toHaveLength(4);expect(animeRestore.every(p=>p.scale===1)).toBe(true);
    expect(animeUpscale).toHaveLength(5);expect(animeUpscale.map(p=>p.scale)).toEqual([1,1,1,1,2]);
    expect(animeUpscale.at(-1)!.code).toContain('pos.y%2*2+pos.x%2');
  });
  it('retains original source licenses and recorded SHA-256 hashes',()=>{
    const source=JSON.parse(readFileSync('vendor/sources.json','utf8'));
    expect(source.files.length).toBeGreaterThanOrEqual(5);
    for(const item of source.files)expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync('vendor/anime4k-license.txt','utf8')).toContain('MIT');
  });
});
