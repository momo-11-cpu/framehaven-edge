import {expect,it} from 'vitest';
import {fitRect} from '../src/core/geometry';
it('places wide video inside a square without stretching black bars',()=>{
  expect(fitRect({width:400,height:400},{width:1920,height:1080},'contain')).toEqual({left:0,top:87.5,width:400,height:225});
});
it('respects object-position and scale-down',()=>{
  expect(fitRect({width:400,height:400},{width:1920,height:1080},'contain','50% 0%').top).toBe(0);
  expect(fitRect({width:400,height:400},{width:200,height:100},'scale-down').width).toBe(200);
});
it('rejects crop layouts rather than drawing outside the source',()=>{
  expect(()=>fitRect({width:400,height:400},{width:1920,height:1080},'cover')).toThrow();
});
