# Wakala Disaster Recovery Runbook

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Owner:** Infrastructure Team  
**RTO:** 4 hours | **RPO:** 1 hour

## Table of Contents
1. [Disaster Scenarios](#disaster-scenarios)
2. [Recovery Procedures](#recovery-procedures)
3. [Data Recovery](#data-recovery)
4. [Service Restoration](#service-restoration)
5. [Communication Plan](#communication-plan)
6. [Testing Schedule](#testing-schedule)

## Disaster Scenarios

### Scenario Classification
| Scenario | Impact | RTO | RPO | Priority |
|----------|--------|-----|-----|----------|
| Region Failure | Critical | 4h | 1h | P0 |
| Database Corruption | Critical | 2h | 15m | P0 |
| Ransomware Attack | Critical | 8h | 1h | P0 |
| Data Center Fire | Critical | 4h | 1h | P0 |
| DDoS Attack | High | 30m | 0m | P1 |
| Service Outage | Medium | 1h | 0m | P2 |

## Recovery Procedures

### 1. Initial Response (0-15 minutes)

#### Activate Incident Response
```bash
# Send emergency notification
./scripts/emergency-alert.sh \
  --severity DISASTER \
  --type "$DISASTER_TYPE" \
  --notify-all

# Activate war room
echo "War Room: https://meet.wakala.com/disaster-recovery"
echo "Slack: #disaster-recovery"
echo "Status Page: https://status.wakala.com"
```

#### Assess Situation
```bash
# Check service status across regions
for region in us-east-1 eu-west-1 ap-southeast-1; do
  echo "Checking $region..."
  aws cloudwatch get-metric-statistics \
    --namespace AWS/ECS \
    --metric-name HealthyHostCount \
    --dimensions Name=ServiceName,Value=wakala \
    --statistics Average \
    --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 60 \
    --region $region
done

# Check database status
./scripts/check-database-health.sh --all-regions
```

### 2. Region Failure Recovery

#### Prerequisites
- [ ] Confirm primary region is down
- [ ] Verify DR region is operational
- [ ] Check data replication lag

#### Failover Steps
```bash
# Step 1: Update DNS to point to DR region
aws route53 change-resource-record-sets \
  --hosted-zone-id Z2FDTNDATAQYW2 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.wakala.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z2FDTNDATAQYW2",
          "DNSName": "dr-alb.eu-west-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'

# Step 2: Promote DR database to primary
aws rds promote-read-replica \
  --db-instance-identifier wakala-dr-instance \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00"

# Step 3: Scale up DR region services
kubectl scale deployment wakala-api \
  --replicas=20 \
  --context=dr-cluster

# Step 4: Update configuration for DR mode
kubectl set env deployment/wakala-api \
  DISASTER_RECOVERY_MODE=true \
  PRIMARY_REGION=eu-west-1 \
  --context=dr-cluster
```

#### Verify Failover
```bash
# Test API endpoints
curl -f https://api.wakala.com/health || exit 1

# Check database connectivity
psql -h dr-db.wakala.com -U postgres -d wakala \
  -c "SELECT COUNT(*) FROM tenants WHERE active = true;"

# Monitor error rates
./scripts/monitor-dr-metrics.sh --duration 30m
```

### 3. Database Recovery

#### From Backup
```bash
# List available backups
aws rds describe-db-snapshots \
  --db-instance-identifier wakala-prod \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime]' \
  --output table

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier wakala-prod-restored \
  --db-snapshot-identifier $SNAPSHOT_ID \
  --db-instance-class db.r5.2xlarge \
  --multi-az

# Wait for restoration
aws rds wait db-instance-available \
  --db-instance-identifier wakala-prod-restored
```

#### From Point-in-Time
```bash
# Restore to specific time
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier wakala-prod \
  --target-db-instance-identifier wakala-prod-pitr \
  --restore-time "2025-01-10T12:00:00.000Z" \
  --db-instance-class db.r5.2xlarge
```

#### Data Validation
```bash
# Verify data integrity
psql -h wakala-prod-restored.xxxxx.rds.amazonaws.com \
  -U postgres -d wakala << EOF
-- Check row counts
SELECT 'tenants' as table_name, COUNT(*) as row_count FROM tenants
UNION ALL
SELECT 'messages', COUNT(*) FROM messages
UNION ALL
SELECT 'contacts', COUNT(*) FROM contacts;

-- Verify latest transactions
SELECT MAX(created_at) as latest_transaction FROM messages;

-- Check for corruption
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
EOF
```

### 4. Ransomware Recovery

#### Immediate Actions
```bash
# Isolate affected systems
./scripts/network-isolation.sh --emergency

# Disable all external access
aws ec2 revoke-security-group-ingress \
  --group-id sg-xxxxxx \
  --ip-permissions '[{"IpProtocol": "-1", "IpRanges": [{"CidrIp": "0.0.0.0/0"}]}]'

# Snapshot all volumes for forensics
for volume in $(aws ec2 describe-volumes --query 'Volumes[*].VolumeId' --output text); do
  aws ec2 create-snapshot \
    --volume-id $volume \
    --description "Ransomware forensics - $(date +%Y%m%d-%H%M%S)"
done
```

#### Clean Recovery
```bash
# Deploy from clean backup
terraform init -backend-config=backend-dr.conf
terraform apply -var-file=disaster-recovery.tfvars -auto-approve

# Restore data from immutable backups
aws s3 sync s3://wakala-immutable-backups/latest/ /restore/

# Rebuild from source
git clone https://github.com/wakala/infrastructure.git
cd infrastructure
./deploy.sh --environment dr --clean-build
```

### 5. Service Restoration

#### Kubernetes Cluster Recovery
```bash
# Restore etcd from backup
ETCDCTL_API=3 etcdctl snapshot restore \
  /backup/etcd-snapshot-latest.db \
  --name m1 \
  --initial-cluster m1=http://10.0.0.1:2380,m2=http://10.0.0.2:2380,m3=http://10.0.0.3:2380 \
  --initial-cluster-token etcd-cluster-1 \
  --initial-advertise-peer-urls http://10.0.0.1:2380

# Restore Kubernetes state
kubectl apply -f /backup/cluster-state/

# Verify all pods are running
kubectl get pods --all-namespaces | grep -v Running
```

#### Application Stack Recovery
```bash
# Deploy core services
helm install wakala-core ./helm/core \
  --namespace production \
  --values ./helm/values/dr-recovery.yaml

# Deploy application services
helm install wakala-app ./helm/app \
  --namespace production \
  --values ./helm/values/dr-recovery.yaml \
  --set recovery.mode=true

# Restore configurations
kubectl apply -f /backup/configmaps/
kubectl apply -f /backup/secrets/
```

## Data Recovery

### Backup Locations
```yaml
backups:
  primary:
    database: s3://wakala-backups/postgres/
    files: s3://wakala-backups/files/
    configs: s3://wakala-backups/configs/
  secondary:
    database: gs://wakala-dr-backups/postgres/
    files: gs://wakala-dr-backups/files/
    configs: gs://wakala-dr-backups/configs/
  immutable:
    vault: s3://wakala-immutable/
    glacier: glacier://wakala-archive/
```

### Recovery Priority
1. **Critical Data** (RPO: 15 minutes)
   - User authentication data
   - Tenant configurations
   - Active message queues

2. **Important Data** (RPO: 1 hour)
   - Message history
   - Contact lists
   - Media files

3. **Standard Data** (RPO: 24 hours)
   - Analytics data
   - Audit logs
   - Archived messages

### Recovery Procedures
```bash
# Restore critical data first
./scripts/restore-critical-data.sh \
  --source s3://wakala-backups/critical/ \
  --target /restore/critical/ \
  --parallel 10

# Restore important data
./scripts/restore-important-data.sh \
  --source s3://wakala-backups/important/ \
  --target /restore/important/ \
  --parallel 5

# Restore standard data (background)
nohup ./scripts/restore-standard-data.sh \
  --source s3://wakala-backups/standard/ \
  --target /restore/standard/ &
```

## Communication Plan

### Internal Communication
```bash
# Automated status updates every 30 minutes
while true; do
  ./scripts/dr-status-update.sh \
    --channel "#disaster-recovery" \
    --include-metrics \
    --include-timeline
  sleep 1800
done
```

### Customer Communication

#### Initial Notification (T+15 minutes)
```
Subject: Service Disruption - We're Working on It

Dear Customer,

We are currently experiencing a service disruption affecting Wakala services. 
Our team is actively working on restoration.

Current Status: Investigating
Estimated Resolution: Updates within 2 hours

Status Page: https://status.wakala.com
```

#### Progress Updates (Every 30 minutes)
```
Subject: Service Restoration Update

Progress Update:
- Primary services: [STATUS]
- Data integrity: [STATUS]
- Estimated completion: [TIME]

What's Working:
- [List of functional services]

What's Not Working:
- [List of affected services]

Next Update: In 30 minutes
```

#### Resolution Notice
```
Subject: Service Restored - Post-Incident Report Coming

Dear Customer,

Wakala services have been fully restored. We apologize for any inconvenience.

Incident Duration: [START] - [END]
Services Affected: [LIST]
Data Loss: None / [DETAILS]

A detailed post-incident report will be shared within 48 hours.

Thank you for your patience.
```

## Testing Schedule

### Monthly Tests
- [ ] Backup restoration (1 random backup)
- [ ] Failover simulation (1 service)
- [ ] Communication drill
- [ ] Access verification

### Quarterly Tests
- [ ] Full region failover
- [ ] Database recovery
- [ ] Application rebuild
- [ ] Security incident response

### Annual Tests
- [ ] Complete disaster simulation
- [ ] Multi-region failure
- [ ] Extended outage (8+ hours)
- [ ] Third-party coordination

### Test Execution
```bash
# Run DR test
./scripts/dr-test.sh \
  --scenario "region-failure" \
  --duration "4h" \
  --notify-team \
  --generate-report

# Validate results
./scripts/validate-dr-test.sh \
  --check data-integrity \
  --check service-availability \
  --check performance-metrics
```

## Recovery Checklist

### Pre-Recovery
- [ ] Incident commander assigned
- [ ] War room activated
- [ ] Communication started
- [ ] Impact assessed
- [ ] Recovery strategy selected

### During Recovery
- [ ] Backups verified
- [ ] Services isolated
- [ ] Data restored
- [ ] Services deployed
- [ ] Configuration applied
- [ ] Health checks passed

### Post-Recovery
- [ ] Full functionality verified
- [ ] Performance validated
- [ ] Data integrity confirmed
- [ ] Monitoring restored
- [ ] Documentation updated
- [ ] Post-incident review scheduled

## Appendices

### A. Contact Information
```yaml
contacts:
  incident_commander: "+1-555-0100"
  infrastructure_lead: "+1-555-0101"
  database_admin: "+1-555-0102"
  security_lead: "+1-555-0103"
  communications: "+1-555-0104"
  
external:
  aws_support: "https://console.aws.amazon.com/support/"
  azure_support: "https://portal.azure.com/#blade/Microsoft_Azure_Support/HelpAndSupportBlade"
  cloudflare: "+1-650-319-8930"
```

### B. Critical Commands Reference
```bash
# Quick reference for critical commands
alias dr-status='kubectl get all -n production'
alias dr-logs='kubectl logs -n production -f'
alias dr-database='psql -h $DR_DB_HOST -U postgres -d wakala'
alias dr-failover='./scripts/initiate-failover.sh'
alias dr-rollback='./scripts/rollback-failover.sh'
```

### C. Recovery Metrics
```yaml
metrics:
  rto_target: 4h
  rpo_target: 1h
  max_data_loss: 1h
  service_availability: 99.9%
  recovery_success_rate: 100%
  test_frequency: monthly
  last_test: "2024-12-15"
  last_incident: "None"
```

---

**Critical:** This runbook must be reviewed and tested monthly. Any changes require approval from the CTO and Infrastructure Lead.