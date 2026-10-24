// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Tokenize before linting: comments and visible prose must not trigger rules.
// Reject numbers at their declaration as well as at their use sites.
export function lintSource(source) {
  const lex = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|r?(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(?:0x[\da-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)|[A-Za-z_$][\w$]*|[^\s]/giy;
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset++; continue; }
    lex.lastIndex = offset;
    const match = lex.exec(source);
    if (!match) throw Error(`cannot tokenize Dart at ${offset}`);
    offset = lex.lastIndex;
    if (match[0].startsWith('//') || match[0].startsWith('/*')) continue;
    tokens.push({ text: match[0], line: source.slice(0,match.index).split('\n').length });
  }
  const errors = [];
  for (let i = 0; i < tokens.length; i++) {
    const { text, line } = tokens[i];
    const next = tokens[i+1]?.text;
    const fontFromToken = tokens[i+3]?.text === '.' && /^type[A-Z]/.test(tokens[i+4]?.text ?? '');
    if (/^(?:\d|\.\d)/.test(text) ||
        text === 'Color' && ['(', '.'].includes(next) ||
        ['Colors','CupertinoColors','Icons','CupertinoIcons','FontWeight','Curves'].includes(text) && next === '.' ||
        ['BorderRadius','EdgeInsets','Radius','Size','Duration'].includes(text) && next === '.' && ['zero','infinite'].includes(tokens[i+2]?.text) ||
        text === 'fontFamily' && next === ':' && !fontFromToken ||
        text === 'fontFamilyFallback' && next === ':' && tokens[i+2]?.text === '[' && /^r?['"]/.test(tokens[i+3]?.text ?? '')) {
      errors.push(`line ${line}: raw visual value ${text}; use LinaTokens or the shared design widgets`);
    }
  }
  return errors;
}
export function lintRepository(root) {
  const exempt = new Set(['packages/lina_design/lib/generated/tokens.dart','packages/lina_design/lib/generated/icons.dart']);
  const errors = [];
  function visit(path) {
    if (!existsSync(join(root,path))) return;
    for (const file of readdirSync(join(root,path),{withFileTypes:true})) {
      const child = `${path}/${file.name}`;
      if (file.isSymbolicLink()) throw Error(`symlink source: ${child}`);
      if (file.isDirectory()) visit(child);
      else if (child.endsWith('.dart') && !exempt.has(child)) errors.push(...lintSource(readFileSync(join(root,child),'utf8')).map(e => `${child}: ${e}`));
    }
  }
  for (const path of ['packages/lina_design/lib','packages/lina_app/lib']) visit(path);
  if (errors.length) throw Error(errors.join('\n'));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  lintRepository(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  console.log('visual-values: app and design libraries passed');
}
