import {describe,it,expect} from 'vitest';
import {preset,edit,normalize,capabilities,stages} from '../src/core/config';
import {choose,fresh} from '../src/core/storage';
describe('mode invariants',()=>{
  it('starts in live mode with all seven stages requested',()=>{
    const c=preset();expect(c.mode).toBe('live');expect(stages.every(s=>c.stages[s].enabled)).toBe(true);
  });
  it.each(['interpolation','sharpen','upscale'] as const)('disabling %s enters custom and preserves other settings',stage=>{
    const c=preset('anime');const n=edit(c,stage,{enabled:false});expect(n.mode).toBe('custom');
    for(const other of stages.filter(s=>s!==stage))expect(n.stages[other]).toEqual(c.stages[other]);
    expect(c.stages[stage].enabled).toBe(true);
  });
  it.each(['deblock','dering','denoise','deband'] as const)('optional %s stays in preset',stage=>{
    expect(edit(preset('anime'),stage,{enabled:false}).mode).toBe('anime');
  });
  it('algorithm changes and zero strength cannot bypass the preset identity',()=>{
    expect(edit(preset(), 'sharpen',{algorithm:'restore-anime4k-s'}).mode).toBe('custom');
    expect(edit(preset(), 'sharpen',{strength:0}).mode).toBe('custom');
    const raw=preset();raw.stages.interpolation.enabled=false;expect(normalize(raw).mode).toBe('custom');
  });
  it('off suppresses even corrupted enabled flags',()=>{
    const raw=preset();raw.mode='off';expect(capabilities(normalize(raw))).toEqual({active:[],missing:[],status:'off'});
  });
  it('registers the complete requested pipeline without hiding runtime admission failures',()=>{
    const c=capabilities(preset());expect(c.status).toBe('ready');expect(c.active).toEqual([...stages]);
  });
  it('preserves independent preset snapshots through off',()=>{
    let p=fresh();p.config=edit(p.config,'denoise',{enabled:false});
    p=choose(p,'anime');expect(p.config.stages.denoise.enabled).toBe(true);
    p=choose(p,'off');expect(stages.every(s=>!p.config.stages[s].enabled)).toBe(true);
    p=choose(p,'live');expect(p.config.stages.denoise.enabled).toBe(false);
  });
  it('sanitizes unknown algorithms and non-finite input',()=>{
    const raw=preset('custom');raw.stages.sharpen.algorithm='remote-script';raw.stages.sharpen.strength=NaN;
    const n=normalize(raw);expect(n.stages.sharpen.algorithm).toBe('sharpen-cas');expect(n.stages.sharpen.strength).toBe(0.35);
  });
});
