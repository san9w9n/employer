import {runner} from 'node-pg-migrate';
const direction=process.argv[2];if(!['up','down'].includes(direction))throw new Error('Use up or down');
const databaseUrl=process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL;if(!databaseUrl)throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL required');
const connection={connectionString:databaseUrl,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true,ca:process.env.DATABASE_SSL_CA?.replace(/\\n/g,'\n')}:undefined};
await runner({databaseUrl:connection,dir:'migrations',direction,count:direction==='down'?1:Infinity,migrationsTable:'pgmigrations',checkOrder:true});
