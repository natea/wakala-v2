# Wakala Database Migration Runbook

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Owner:** Database Team  
**Risk Level:** High

## Table of Contents
1. [Migration Planning](#migration-planning)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Migration Procedures](#migration-procedures)
4. [Zero-Downtime Migrations](#zero-downtime-migrations)
5. [Rollback Procedures](#rollback-procedures)
6. [Troubleshooting](#troubleshooting)

## Migration Planning

### Migration Types
| Type | Risk | Downtime | Examples |
|------|------|----------|----------|
| Schema Addition | Low | None | ADD COLUMN, CREATE INDEX CONCURRENTLY |
| Schema Modification | Medium | Minimal | ALTER COLUMN, ADD CONSTRAINT |
| Schema Removal | High | None* | DROP COLUMN, DROP TABLE |
| Data Migration | Medium | None* | UPDATE large tables, COPY data |
| Major Upgrade | High | Planned | PostgreSQL version upgrade |

*With proper strategy

### Risk Assessment
```bash
# Analyze migration impact
./scripts/analyze-migration.sh \
  --file migrations/2025/001_add_analytics_tables.sql \
  --estimate-time \
  --check-locks \
  --validate-syntax
```

## Pre-Migration Checklist

### 1. Preparation Tasks
```bash
# Create migration ticket
./scripts/create-migration-ticket.sh \
  --title "Add analytics tables" \
  --reviewer "db-team" \
  --scheduled "2025-01-15 02:00 UTC"

# Review checklist
- [ ] Migration script reviewed by 2+ engineers
- [ ] Rollback script prepared and tested
- [ ] Performance impact assessed
- [ ] Backup verified and recent
- [ ] Maintenance window scheduled
- [ ] Stakeholders notified
- [ ] Monitoring alerts configured
```

### 2. Backup Verification
```bash
# Verify recent backup exists
aws rds describe-db-snapshots \
  --db-instance-identifier wakala-prod \
  --query 'DBSnapshots[0].[DBSnapshotIdentifier,SnapshotCreateTime,Status]'

# Create fresh backup
aws rds create-db-snapshot \
  --db-instance-identifier wakala-prod \
  --db-snapshot-identifier pre-migration-$(date +%Y%m%d-%H%M%S)

# Test backup restoration (on separate instance)
./scripts/test-backup-restoration.sh \
  --snapshot-id $SNAPSHOT_ID \
  --test-instance wakala-migration-test
```

### 3. Migration Validation
```bash
# Dry run on test database
psql -h test-db.wakala.com -U postgres -d wakala_test \
  -f migrations/2025/001_add_analytics_tables.sql \
  --single-transaction \
  --variable ON_ERROR_STOP=1

# Validate results
./scripts/validate-migration.sh \
  --host test-db.wakala.com \
  --database wakala_test \
  --expected-changes schema_changes.yaml
```

## Migration Procedures

### 1. Standard Migration Process
```bash
#!/bin/bash
# Standard migration execution

MIGRATION_FILE=$1
DB_HOST=${DB_HOST:-prod-db.wakala.com}
DB_NAME=${DB_NAME:-wakala}

# Pre-migration snapshot
echo "Creating pre-migration snapshot..."
pg_dump -h $DB_HOST -U postgres -d $DB_NAME \
  -f /backup/pre-migration-$(date +%Y%m%d-%H%M%S).sql

# Execute migration
echo "Executing migration..."
psql -h $DB_HOST -U postgres -d $DB_NAME \
  -f $MIGRATION_FILE \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  -c "INSERT INTO schema_migrations (version, filename, applied_at) 
      VALUES ('$(basename $MIGRATION_FILE)', '$MIGRATION_FILE', NOW());"

# Verify migration
echo "Verifying migration..."
psql -h $DB_HOST -U postgres -d $DB_NAME \
  -c "SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 1;"
```

### 2. Large Table Migrations
```sql
-- Example: Adding column to large table with minimal locking

-- Step 1: Add column without default (instant)
ALTER TABLE messages 
ADD COLUMN analytics_processed BOOLEAN;

-- Step 2: Update in batches (zero-downtime)
DO $$
DECLARE
  batch_size INTEGER := 10000;
  row_count INTEGER;
BEGIN
  LOOP
    UPDATE messages 
    SET analytics_processed = false 
    WHERE analytics_processed IS NULL 
    LIMIT batch_size;
    
    GET DIAGNOSTICS row_count = ROW_COUNT;
    EXIT WHEN row_count = 0;
    
    -- Brief pause to reduce load
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;

-- Step 3: Add constraint after data is populated
ALTER TABLE messages 
ALTER COLUMN analytics_processed SET DEFAULT false;

ALTER TABLE messages 
ALTER COLUMN analytics_processed SET NOT NULL;
```

### 3. Index Creation
```sql
-- Create index concurrently (non-blocking)
CREATE INDEX CONCURRENTLY idx_messages_tenant_created 
ON messages(tenant_id, created_at) 
WHERE deleted_at IS NULL;

-- Verify index is valid
SELECT indexrelid::regclass, indisvalid 
FROM pg_index 
WHERE indexrelid::regclass::text = 'idx_messages_tenant_created';

-- Monitor progress
SELECT 
  phase,
  blocks_total,
  blocks_done,
  blocks_total - blocks_done as blocks_remaining,
  round(100.0 * blocks_done / blocks_total, 2) as percent_done
FROM pg_stat_progress_create_index;
```

## Zero-Downtime Migrations

### 1. Expand-Contract Pattern
```sql
-- Phase 1: Expand (add new structure)
ALTER TABLE users ADD COLUMN email_new VARCHAR(255);

-- Phase 2: Migrate data (can be done gradually)
UPDATE users SET email_new = email WHERE email_new IS NULL;

-- Phase 3: Switch application to use new column
-- (Deploy application changes)

-- Phase 4: Contract (remove old structure)
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users RENAME COLUMN email_new TO email;
```

### 2. Shadow Table Strategy
```bash
# Create shadow table
psql -h $DB_HOST -U postgres -d wakala << EOF
-- Create new table structure
CREATE TABLE contacts_new (LIKE contacts INCLUDING ALL);

-- Add new columns/constraints
ALTER TABLE contacts_new ADD COLUMN metadata JSONB DEFAULT '{}';

-- Set up trigger for real-time sync
CREATE OR REPLACE FUNCTION sync_contacts_to_new() RETURNS TRIGGER AS \$\$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO contacts_new SELECT NEW.*;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE contacts_new SET 
      (phone, name, tenant_id, created_at, updated_at) = 
      (NEW.phone, NEW.name, NEW.tenant_id, NEW.created_at, NEW.updated_at)
    WHERE id = NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM contacts_new WHERE id = OLD.id;
  END IF;
  RETURN NEW;
END;
\$\$ LANGUAGE plpgsql;

CREATE TRIGGER sync_contacts_trigger
AFTER INSERT OR UPDATE OR DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION sync_contacts_to_new();
EOF

# Backfill historical data
./scripts/backfill-shadow-table.sh \
  --source contacts \
  --target contacts_new \
  --batch-size 10000

# Atomic swap
psql -h $DB_HOST -U postgres -d wakala << EOF
BEGIN;
ALTER TABLE contacts RENAME TO contacts_old;
ALTER TABLE contacts_new RENAME TO contacts;
COMMIT;
EOF
```

### 3. Blue-Green Schema Migration
```bash
# Create green schema
psql -h $DB_HOST -U postgres -d wakala << EOF
CREATE SCHEMA green;

-- Replicate structure
SELECT 'CREATE TABLE green.' || tablename || ' (LIKE public.' || tablename || ' INCLUDING ALL);'
FROM pg_tables 
WHERE schemaname = 'public'
\gexec

-- Apply migrations to green schema
\i migrations/2025/001_schema_changes.sql
EOF

# Switch application to green schema
kubectl set env deployment/wakala-api \
  DB_SCHEMA=green \
  -n production

# After validation, make green the new public
psql -h $DB_HOST -U postgres -d wakala << EOF
BEGIN;
ALTER SCHEMA public RENAME TO blue;
ALTER SCHEMA green RENAME TO public;
COMMIT;
EOF
```

## Rollback Procedures

### 1. Immediate Rollback
```bash
# If migration fails during execution
psql -h $DB_HOST -U postgres -d wakala << EOF
-- Check last successful migration
SELECT * FROM schema_migrations 
WHERE status = 'success' 
ORDER BY applied_at DESC 
LIMIT 1;

-- Execute rollback script
\i migrations/2025/001_add_analytics_tables_rollback.sql

-- Mark migration as failed
UPDATE schema_migrations 
SET status = 'failed', 
    failed_at = NOW(), 
    error_message = 'Manual rollback executed'
WHERE version = '001_add_analytics_tables';
EOF
```

### 2. Point-in-Time Recovery
```bash
# Restore to specific point before migration
RESTORE_TIME="2025-01-10 14:00:00+00"

# Create new instance from backup
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier wakala-prod \
  --target-db-instance-identifier wakala-prod-restore \
  --restore-time $RESTORE_TIME

# Verify restored data
psql -h wakala-prod-restore.xxx.rds.amazonaws.com \
  -U postgres -d wakala \
  -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"

# Switch application to restored instance
kubectl set env deployment/wakala-api \
  DB_HOST=wakala-prod-restore.xxx.rds.amazonaws.com \
  -n production
```

### 3. Schema Rollback Scripts
```sql
-- Example rollback script for table creation
-- Original migration: 001_add_analytics_tables.sql
-- This is: 001_add_analytics_tables_rollback.sql

BEGIN;

-- Drop foreign keys first
ALTER TABLE message_analytics 
DROP CONSTRAINT IF EXISTS fk_message_analytics_message;

ALTER TABLE message_analytics 
DROP CONSTRAINT IF EXISTS fk_message_analytics_tenant;

-- Drop indexes
DROP INDEX IF EXISTS idx_message_analytics_tenant_date;
DROP INDEX IF EXISTS idx_message_analytics_message;

-- Drop tables
DROP TABLE IF EXISTS message_analytics CASCADE;
DROP TABLE IF EXISTS analytics_summary CASCADE;

-- Remove migration record
DELETE FROM schema_migrations 
WHERE version = '001_add_analytics_tables';

COMMIT;
```

## Troubleshooting

### 1. Lock Detection and Resolution
```bash
# Detect blocking queries
psql -h $DB_HOST -U postgres -d wakala << EOF
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    query_start,
    state_change,
    wait_event_type,
    wait_event,
    query
FROM pg_stat_activity
WHERE pid IN (
    SELECT pid FROM pg_locks WHERE granted = false
)
OR pid IN (
    SELECT blocking_pid 
    FROM (
        SELECT 
            kl.pid as blocking_pid,
            bl.pid as blocked_pid
        FROM pg_catalog.pg_locks bl
        JOIN pg_catalog.pg_locks kl 
            ON kl.transactionid = bl.transactionid 
            AND kl.pid != bl.pid
        WHERE NOT bl.granted
    ) AS blocking
);
EOF

# Kill blocking query if necessary
psql -h $DB_HOST -U postgres -d wakala \
  -c "SELECT pg_terminate_backend($BLOCKING_PID);"
```

### 2. Migration Performance Issues
```bash
# Monitor migration progress
watch -n 5 "psql -h $DB_HOST -U postgres -d wakala -c \"
SELECT 
    query_start,
    state,
    query,
    now() - query_start as duration
FROM pg_stat_activity 
WHERE application_name = 'migration'
AND state != 'idle'
ORDER BY query_start;\""

# Check table bloat during migration
psql -h $DB_HOST -U postgres -d wakala << EOF
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    n_live_tup,
    n_dead_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_ratio
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
EOF
```

### 3. Connection Pool Issues
```bash
# Check connection usage
psql -h $DB_HOST -U postgres -d wakala -c "
SELECT 
    datname,
    usename,
    application_name,
    count(*) as connections
FROM pg_stat_activity
GROUP BY datname, usename, application_name
ORDER BY connections DESC;"

# Terminate idle connections
psql -h $DB_HOST -U postgres -d wakala -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'wakala'
AND state = 'idle'
AND state_change < CURRENT_TIMESTAMP - INTERVAL '10 minutes';"
```

## Best Practices

### 1. Migration Standards
```sql
-- Always include in migrations:

-- Header comment
-- Migration: 001_add_analytics_tables
-- Author: team@wakala.com
-- Date: 2025-01-10
-- Description: Add tables for message analytics

-- Transaction wrapper
BEGIN;

-- Version check
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schema_migrations 
    WHERE version = '001_add_analytics_tables'
  ) THEN
    RAISE EXCEPTION 'Migration already applied';
  END IF;
END $$;

-- Migration logic here
CREATE TABLE ...

-- Record migration
INSERT INTO schema_migrations (version, filename, checksum, applied_at)
VALUES (
  '001_add_analytics_tables',
  '2025/001_add_analytics_tables.sql',
  md5(pg_read_file('2025/001_add_analytics_tables.sql')),
  NOW()
);

COMMIT;
```

### 2. Testing Protocol
```bash
# Always test on:
1. Local development database
2. Staging environment (full data copy)
3. Migration-specific test instance
4. Performance test with production data volume

# Automated tests
./scripts/test-migration.sh \
  --migration-file $MIGRATION \
  --test-rollback \
  --test-performance \
  --test-concurrent-access
```

### 3. Documentation Requirements
```yaml
# migration-metadata.yaml
version: "001_add_analytics_tables"
description: "Add tables for message analytics feature"
author: "database-team@wakala.com"
reviewed_by: ["senior-dba@wakala.com", "architect@wakala.com"]
risk_level: "medium"
estimated_duration: "5 minutes"
requires_downtime: false
rollback_available: true
testing:
  - unit_tests: true
  - integration_tests: true
  - performance_tests: true
  - production_like_test: true
dependencies:
  - "000_initial_schema"
notes: |
  - Creates two new tables for analytics
  - Adds foreign key constraints
  - Creates indexes for query optimization
```

## Migration Calendar

| Date | Migration | Type | Risk | Owner |
|------|-----------|------|------|-------|
| 2025-01-15 | Add analytics tables | Schema | Medium | DB Team |
| 2025-01-22 | Partition messages table | Data | High | Senior DBA |
| 2025-02-01 | Add JSONB columns | Schema | Low | DB Team |
| 2025-02-15 | PostgreSQL 15 upgrade | Major | High | All Teams |

## Emergency Contacts

- Database Team Lead: +1-555-DB-LEAD
- Senior DBA: +1-555-SR-DBA
- On-Call DBA: +1-555-ONCALL-DB
- Vendor Support: support@postgresql.com

---

**Critical:** Never execute migrations without proper review and testing. When in doubt, postpone and seek additional review.