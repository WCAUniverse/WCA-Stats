// Builds promotion-editor.html out of index.html (Oct 2026).
// The editor's code lives in index.html. This pulls out only the pieces the
// editor uses (everything they need, nothing they don't), adds the editor's
// own page shell, and writes promotion-editor.html next to index.html.
// Run it again any time index.html changes:  node tools/build-promotion-editor.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const ROOT = process.argv[2] || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---- the page's styles: all of them, so everything looks the same as on the site
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');

// ---- the scripts, as top level statements we can pick from
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
// skip: the address block (the editor has its own), and the service worker cleanup
const use = blocks.filter((b, i) => i !== 0 && !/navigator\.serviceWorker\.getRegistrations/.test(b.slice(0, 300)));

// names the editor defines itself, so they are never copied
const OWN = new Set(['wcaRoute','wcaHref','wcaSetAddress','WCA_PATHS','WCA_PAGES','WCA_SEG_FOR','WCA_PAGE_FOR',
  'sb','pmGo','goPage','activatePage','frSignIn','stxOpen','stxOnSite','STX_SITE']);
// where the editor starts
const ENTRY = ['mpOpen','stxQs','stxRender','wcaToast','wcaKeepScan','wcaKeepDone','mpTab','pmColor','esc','escAttr','CURRENT_USER','MY_PROFILE','IS_ADMIN','VIEW_AS_ID'];
// top level statements that are not declarations but must come along
const KEEP_EXPR = [/WCA_KEEP_T/];

const stmts = [];   // { blk, code, declares:Set, refs:Set, expr:bool, root }
use.forEach((src, blk) => {
  let ast;
  try{ ast = acorn.parse(src, { ecmaVersion:'latest', sourceType:'script', allowReturnOutsideFunction:true }); }
  catch(e){ throw new Error('Could not read script ' + blk + ': ' + e.message); }
  for(const node of ast.body){
    const code = src.slice(node.start, node.end);
    const declares = new Set();
    if(node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration'){ if(node.id) declares.add(node.id.name); }
    else if(node.type === 'VariableDeclaration'){
      for(const d of node.declarations) collectPattern(d.id, declares);
    }
    const refs = new Set();
    walk.full(node, n => {
      if(n.type === 'Identifier') refs.add(n.name);
      else if(n.type === 'Literal' && typeof n.value === 'string') for(const w of n.value.match(/[A-Za-z_$][\w$]*/g) || []) refs.add(w);
      else if(n.type === 'TemplateElement') for(const w of (n.value.cooked || n.value.raw || '').match(/[A-Za-z_$][\w$]*/g) || []) refs.add(w);
    });
    let root = null;
    if(node.type === 'ExpressionStatement'){
      let e = node.expression;
      if(e.type === 'AssignmentExpression') e = e.left;
      if(e.type === 'CallExpression') e = e.callee;
      while(e && e.type === 'MemberExpression') e = e.object;
      if(e && e.type === 'Identifier') root = e.name;
    }
    stmts.push({ blk, code, node, declares, refs, expr:node.type === 'ExpressionStatement', root });
  }
});
function collectPattern(p, out){
  if(!p) return;
  if(p.type === 'Identifier') out.add(p.name);
  else if(p.type === 'ObjectPattern') p.properties.forEach(q => collectPattern(q.value || q.argument, out));
  else if(p.type === 'ArrayPattern') p.elements.forEach(q => collectPattern(q, out));
  else if(p.type === 'RestElement') collectPattern(p.argument, out);
  else if(p.type === 'AssignmentPattern') collectPattern(p.left, out);
}

const declaredBy = new Map();
stmts.forEach((s, i) => s.declares.forEach(n => { if(!declaredBy.has(n)) declaredBy.set(n, []); declaredBy.get(n).push(i); }));

const need = new Set(), keep = new Set(), queue = [];
function want(name){
  if(OWN.has(name) || need.has(name) || !declaredBy.has(name)) return;
  need.add(name); queue.push(name);
}
function take(i){
  if(keep.has(i)) return; keep.add(i);
  stmts[i].refs.forEach(want);
}
ENTRY.forEach(want);
stmts.forEach((s, i) => { if(s.expr && KEEP_EXPR.some(r => r.test(s.code))) take(i); });
let changed = true;
while(changed){
  changed = false;
  while(queue.length){ const n = queue.shift(); (declaredBy.get(n) || []).forEach(i => { if(!stmts[i].declares.has(n)) return; if([...stmts[i].declares].some(d => OWN.has(d))) return; take(i); }); changed = true; }
  // set up statements for things we kept: STX.facts = {}, STX_LV.best = ..., LIST.forEach(...)
  stmts.forEach((s, i) => { if(!keep.has(i) && s.expr && s.root && need.has(s.root) && !OWN.has(s.root)){ take(i); changed = true; } });
}

const out = {};
[...keep].sort((a, b) => a - b).forEach(i => { (out[stmts[i].blk] = out[stmts[i].blk] || []).push(stmts[i].code); });
const scripts = Object.keys(out).sort((a, b) => a - b).map(b => '<script>\n' + out[b].join('\n') + '\n</script>').join('\n');

const shell = fs.readFileSync(path.join(ROOT, 'tools', 'promotion-editor.shell.html'), 'utf8');
const page = shell
  .replace('/*__STYLES__*/', () => styles)
  .replace('<!--__SCRIPTS__-->', () => scripts);
fs.writeFileSync(path.join(ROOT, 'promotion-editor.html'), page);
console.log('promotion-editor.html: ' + (page.length / 1024 | 0) + ' KB, ' + keep.size + ' of ' + stmts.length + ' pieces of index.html');
