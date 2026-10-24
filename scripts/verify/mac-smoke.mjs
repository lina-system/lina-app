// SPDX-License-Identifier: Apache-2.0
// Standalone signed-copy measurement; never unlocks or changes the login session.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execute } from './flutter.mjs';
const root=process.cwd();
if(process.platform!=='darwin') throw Error('macOS only');
const artifact=resolve(root,'packages/lina_app/build/macos/Build/Products/Release/LINA.app');
mkdirSync(join(root,'build'),{recursive:true});
const installation=join(mkdtempSync(join(root,'build/install-')),'LINA.app');
execute('ditto',[artifact,installation],root);
execute('codesign',['--verify','--deep','--strict',installation],root);
const diskKiB=Number(execute('du',['-sk',installation],root).trim().split(/\s/)[0]);
const locked=execute('python3',['-c',`import plistlib,subprocess,json
v=plistlib.loads(subprocess.check_output(['ioreg','-n','Root','-d1','-a']))
roots=v if isinstance(v,list) else [v]
users=[u for r in roots for u in r.get('IOConsoleUsers',[]) if u.get('kCGSSessionOnConsoleKey')]
print(json.dumps(not users or any(u.get('CGSSessionScreenIsLocked',True) for u in users)))`],root).trim()!=='false';
const evidence={installDirectory:installation,diskKiB,signing:'ad-hoc; strict verification passed',startup:'unverified',residentMemory:'unverified',trials:[]};
if(locked) evidence.reason='Console session is locked; no GUI process launched and no session/lock settings changed.';
else {
  for(let trial=0;trial<3;trial++) {
    const start=performance.now();
    const child=spawn(join(installation,'Contents/MacOS/LINA'),[],{env:{...process.env,LINA_MEASURE_STARTUP:'1'},stdio:['ignore','pipe','pipe']});
    const exited=new Promise(resolve=>child.once('exit',resolve));
    try {
      const firstFrame=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('first rasterized frame deadline exceeded')),20000);
        let output='';
        child.stdout.on('data',chunk=>{output+=chunk; if(output.includes('LINA_FIRST_FRAME')) {clearTimeout(timeout); resolve(performance.now()-start);} });
        child.once('error',e=>{clearTimeout(timeout);reject(e);});
        child.once('exit',()=>{clearTimeout(timeout);reject(Error('app exited before first frame'));});
      });
      await new Promise(resolve=>setTimeout(resolve,3000));
      const rssKiB=Number(execute('ps',['-o','rss=','-p',String(child.pid)],root).trim());
      evidence.trials.push({firstFrameMs:firstFrame,rssKiB});
    } finally {
      child.kill('SIGTERM');
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
      await exited; clearTimeout(timer);
    }
  }
  evidence.startup='measured process spawn to first rasterized Flutter frame';
  evidence.residentMemory='ps RSS sampled three seconds after first frame';
}
writeFileSync(join(root,'build/mac-install.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
