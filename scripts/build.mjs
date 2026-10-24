// SPDX-License-Identifier: Apache-2.0
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { foundation } from './foundation.mjs';
import { execute } from './verify/flutter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root,'packages/lina_app');
const target = process.argv[2];
const targets = {
  ios:['ios','--release','--no-codesign'],
  'ios-simulator':['ios','--simulator','--debug','--no-codesign'],
  android:['appbundle','--release'],macos:['macos','--release'],
  windows:['windows','--release'],linux:['linux','--release'],
};
if (process.argv.length !== 3 || !Object.hasOwn(targets,target)) throw Error('Usage: node scripts/build.mjs ios|ios-simulator|android|macos|windows|linux');
if (foundation(root).status !== 'passed') process.exit(1);
console.log(execute('flutter',['build',...targets[target],'--no-pub'],app));
let artifact = {
  ios:'build/ios/iphoneos/Runner.app','ios-simulator':'build/ios/iphonesimulator/Runner.app',
  android:'build/app/outputs/bundle/release/app-release.aab',
  macos:'build/macos/Build/Products/Release/LINA.app',
  windows:'build/windows/x64/runner/Release',linux:'build/linux/x64/release/bundle',
}[target];
if (!existsSync(join(app,artifact)) && ['windows','linux'].includes(target)) artifact=artifact.replace('/x64/','/arm64/');
if (!existsSync(join(app,artifact))) throw Error(`expected artifact missing: ${artifact}`);
// Include reviewed notices alongside native outputs before signing.
const directory=target==='android'?dirname(join(app,artifact)):join(app,artifact);
const noticePath=target==='macos'?join(directory,'Contents/Resources/THIRD-PARTY-NOTICES.md'):join(directory,'THIRD-PARTY-NOTICES.md');
writeFileSync(noticePath,readFileSync(join(root,'THIRD-PARTY-NOTICES.md')));
const packageConfig=join(app,'.dart_tool/package_config.json');
const engine=JSON.parse(readFileSync(packageConfig)).packages.find(p=>p.name==='sky_engine');
if(!engine) throw Error('resolved sky_engine package missing');
const engineLicense=readFileSync(fileURLToPath(new URL('LICENSE',new URL(engine.rootUri.endsWith('/')?engine.rootUri:engine.rootUri+'/',pathToFileURL(packageConfig)))));
if(engineLicense.length<100000) throw Error('incomplete engine notice bundle');
writeFileSync(join(dirname(noticePath),'Flutter-Engine-NOTICES.txt'),engineLicense);
const engineLicenseSha256=createHash('sha256').update(engineLicense).digest('hex');
let signing = 'unsigned';
if (target==='macos') {
  execute('codesign',['--force','--deep','--sign','-',join(app,artifact)],root);
  execute('codesign',['--verify','--deep','--strict',join(app,artifact)],root);
  signing='ad-hoc; codesign --verify --deep --strict passed; not notarized';
}
if (target==='android') signing='Flutter development debug key; not a distribution signature';
const hashes={}, sizes=[];
function inventory(path) {
  const entries=readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const entry of entries) {
    const child=join(path,entry.name),key=relative(join(app,artifact),child).replaceAll('\\','/');
    if(entry.isDirectory()) inventory(child);
    else if(entry.isSymbolicLink()) hashes[key]=`symlink:${readlinkSync(child)}`;
    else { const data=readFileSync(child); sizes.push(data.length); hashes[key]=createHash('sha256').update(data).digest('hex'); }
  }
}
if(target==='android') { const bytes=readFileSync(join(app,artifact)); sizes.push(bytes.length); hashes['app-release.aab']=createHash('sha256').update(bytes).digest('hex'); }
else inventory(join(app,artifact));
const metadata={schemaVersion:1,target,engineLicenseSha256,flutter:readFileSync(join(root,'.flutter-version'),'utf8').trim(),sourceRevision:execute('git',['rev-parse','HEAD'],root).trim(),dirty:execute('git',['status','--porcelain'],root).trim()!=='',artifact:relative(root,join(app,artifact)).replaceAll('\\','/'),bytes:sizes.reduce((a,b)=>a+b,0),sha256:createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),digestFormat:'SHA-256 of JSON file-path to SHA-256/symlink-target inventory',signing,files:hashes};
mkdirSync(join(root,'build/artifacts'),{recursive:true});
writeFileSync(join(root,`build/artifacts/${target}.json`),JSON.stringify(metadata,null,2)+'\n');
console.log(`artifact: ${metadata.artifact}; ${metadata.bytes} bytes; ${metadata.sha256}; ${signing}`);
