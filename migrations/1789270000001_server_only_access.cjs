const tables=['accounts','employees','attendance','wage_history','period_history','audits','sessions','request_records','pgmigrations'];

exports.up=pgm=>{
 for(const table of tables){
  pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.${table} FROM PUBLIC;`);
  for(const role of ['anon','authenticated','service_role']){
   pgm.sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN REVOKE ALL ON TABLE public.${table} FROM ${role}; END IF; END $$;`);
  }
 }
};

exports.down=pgm=>{
 // A rollback must never restore public access to payroll or credentials.
 for(const table of tables)pgm.sql(`ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY;`);
};
