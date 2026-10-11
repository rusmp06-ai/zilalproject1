import type {LibraryItem} from './types';
import {bookFormat,coverPalette} from './library-world';
export function BookCover({item,onOpen,disabled}:{item:LibraryItem;onOpen:()=>void;disabled:boolean}){
 return <button className="book-cover" data-palette={coverPalette(item.id)} data-long={item.title.length>80||item.title.split(/\s+/).some(word=>word.length>11)} onClick={onOpen} disabled={disabled||item.status!=='published'} aria-label={'Открыть «'+item.title+'»'}>
  <span className="book-cover-face" aria-hidden="true">{item.favorite&&<span className="book-cover-favorite" title="В избранном">★</span>}<span className="book-cover-series">STUDYHUB · БИБЛИОТЕКА</span><span className="book-cover-title" data-title={item.title}/><svg className="book-cover-art" viewBox="0 0 200 110" fill="none"><circle cx="128" cy="52" r="48"/><circle cx="128" cy="52" r="32"/><path d="M12 92h175M12 80h85M12 68h63M12 56h42M12 44h25"/></svg><span className="book-cover-format">{bookFormat(item)}</span></span>
 </button>;
}
