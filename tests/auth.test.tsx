import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:5204/?demo=1'});
for(const key of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','MutationObserver','DOMParser','FormData'])Object.defineProperty(globalThis,key,{value:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,screen,cleanup,waitFor,fireEvent,within}=await import('@testing-library/react');
const {AuthPanel}=await import('../src/AuthPanel');
const {demoGateway,resetDemo,selectDemo}=await import('../src/demo');
test.afterEach(()=>cleanup());
test('login has only email and password and forwards credentials without group',async()=>{
 const calls:unknown[]=[];render(React.createElement(AuthPanel,{api:{...demoGateway,demo:false,login:async(...args:unknown[])=>{calls.push(args);}},groups:[{id:'g0',name:'Group'}],invite:false,onDone:async()=>{calls.push('done');},onDemo:()=>{}}));
 assert.equal(screen.queryByRole('combobox'),null);assert.equal(screen.queryByLabelText('Имя и фамилия'),null);
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'student@example.test'}});fireEvent.change(screen.getByLabelText('Пароль'),{target:{value:'existing'}});fireEvent.click(screen.getByRole('button',{name:'Войти',exact:true}));await waitFor(()=>assert.equal(calls.length,2));assert.deepEqual(calls[0],['student@example.test','existing']);
});
test('confirmed email registration shows pending verification; invitation suppresses group selection',async()=>{
 const calls:unknown[][]=[];render(React.createElement(AuthPanel,{api:{...demoGateway,demo:false,signup:async(...args:unknown[])=>{calls.push(args);},session:async()=>false},groups:[{id:'g0',name:'Group'}],invite:true,onDone:async()=>{throw Error('Unverified login');},onDemo:()=>{}}));fireEvent.click(screen.getByRole('button',{name:'Создать аккаунт',exact:true}));assert.equal(screen.queryByRole('combobox'),null);
 for(const [label,value] of [['Имя и фамилия','Name'],['Email','student@example.test'],['Пароль','password123'],['Повторите пароль','wrongpassword']])fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'Зарегистрироваться'}));await screen.findByText('Пароли не совпадают.');assert.equal(calls.length,0);fireEvent.change(screen.getByLabelText('Повторите пароль'),{target:{value:'password123'}});fireEvent.click(screen.getByRole('button',{name:'Зарегистрироваться'}));await screen.findByText(/Проверьте почту и подтвердите регистрацию/);assert.equal(calls[0][3],null);
});
test('password recovery only sends email and offers a private generic response',async()=>{
 const calls:string[]=[];render(React.createElement(AuthPanel,{api:{...demoGateway,demo:false,resetPassword:async(email:string)=>{calls.push(email);}},groups:[],invite:false,onDone:async()=>{},onDemo:()=>{}}));fireEvent.click(screen.getByRole('button',{name:'Забыли пароль?'}));assert.equal(screen.queryByLabelText('Пароль'),null);fireEvent.change(screen.getByLabelText('Email'),{target:{value:'student@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Отправить письмо'}));await screen.findByText(/Если аккаунт с такой почтой существует/);assert.deepEqual(calls,['student@example.test']);
});
test('demo request gives no rights until leader approval and other students cannot approve',async()=>{
 resetDemo();await demoGateway.signup('New student','test@example.test','password123','g0');const s=await demoGateway.snapshot(),id=s.me.id;assert.equal(s.groups.length,0);assert.equal((await demoGateway.library('',0)).canRead,true);await assert.rejects(()=>demoGateway.resolveGroupRequest(id,'g0',true));selectDemo('teacher');await assert.rejects(()=>demoGateway.groupRequests('g0',0));selectDemo('leader');await demoGateway.resolveGroupRequest(id,'g0',true);selectDemo(id);assert.equal((await demoGateway.snapshot()).memberships.some(m=>m.user_id===id&&m.role==='student'&&m.active),true);
});

test('a pending request can be cancelled without creating membership',async()=>{resetDemo();await demoGateway.signup('Pending','p@example.test','password123','g0');assert.equal((await demoGateway.groupRequests(null,0)).length,1);await demoGateway.cancelGroupRequest();assert.equal((await demoGateway.groupRequests(null,0))[0].status,'cancelled');assert.equal((await demoGateway.snapshot()).groups.length,0);await demoGateway.joinGroup('g1');assert.equal((await demoGateway.groupRequests(null,0))[0].group_id,'g1');});
