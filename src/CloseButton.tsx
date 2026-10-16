import {StudyIcon} from './StudyIcon';
export function CloseButton({label='Закрыть',onClick,disabled=false,autoFocus=false}:{label?:string;onClick:()=>void;disabled?:boolean;autoFocus?:boolean}){
 return <button type="button" className="close-button" aria-label={label} title={label} onClick={onClick} disabled={disabled} autoFocus={autoFocus}><StudyIcon name="close"/></button>;
}
