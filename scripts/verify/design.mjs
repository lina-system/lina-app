// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const modes = ['light', 'dark', 'high-contrast'];
const generated = 'packages/lina_design/lib/generated';
const read = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
export function flatten(group, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(group)) {
    if (key.startsWith('$')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (!value || typeof value !== 'object') throw Error(`invalid group: ${path}`);
    if ('$value' in value) result[path] = value;
    else flatten(value, path, result);
  }
  return result;
}
export function contrast(a, b) {
  const lum = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export const textMinimum = (pixels, weight) => pixels >= 24 || pixels >= 56 / 3 && weight >= 700 ? 3 : 4.5;
export function validateContrast(theme) {
  const c = role => theme.tokens[`color.${role}`].$value.hex;
  const pairs = [];
  const check = (fg, bg, minimum) => {
    const ratio = contrast(c(fg), c(bg));
    if (!Number.isFinite(ratio) || ratio < minimum) throw Error(`${theme.name}: ${fg}/${bg} contrast ${ratio.toFixed(3)} < ${minimum}`);
    pairs.push({ foreground: fg, background: bg, minimum, ratio });
  };
  for (const fg of ['text', 'muted', 'accent', 'success', 'warning', 'error', 'unknown', 'working', 'waiting', 'disabled']) {
    for (const bg of ['canvas', 'surface']) check(fg, bg, theme.name === 'high-contrast' && ['text', 'muted', 'accent'].includes(fg) ? 7 : 4.5);
  }
  for (const bg of ['canvas', 'surface']) for (const fg of ['focus', 'border']) check(fg, bg, 3);
  check('onAccent', 'accent', 4.5);
  check('onSelection', 'selection', 4.5);
  check('diffAdded', 'diffAddedBackground', 4.5);
  check('diffRemoved', 'diffRemovedBackground', 4.5);
  return pairs;
}
function validateToken(path, token) {
  const v = token.$value;
  const fail = () => { throw Error(`invalid ${token.$type} token: ${path}`); };
  switch (token.$type) {
    case 'color':
      if (v.colorSpace !== 'srgb' || v.alpha !== 1 || !/^#[A-Fa-f0-9]{6}$/.test(v.hex) || v.components?.length !== 3 || v.components.some((x, i) => !Number.isFinite(x) || x < 0 || x > 1 || Math.round(x * 255) !== parseInt(v.hex.slice(1 + i * 2, 3 + i * 2), 16))) fail();
      break;
    case 'dimension': case 'duration':
      if (!Number.isFinite(v.value) || v.value < 0 || v.unit !== (token.$type === 'dimension' ? 'px' : 'ms')) fail();
      break;
    case 'fontFamily': if (!Array.isArray(v) || !v.length || v.some(x => typeof x !== 'string' || !x)) fail(); break;
    case 'fontWeight': if (!Number.isInteger(v) || v < 100 || v > 900 || v % 100) fail(); break;
    case 'number': if (!Number.isFinite(v) || v <= 0) fail(); break;
    case 'string': if (typeof v !== 'string' || !v || /[\p{Cc}\p{Co}]/u.test(v)) fail(); break;
    default: fail();
  }
}
export function loadThemes(root) {
  const assets = read(root, 'design/tokens/assets.json');
  for (const [path, digest] of Object.entries(assets.sha256)) {
    if (!path.startsWith('packages/lina_design/assets/') || path.split('/').includes('..') || createHash('sha256').update(readFileSync(join(root, path))).digest('hex') !== digest) throw Error(`asset digest mismatch: ${path}`);
  }
  const upstream = read(root, 'design/tokens/upstream.json');
  if (!/^[a-f0-9]{40}$/.test(upstream.revision)) throw Error('invalid upstream revision');
  const common = read(root, 'design/tokens/app.json');
  const spring = common.$extensions?.['lina.spring'];
  if (!spring || !['mass', 'stiffness', 'damping'].every(k => Number.isFinite(spring[k]) && spring[k] > 0) || common.$extensions['lina.wordWrap'] !== 'word-phrase') throw Error('invalid motion/wrapping extensions');
  const themes = modes.map(name => {
    const path = `design/tokens/core/${name}.json`;
    if (createHash('sha256').update(readFileSync(join(root, path))).digest('hex') !== upstream.sha256[`${name}.json`]) throw Error(`Core snapshot digest mismatch: ${name}`);
    const core = flatten(read(root, path));
    const extra = read(root, `design/tokens/${name}.json`);
    if (extra.$extensions?.['lina.theme'] !== name) throw Error(`wrong theme: ${name}`);
    const tokens = { ...core };
    for (const source of [common, extra]) for (const [path, token] of Object.entries(flatten(source))) {
      if (tokens[path]) throw Error(`cannot override canonical token: ${path}`);
      tokens[path] = token;
    }
    const resolveToken = (path, seen = new Set()) => {
      const t = tokens[path];
      if (!t || seen.has(path)) throw Error(`missing/cyclic alias: ${path}`);
      const alias = typeof t.$value === 'string' && t.$value.match(/^\{(.+)\}$/);
      if (!alias) return t;
      const target = resolveToken(alias[1], new Set([...seen, path]));
      if (t.$type !== target.$type) throw Error(`alias type mismatch: ${path}`);
      return { ...t, $value: target.$value };
    };
    const resolved = Object.fromEntries(Object.keys(tokens).sort().map(path => [path, resolveToken(path)]));
    for (const [path, token] of Object.entries(resolved)) validateToken(path, token);
    if (resolved['type.lineHeight'].$value < 1.5) throw Error('body line height below 1.5');
    const theme = { name, tokens: resolved, spring };
    validateContrast(theme);
    return theme;
  });
  for (const theme of themes.slice(1)) {
    if (JSON.stringify(Object.keys(theme.tokens)) !== JSON.stringify(Object.keys(themes[0].tokens))) throw Error(`incomplete roles: ${theme.name}`);
    for (const [path, token] of Object.entries(theme.tokens)) if (token.$type !== themes[0].tokens[path].$type) throw Error(`type mismatch: ${path}`);
  }
  return themes;
}
const id = path => path.replace(/\.([a-z])/g, (_, x) => x.toUpperCase());
const quote = x => `'${String(x).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('$', '\\$')}'`;
const dartType = t => ({color:'Color', dimension:'double', duration:'Duration', fontFamily:'String', fontWeight:'FontWeight', number:'double', string:'String'})[t.$type];
function dartValue(t) {
  const v = t.$value;
  switch (t.$type) {
    case 'color': return `Color(0xff${v.hex.slice(1)})`;
    case 'dimension': return `${v.value}.0`.replace(/(\.\d+)\.0$/, '$1');
    case 'duration': return `Duration(milliseconds: ${v.value})`;
    case 'fontFamily': return quote(v[0]);
    case 'fontWeight': return `FontWeight.w${v}`;
    case 'number': return Number.isInteger(v) ? `${v}.0` : `${v}`;
    case 'string': return quote(v);
  }
}
function themeDart(themes) {
  const fields = Object.entries(themes[0].tokens);
  const mix = (p, t) => {
    const name = id(p), a = `this.${name}`, b = `other.${name}`;
    switch (t.$type) {
      case 'color': return `Color.lerp(${a}, ${b}, t)!`;
      case 'dimension': case 'number': return `${a} + (${b} - ${a}) * t`;
      default: return `t < 0.5 ? ${a} : ${b}`;
    }
  };
  return `// SPDX-License-Identifier: Apache-2.0
// GENERATED by scripts/verify/design.mjs. Do not edit.
import 'package:flutter/material.dart';
@immutable
class LinaTokens extends ThemeExtension<LinaTokens> {
 const LinaTokens({${fields.map(([p]) => `required this.${id(p)}`).join(',')}});
 ${fields.map(([p,t]) => `final ${dartType(t)} ${id(p)};`).join('\n')}
 static LinaTokens of(BuildContext context) => Theme.of(context).extension<LinaTokens>()!;
 ${themes.map(theme => `static const ${theme.name === 'high-contrast' ? 'highContrast' : theme.name} = LinaTokens(${fields.map(([p]) => `${id(p)}: ${dartValue(theme.tokens[p])}`).join(',')});`).join('\n')}
 @override LinaTokens copyWith({${fields.map(([p,t]) => `${dartType(t)}? ${id(p)}`).join(',')}}) => LinaTokens(${fields.map(([p]) => `${id(p)}: ${id(p)} ?? this.${id(p)}`).join(',')});
 @override LinaTokens lerp(covariant LinaTokens? other, double t) {
 if (other == null) return this;
 return LinaTokens(${fields.map(([p,v]) => `${id(p)}: ${mix(p,v)}`).join(',')});
 }
 static const wordWrap = 'word-phrase';
 static const springMass = ${themes[0].spring.mass}.0;
 static const springStiffness = ${themes[0].spring.stiffness}.0;
 static const springDamping = ${themes[0].spring.damping}.0;
}
`;
}
function iconsDart(source, theme) {
  if (source.grid !== theme.tokens['icon.grid'].$value.value || source.stroke !== theme.tokens['icon.stroke'].$value.value) throw Error('icon grid/stroke mismatch');
  const icons = Object.entries(source.icons);
  const operation = { M:['moveTo',2], L:['lineTo',2], C:['cubicTo',6], Q:['quadraticBezierTo',4], Z:['close',0], O:['addOval',3] };
  const paths = icons.map(([name, icon]) => {
    if (!/^[a-z][a-zA-Z]*$/.test(name) || !icon.unicode || !/^[\x20-\x7e]+$/.test(icon.ascii)) throw Error(`invalid icon: ${name}`);
    const commands = icon.paths.map(([op,...args]) => {
      if (!operation[op] || args.length !== operation[op][1] || args.some(x => !Number.isFinite(x) || x < 0 || x > source.grid)) throw Error(`invalid icon path: ${name}`);
      if (op === 'O') return `..addOval(Rect.fromCircle(center: Offset(${args[0]}, ${args[1]}), radius: ${args[2]}))`;
      return `..${operation[op][0]}(${args.join(', ')})`;
    });
    return `LinaIconName.${name} => Path()${commands.join('')}`;
  });
  return `// SPDX-License-Identifier: Apache-2.0
// GENERATED. Lucide subset: ISC AND MIT; see THIRD-PARTY-NOTICES.md.
import 'dart:ui';
enum LinaIconName { ${icons.map(([n]) => n).join(',')} }
Path linaIconPath(LinaIconName name) => switch (name) { ${paths.join(',')} };
`;
}
function formattedDart(text) {
  const dir = mkdtempSync(join(tmpdir(), 'lina-dart-'));
  try {
    const file = join(dir, 'generated.dart');
    writeFileSync(file, text);
    execFileSync('dart', ['format', '--language-version', '3.13', file], { stdio: 'pipe' });
    return readFileSync(file, 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export function generate(root) {
  const themes = loadThemes(root);
  const icons = read(root, 'design/tokens/icons.json').$extensions['lina.iconSource'];
  const repr = t => t.$type === 'color' ? t.$value.hex : typeof t.$value === 'object' ? JSON.stringify(t.$value) : String(t.$value);
  const table = ['Generated from the pinned Core source plus app extensions. Do not edit.', '', '| Role | Light | Dark | High contrast |', '| --- | --- | --- | --- |',
    ...Object.keys(themes[0].tokens).map(p => `| ${p} | ${themes.map(t => '`'+repr(t.tokens[p]).replaceAll('|','&#124;')+'`').join(' | ')} |`),
    '', '### Motion and wrapping extensions', '', `Word wrapping: \`word-phrase\`. Spring: \`${JSON.stringify(themes[0].spring)}\`.`,
    '', '### App icon / TUI mapping', '', '| Icon | Unicode | ASCII | Source |', '| --- | --- | --- | --- |',
    ...Object.entries(icons.icons).map(([n,i]) => `| ${n} | ${i.unicode} | \`${i.ascii}\` | ${i.source} |`),
    '', '### Contrast evidence', '', '| Mode | Pair | Ratio | Minimum |', '| --- | --- | --- | --- |',
    ...themes.flatMap(t => validateContrast(t).map(p => `| ${t.name} | ${p.foreground} / ${p.background} | ${p.ratio.toFixed(3)} | ${p.minimum} |`)), ''].join('\n');
  const doc = readFileSync(join(root, 'DESIGN.md'), 'utf8');
  if ((doc.match(/<!-- tokens:start -->/g) ?? []).length !== 1 || (doc.match(/<!-- tokens:end -->/g) ?? []).length !== 1) throw Error('missing/duplicate DESIGN token markers');
  return {
    [`${generated}/tokens.dart`]: formattedDart(themeDart(themes)),
    [`${generated}/icons.dart`]: formattedDart(iconsDart(icons, themes[0])),
    'DESIGN.md': doc.replace(/<!-- tokens:start -->[\s\S]*?<!-- tokens:end -->/, `<!-- tokens:start -->\n${table}<!-- tokens:end -->`),
  };
}
export function checkGenerated(root, outputs) {
  const directory = join(root, generated);
  if (existsSync(directory)) for (const file of readdirSync(directory, { recursive: true })) {
    const path = `${generated}/${file}`;
    if (!Object.hasOwn(outputs, path)) throw Error(`unexpected generated output: ${path}`);
  }
  for (const [path, data] of Object.entries(outputs)) if (!existsSync(join(root,path)) || readFileSync(join(root,path),'utf8') !== data) throw Error(`generated drift: ${path}; run node scripts/verify/design.mjs --write`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  if (process.argv.length !== 3 || !['--write','--check'].includes(process.argv[2])) throw Error('Usage: node scripts/verify/design.mjs --write|--check');
  const outputs = generate(root);
  if (process.argv[2] === '--write') for (const [path,data] of Object.entries(outputs)) { mkdirSync(dirname(join(root,path)), {recursive:true}); writeFileSync(join(root,path),data); }
  else checkGenerated(root,outputs);
  console.log('design: three themes, contrast, source provenance and generated outputs passed');
}
