exports.up = pgm => {
 for(const table of ['accounts','employees','attendance','wage_history','period_history','audits','sessions','request_records'])pgm.createTable(table,{id:{type:'text',primaryKey:true},payload:{type:'jsonb',notNull:true}});
 pgm.sql(`
 ALTER TABLE accounts ADD COLUMN username text GENERATED ALWAYS AS (payload->>'username') STORED UNIQUE;
 ALTER TABLE accounts ADD COLUMN employee_id text GENERATED ALWAYS AS (payload->>'employeeId') STORED REFERENCES employees(id) DEFERRABLE INITIALLY DEFERRED;
 ALTER TABLE accounts ADD CONSTRAINT account_role CHECK (payload->>'role' IN ('owner','employee'));
 ALTER TABLE employees ADD CONSTRAINT employee_pay_type CHECK (payload->>'payType' IN ('hourly','monthly'));
 ALTER TABLE attendance ADD COLUMN employee_id text GENERATED ALWAYS AS (payload->>'employeeId') STORED REFERENCES employees(id);
 ALTER TABLE attendance ADD COLUMN work_date text GENERATED ALWAYS AS (payload->>'workDate') STORED;
 ALTER TABLE attendance ADD CONSTRAINT attendance_unique_day UNIQUE(employee_id,work_date);
 ALTER TABLE attendance ADD CONSTRAINT deduction_nonnegative CHECK ((payload->>'deductionMinutes')::numeric >= 0);
 ALTER TABLE attendance ADD CONSTRAINT checkout_after_checkin CHECK (payload->>'clockOut' IS NULL OR payload->>'clockOut' >= payload->>'clockIn');
 CREATE UNIQUE INDEX one_open_attendance ON attendance(employee_id) WHERE payload->>'clockOut' IS NULL;
 CREATE INDEX attendance_date_idx ON attendance(work_date);
 ALTER TABLE wage_history ADD COLUMN employee_id text GENERATED ALWAYS AS (payload->>'employeeId') STORED REFERENCES employees(id);
 ALTER TABLE wage_history ADD CONSTRAINT wage_positive CHECK ((payload->>'amount')::numeric > 0);
 CREATE UNIQUE INDEX wage_effective_unique ON wage_history(employee_id,(payload->>'effectiveDate'));
 ALTER TABLE period_history ADD COLUMN employee_id text GENERATED ALWAYS AS (payload->>'employeeId') STORED REFERENCES employees(id);
 ALTER TABLE period_history ADD CONSTRAINT period_day CHECK ((payload->>'startDay')::int BETWEEN 1 AND 31);
 CREATE UNIQUE INDEX period_effective_unique ON period_history(employee_id,(payload->>'effectiveDate'));
 ALTER TABLE sessions ADD COLUMN account_id text GENERATED ALWAYS AS (payload->>'accountId') STORED REFERENCES accounts(id);
 CREATE INDEX session_expiry_idx ON sessions((payload->>'expiresAt'));
 ALTER TABLE request_records ADD COLUMN account_id text GENERATED ALWAYS AS (payload->>'accountId') STORED REFERENCES accounts(id);
 CREATE INDEX audit_employee_idx ON audits((payload->>'employeeId'));
 `);
};
exports.down = pgm => { for(const table of ['request_records','sessions','audits','period_history','wage_history','attendance','accounts','employees'])pgm.dropTable(table); };
