import {transaction,isDemo} from '../src/lib/store';
import {sampleStore} from '../src/lib/sample';
if(!isDemo()&&process.env.ALLOW_SAMPLE_SEED!=='true')throw new Error('Set ALLOW_SAMPLE_SEED=true for a development database');
async function main(){await transaction(store=>{if(store.accounts.length)throw new Error('Refusing to seed a non-empty database');Object.assign(store,sampleStore());},{initializeDemo:false});
console.log('Sample seed complete: owner / employee, password demo1234. Change sample passwords before deployment.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
