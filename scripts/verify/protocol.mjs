// SPDX-License-Identifier: Apache-2.0
// lina-schema-dart 1.0.0: deliberately limited to the pinned schema vocabulary.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execute } from './flutter.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = 'packages/lina_protocol/lib/generated';
function files(dir) {
  return readdirSync(dir, {withFileTypes:true}).flatMap(f => {
    if (f.isSymbolicLink()) throw Error(`symlink: ${f.name}`);
    return f.isDirectory() ? files(join(dir,f.name)).map(p => `${f.name}/${p}`) : [f.name];
  }).sort();
}
export function generate(repo = root, write = false) {
  const pin = JSON.parse(readFileSync(join(repo,'protocol/upstream.json')));
  if (pin.repository !== 'lina-system/lina' || !/^[a-f0-9]{40}$/.test(pin.revision)) throw Error('invalid protocol pin');
  const actual = files(join(repo,'protocol/core'));
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(pin.sha256).sort())) throw Error('protocol snapshot inventory drift');
  for (const path of actual) if (createHash('sha256').update(readFileSync(join(repo,'protocol/core',path))).digest('hex') !== pin.sha256[path]) throw Error(`protocol snapshot digest: ${path}`);
  const source = readFileSync(join(repo,'protocol/core/schema/client/1.0/envelope.json'),'utf8');
  const schema = JSON.parse(source);
  const vocabulary = new Set(['$comment','$schema','title','description','type','properties','required','additionalProperties','allOf','$defs','$ref','enum','const','anyOf','oneOf','not','if','then','else','items','minimum','maximum','minLength','maxLength','minItems','maxItems','pattern','format','x-go-type','x-go-prefix']);
  function audit(s) {
    if (typeof s === 'boolean') return;
    for (const [key,value] of Object.entries(s)) {
      if (!vocabulary.has(key)) throw Error(`unsupported schema keyword: ${key}`);
      if (['properties','$defs'].includes(key)) Object.values(value).forEach(audit);
      if (['allOf','anyOf','oneOf'].includes(key)) value.forEach(audit);
      if (['not','if','then','else','items','additionalProperties'].includes(key) && typeof value === 'object') audit(value);
      if (key === '$ref' && !Object.hasOwn(schema.$defs,value.replace('#/$defs/',''))) throw Error(`unresolved reference: ${value}`);
      if (key === 'format' && !['date-time','uri'].includes(value)) throw Error(`unsupported format: ${value}`);
    }
  }
  audit(schema);
  if (source.includes("'''")) throw Error('schema cannot contain Dart raw delimiter');
  const pascal = n => 'Protocol' + n.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join('');
  const camel = n => n.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
  const objects = Object.fromEntries(Object.entries(schema.$defs).filter(([,s])=>s.type === 'object'));
  function spec(s) {
    if (s.$ref) {
      const name = s.$ref.split('/').at(-1);
      if (objects[name]) return [pascal(name), e=>`${pascal(name)}.fromJson(${e} as Map<String, dynamic>)`];
      return spec(schema.$defs[name]);
    }
    if (s.anyOf) {
      const nonnull = s.anyOf.filter(v=>v.type !== 'null');
      if (nonnull.length === 1) { const [t,c] = spec(nonnull[0]); return [t.endsWith('?')?t:t+'?', e=>`${e} == null ? null : ${c(e)}`]; }
    }
    const type = s.type ?? (s.const !== undefined ? typeof s.const : s.enum ? typeof s.enum[0] : null);
    if (type === 'string') return ['String',e=>`${e} as String`];
    if (type === 'boolean') return ['bool',e=>`${e} as bool`];
    if (['number','integer'].includes(type)) return ['ExactNumber',e=>`ExactNumber.of(${e})`];
    if (type === 'array') { const [t,c]=spec(s.items??{}); return [`List<${t}>`,e=>`List.unmodifiable((${e} as List).map((v) => ${c('v')}))`]; }
    if (type === 'object') return ['Map<String, dynamic>',e=>`${e} as Map<String, dynamic>`];
    return ['Object?',e=>e];
  }
  function model(name,s,ref) {
    let result = `class ${name} extends ProtocolObject {\n  ${name}.fromJson(Map<String, dynamic> value) : super(value, ${ref});\n`;
    for (const [field,fieldSchema] of Object.entries(s.properties??{})) {
      let [type,convert] = spec(fieldSchema);
      const e = `json['${field}']`;
      const optional = !(s.required??[]).includes(field);
      let expr = convert(e);
      if (optional && !type.endsWith('?')) { type+='?'; expr=`${e} == null ? null : ${expr}`; }
      let key = camel(field); if (['switch','default','enum','class','in','is','with'].includes(key)) key+='Value';
      result+=`  ${type} get ${key} => ${expr};\n`;
    }
    if (name === 'Envelope') result+=`  factory Envelope.decode(String text) => Envelope.fromJson(exactDecode(text) as Map<String,dynamic>);\n  String encode() => exactEncode(json);\n  ProtocolObject get typedPayload => switch (kind) {\n${schema.allOf.filter(x=>x.if?.properties?.kind?.const && x.then?.properties?.payload?.$ref).map(x=>`    '${x.if.properties.kind.const}' => ${pascal(x.then.properties.payload.$ref.split('/').at(-1))}.fromJson(payload),`).join('\n')}\n    _ => throw FormatException('unknown kind'),\n  };\n`;
    return result+'}\n';
  }
  const generated = `// SPDX-License-Identifier: Apache-2.0\n// Generated by lina-schema-dart 1.0.0. DO NOT EDIT.\nimport '../src/json.dart';\nimport '../src/schema.dart';\nexport '../src/json.dart';\n\nfinal protocolSchema = Schema(exactDecode(r'''${source}''') as Map<String,dynamic>);\n\nabstract class ProtocolObject {\n  ProtocolObject(Map<String,dynamic> value, String? definition) : json = freezeJson(value) as Map<String,dynamic> {\n    protocolSchema.validate(json, definition: definition);\n  }\n  final Map<String,dynamic> json;\n  Map<String,dynamic> toJson() => json;\n}\n${model('Envelope',schema,'null')}\n${Object.entries(objects).map(([n,s])=>model(pascal(n),s,`'${n}'`)).join('\n')}`;
  const temp=mkdtempSync(join(tmpdir(),'lina-protocol-'));
  try {
    writeFileSync(join(temp,'protocol.dart'),generated);
    execute('dart',['format',join(temp,'protocol.dart')],repo);
    const bytes=readFileSync(join(temp,'protocol.dart'));
    if (write) { mkdirSync(join(repo,output),{recursive:true}); writeFileSync(join(repo,output,'protocol.dart'),bytes); }
    if (JSON.stringify(files(join(repo,output))) !== JSON.stringify(['protocol.dart']) || !bytes.equals(readFileSync(join(repo,output,'protocol.dart')))) throw Error('generated protocol drift; run node scripts/verify/protocol.mjs --write');
  } finally { rmSync(temp,{recursive:true,force:true}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { generate(root,process.argv.includes('--write')); console.log('protocol: pinned snapshot and generated Dart verified'); }
