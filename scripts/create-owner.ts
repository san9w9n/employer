import {randomUUID} from 'node:crypto';
import {hashPassword} from '../src/lib/password';
import {transaction,isDemo} from '../src/lib/store';
import {DEFAULT_STORE,storeIdOf} from '../src/lib/service';

async function main() {
 if(isDemo())throw new Error('Owner bootstrap requires PostgreSQL; unset DEMO_MODE.');
 const username=process.env.OWNER_USERNAME?.trim();
 const name=process.env.OWNER_NAME?.trim()||'사장님';
 const storeName=process.env.OWNER_STORE_NAME?.trim();
 const password=process.env.OWNER_PASSWORD;
 if(!username||!/^[a-zA-Z0-9_.-]{3,60}$/.test(username))throw new Error('OWNER_USERNAME must contain 3–60 letters, digits, dots, underscores or hyphens.');
 if(!password||password.length<12||password.length>200||password!==password.trim())throw new Error('OWNER_PASSWORD must be 12–200 characters without leading/trailing whitespace.');
 if(name.length>60)throw new Error('OWNER_NAME must be at most 60 characters.');
 if(!storeName||storeName.length>60)throw new Error('OWNER_STORE_NAME is required (at most 60 characters). Each owner runs a separate store.');
 const passwordHash=hashPassword(password);
 await transaction(store=>{
  if(store.accounts.some(account=>account.username===username))throw new Error('That username is already in use.');
  const owners=store.accounts.filter(account=>account.role==='owner');
  const names=owners.map(owner=>owner.storeName??(storeIdOf(owner)===DEFAULT_STORE.id?DEFAULT_STORE.name:''));
  if(names.includes(storeName))throw new Error('A store with that name already exists.');
  const id=randomUUID(),storeId=randomUUID();
  store.accounts.push({id,username,name,role:'owner',employeeId:null,passwordHash,storeId,storeName});
  store.audits.push({id:randomUUID(),storeId,employeeId:null,targetId:id,actorId:id,actorName:name,at:new Date().toISOString(),reason:'매장 사장님 계정 생성',before:null,after:{role:'owner',username,name,storeName}});
 });
 console.log(`Owner created for ${storeName}. No password was printed or stored in audit records.`);
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Owner bootstrap failed');process.exitCode=1;});
