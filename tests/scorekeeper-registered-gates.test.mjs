import test from 'node:test';
import assert from 'node:assert/strict';
test('registered Hub service routes cannot activate in preview or while Production release is held',async()=>{
 for(const n of ['context','publish']){const {default:handler}=await import('../api/scorekeeper-service-'+n+'.js');let status;await handler({method:'POST',headers:{host:'ftg-hub.vercel.app'}},{setHeader(){},status(n){status=n;return this;},json(){}});assert.equal(status,503,n);}
});
