import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {historicalPerformancePeriods} from './historical-performance-periods.ts';
const url=new URL('../components/practice/acquisition-dashboard.tsx',import.meta.url);
const hook=registerHooks({load(source,context,next){return source===url.href?{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}:next(source,context);}});
const {AcquisitionDashboard}=await import(url.href);hook.deregister();
test('missing cohort linkage never becomes a measured lead requirement, even with a target',()=>{
 const reports=historicalPerformancePeriods({today:'2026-10-26',snapshots:[]});
 const html=renderToStaticMarkup(createElement(AcquisitionDashboard,{reports,target:'10',onTarget(){throw Error('No writes during rendering');}}));
 assert.match(html,/Estimated leads needed \/ month: Unknown/);
 assert.match(html,/Net active additions \/ month: Unknown/);
 assert.match(html,/not net active growth/);
 assert.match(html,/Not enough covered history/);
 assert.match(html,/Google Ads and Meta Ads are not connected/);
 assert.match(html,/value="10"/);
});
test('negative scenario target is invalid, not an inferred acquisition forecast',()=>{
 const reports=historicalPerformancePeriods({today:'2026-10-26',snapshots:[]});
 const html=renderToStaticMarkup(createElement(AcquisitionDashboard,{reports,target:'-1',onTarget(){}}));
 assert.match(html,/aria-invalid="true"/);assert.match(html,/Enter a target of zero or more/);
});
