import { deriveClinicalMetricCatalog } from './clinical-metric-catalog.ts';

export type ClinicalBundleInput = Omit<Parameters<typeof deriveClinicalMetricCatalog>[0], 'currentModels'>;
type Catalog = ReturnType<typeof deriveClinicalMetricCatalog>;
export type ClinicalComputedBundle = Readonly<{
 schemaVersion: 1; revision: number; catalog: Catalog;
 workflowStatus: 'Unreviewed acquisition models are not connected';
}>;
function freeze<T>(value:T):T {
 if(value && typeof value==='object') { for(const child of Object.values(value)) freeze(child);Object.freeze(value); }
 return value;
}
/** Prepared coordinator, not a live subscription/cache or auth boundary. Create
 * one per authorized consumer context and clear it on sign-out/scope change.
 * Every complete source input creates a fresh local revision: imports, coverage,
 * overrides, roster, workload, settings, source periods and as-of all invalidate.
 * Revisions are process-local ordering tokens, NOT source hashes or approvals.
 * The caller must first assemble a coherent authorized input snapshot; this
 * cannot detect separately fetched inputs from incompatible server revisions. */
export function createClinicalComputationCoordinator() {
 let revision=0;
 let state:Readonly<{status:'idle'|'pending'|'ready'|'error';revision:number;bundle:ClinicalComputedBundle|null}>=freeze({status:'idle',revision,bundle:null});
 const produced=new WeakSet<object>();
 return {
  begin(input:ClinicalBundleInput) {
   const requested=++revision;
   state=freeze({status:'pending',revision,bundle:null});
   let captured:ClinicalBundleInput;
   try {
    // Invalid new input still invalidates old displayed or pending results.
    if('currentModels' in input) throw new TypeError('Precomputed workflow models are not accepted in a coherent source bundle');
    captured=freeze(structuredClone(input));
   } catch(error) {
    state=freeze({status:'error',revision,bundle:null});
    throw error;
   }
   return Object.freeze({revision:requested,compute:():ClinicalComputedBundle=>{
    try {
     const bundle=freeze({schemaVersion:1 as const,revision:requested,catalog:deriveClinicalMetricCatalog(captured),
      workflowStatus:'Unreviewed acquisition models are not connected' as const});
     produced.add(bundle);return bundle;
    } catch(error) {
     if(requested===revision) state=freeze({status:'error',revision,bundle:null});
     throw error;
    }
   }});
  },
  accept(bundle:ClinicalComputedBundle) {
   if(!produced.has(bundle)||bundle.revision!==revision||state.status!=='pending') return false;
   state=freeze({status:'ready',revision,bundle});return true;
  },
  clear() { state=freeze({status:'idle',revision:++revision,bundle:null}); },
  read() { return state; },
 };
}
