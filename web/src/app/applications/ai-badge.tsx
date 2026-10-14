export type AISummary={percent:number|null;has_assessment:boolean;stale:boolean};
export default function AIBadge({value}:{value?:AISummary}){
 const p=value?.percent;
 const label=value?.stale?"AI · устарела":p==null?(value?.has_assessment?"AI · без %":"AI · нет оценки"):`AI · ${p}%`;
 const colors=value?.stale||p==null?{backgroundColor:"transparent",color:"#64748b"}:p<30?{backgroundColor:"#fcebec",color:"#991b1b"}:p<50?{backgroundColor:"#fff0e3",color:"#9a3412"}:p<70?{backgroundColor:"#fff8d9",color:"#854d0e"}:p<85?{backgroundColor:"#e0f4f1",color:"#115e59"}:{backgroundColor:"#e8f5ec",color:"#166534"};
 return <span title={value?.stale?"Резюме или вакансия изменились — нужен новый анализ":"AI: подтверждение критериев сведениями резюме, не вероятность успешного найма"} style={{...colors,display:"inline-block",borderRadius:999,padding:"5px 12px",fontSize:12,fontWeight:600,border:p==null||value?.stale?"1px dashed #cbd5e1":"1px solid transparent"}}>{label}</span>;
}
