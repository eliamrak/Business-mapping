import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const url=new URL('../components/practice/matured-starts-summary.tsx',import.meta.url);
const hook=registerHooks({load(source,context,next){return source===url.href?{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}:next(source,context);}});
const {MaturedStartsSummary}=await import(url.href);hook.deregister();
test('known partial mature months render starts and signed raw-result difference visibly',()=>{
 const html=renderToStaticMarkup(createElement(MaturedStartsSummary,{comparison:{months:['2026-04','2026-06'],maturedStarts:30,averageStarts:15,averageEndings:13,difference:2}}));
 assert.match(html,/Matured starts \/ month<\/dt><dd>15/);
 assert.match(html,/Starts minus endings \/ month<\/dt><dd>\+2/);
 assert.match(html,/2 covered mature months/);assert.doesNotMatch(html,/<details| hidden|sr-only/);
});
test('missing starts never disappear or get inferred from the existing 13 or 7.6 ending average',()=>{
 for(const comparison of [undefined,{months:['2026-04'],maturedStarts:null,averageStarts:null,averageEndings:null,difference:null}]){
  const html=renderToStaticMarkup(createElement(MaturedStartsSummary,{comparison}));
  assert.match(html,/Matured starts \/ month<\/dt><dd>Unknown/);
  assert.match(html,/Starts minus endings \/ month<\/dt><dd>Unknown/);
  assert.match(html,/Starts comparison unavailable/);assert.doesNotMatch(html,/<details| hidden|sr-only/);
 }
});
test('known zero and negative balance remain distinct from unknown and clinician labels are preserved',()=>{
 const html=renderToStaticMarkup(createElement(MaturedStartsSummary,{label:'Synthetic Lane',comparison:{months:['2026-04'],maturedStarts:0,averageStarts:0,averageEndings:7.6,difference:-7.6}}));
 assert.match(html,/Matured starts \/ month<\/dt><dd>0/);assert.match(html,/<dd>-7.6/);assert.match(html,/Synthetic Lane matched starts and endings/);
});

test('paired bars use an explicit shared count scale; unknown omits fill and zero has zero width',()=>{
 const html=renderToStaticMarkup(createElement(MaturedStartsSummary,{endings:13,scale:20,comparison:{months:['2026-04'],maturedStarts:17.7,averageStarts:17.7,averageEndings:13,difference:4.7}}));
 assert.match(html,/class="pw-attrition-bar-fill starts" style="width:88.5%"/);
 assert.match(html,/class="pw-attrition-bar-fill endings" style="width:65%"/);
 assert.match(html,/data-direction="positive"/);
 const zero=renderToStaticMarkup(createElement(MaturedStartsSummary,{endings:0,scale:0}));
 assert.match(zero,/style="width:0%"/);assert.doesNotMatch(zero,/pw-attrition-bar-fill starts/);
});
