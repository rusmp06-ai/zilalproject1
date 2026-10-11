import {useEffect,useState} from 'react';
const dirty=new Set<string>();
export function mayLeaveDrafts(){return !dirty.size||window.confirm('Есть несохранённый текст. Перейти в другой раздел? Черновик останется в этой вкладке.');}
export function useDraft<T>(key:string,initial:T){
 const empty=JSON.stringify(initial),storageKey='studyhub-draft-v1:'+key;
 const [value,setValue]=useState<T>(()=>{try{const saved=sessionStorage.getItem(storageKey);if(!saved)return initial;const parsed=JSON.parse(saved);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return initial;for(const [name,base] of Object.entries(initial as object))if(!(name in parsed)||(base!==null&&typeof parsed[name]!==typeof base))return initial;return parsed;}catch{return initial;}});
 const [storageError,setStorageError]=useState(false),changed=JSON.stringify(value)!==empty;
 useEffect(()=>{try{if(changed)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);setStorageError(false);}catch{setStorageError(true);}if(changed)dirty.add(key);else dirty.delete(key);return()=>{dirty.delete(key);};},[key,storageKey,value,changed]);
 useEffect(()=>{if(!changed)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[changed]);
 return {value,setValue,clear:()=>setValue(initial),changed,storageError};
}
