exports.up = pgm => {
 pgm.dropConstraint('attendance','attendance_unique_day');
};

// PostgreSQL rejects rollback if multiple shifts already share a work date.
// Keep those records intact instead of deleting or merging attendance history.
exports.down = pgm => {
 pgm.addConstraint('attendance','attendance_unique_day',{unique:['employee_id','work_date']});
};
