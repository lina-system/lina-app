// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate } from './protocol.mjs';
import { classify } from './scope.mjs';
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'lina-schema-test-'));
  for (const path of ['protocol','packages/lina_protocol/lib/generated']) cpSync(path,join(root,path),{recursive:true});
  t.after(()=>rmSync(root,{recursive:true,force:true})); return root;
}
test('protocol paths are registered, executable files are not snapshot data',()=>{
  assert.deepEqual(classify(['packages/lina_protocol/lib/lina_protocol.dart','protocol/core/schema/client/1.0/envelope.json']),['lina_protocol']);
  assert.throws(()=>classify(['protocol/core/fixtures/run.mjs']),/unmapped/);
});
test('generator detects output changes and unexpected generated files',t=>{
  const root=fixture(t),file=join(root,'packages/lina_protocol/lib/generated/protocol.dart');
  writeFileSync(file,readFileSync(file,'utf8')+'// drift\n');
  assert.throws(()=>generate(root),/drift/);
  generate(root,true);
  writeFileSync(join(root,'packages/lina_protocol/lib/generated/stale.dart'),'// stale');
  assert.throws(()=>generate(root),/drift/);
});
test('upstream digest and inventory corruption fail before generation',t=>{
  const root=fixture(t);
  writeFileSync(join(root,'protocol/core/schema/client/1.0/envelope.json'),'{}');
  assert.throws(()=>generate(root),/digest/);
  writeFileSync(join(root,'protocol/core/fixtures/extra.json'),'{}');
  assert.throws(()=>generate(root),/inventory/);
});
test('the protocol boundary cannot become an unlinted widget package',()=>{
  function visit(path) {
    for(const f of readdirSync(path,{withFileTypes:true})) {
      const child=join(path,f.name);
      if(f.isDirectory()) visit(child);
      else if(f.name.endsWith('.dart')) assert.doesNotMatch(readFileSync(child,'utf8'), /(?:import|export)\s+['"](?:dart:ui|package:(?:flutter|lina_design|lina_app)\/)/,child);
    }
  }
  visit('packages/lina_protocol/lib');
});
