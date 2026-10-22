-- Owner-selected coding for future payroll lines. Posted payrolls never change.
CREATE TABLE pt_payroll_dimensions(role TEXT PRIMARY KEY CHECK(role IN('wages','taxes','benefits','reimbursements','bank','liabilities')),class_name TEXT NOT NULL DEFAULT '',location_name TEXT NOT NULL DEFAULT '',project_name TEXT NOT NULL DEFAULT '',revision TEXT NOT NULL);
