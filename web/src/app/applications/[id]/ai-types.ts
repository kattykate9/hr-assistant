export type AIResult={facts:{category:"experience"|"skills"|"projects";text:string;evidence:string}[];answers:{key:string;criterion:string;kind:string;rating:"confirmed"|"partial"|"not_confirmed"|"not_applicable";evidence:string;explanation:string;question:string}[];percent:number|null;total:number;excluded:number;formula_version:string};
export type AIState={fingerprint:string;available:boolean;reason:string;result:AIResult|null;stale:boolean;updated_at:string|null;model:string|null;run:{status:string;detail:string;updated_at:string}|null};
export type AIAction={data?:AIState;error?:string};
