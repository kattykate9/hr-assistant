"use client";
import { useEffect, useId, useRef, useState } from "react";
export default function ResumePreview({text}:{text:string}) {
  const [expanded,setExpanded]=useState(false);
  const [long,setLong]=useState(false);
  const paragraph=useRef<HTMLParagraphElement>(null);
  const id=useId();
  useEffect(()=>{
    const element=paragraph.current;if(!element)return;
    const measure=()=>setLong(element.scrollHeight>141);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(element);
    window.addEventListener('resize',measure);
    return ()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  },[text,expanded]);
  return <div className="mt-4">
    <p ref={paragraph} id={id} className="whitespace-pre-wrap break-words text-sm text-slate-700" style={{lineHeight:'28px',overflowWrap:'anywhere',...(expanded?{}:{display:'-webkit-box',WebkitBoxOrient:'vertical',WebkitLineClamp:5,maxHeight:140,overflow:'hidden'})}}>{text}</p>
    {(long||expanded)&&<button type="button" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(v=>!v)} className="mt-3 rounded text-sm font-medium text-indigo-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-indigo-600">{expanded?'Свернуть':'Развернуть'}</button>}
  </div>;
}
