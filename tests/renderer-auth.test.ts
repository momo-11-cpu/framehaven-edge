import {expect,it} from 'vitest';
import {canIssueRenderer,canUseRenderer} from '../src/core/renderer-auth';
it('only the live lease owner may issue a renderer capability',()=>{
 const lease={tab:1,frame:3,expires:5000};expect(canIssueRenderer(lease,1,3,100)).toBe(true);
 expect(canIssueRenderer(lease,1,0,100)).toBe(false);expect(canIssueRenderer(lease,2,3,100)).toBe(false);
 expect(canIssueRenderer(lease,1,3,5000)).toBe(false);
});
it('renderer grants cannot cross tabs, outlive a lease, or follow a replaced owner',()=>{
 const grant={tab:1,frame:3,expires:10000},lease={tab:1,frame:3,expires:5000};
 expect(canUseRenderer(grant,lease,1,100)).toBe(true);expect(canUseRenderer(grant,lease,2,100)).toBe(false);
 expect(canUseRenderer(grant,{...lease,frame:4},1,100)).toBe(false);expect(canUseRenderer(grant,lease,1,6000)).toBe(false);
 expect(canUseRenderer(grant,{...lease,expires:20000},1,10000)).toBe(false);expect(canUseRenderer(undefined,lease,1,100)).toBe(false);
});
