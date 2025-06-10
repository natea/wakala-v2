# Wakala Incident Response Playbook

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Owner:** Operations Team  
**24/7 Hotline:** +1-555-INCIDENT

## Table of Contents
1. [Incident Classification](#incident-classification)
2. [Response Procedures](#response-procedures)
3. [Communication Templates](#communication-templates)
4. [Escalation Matrix](#escalation-matrix)
5. [Common Incident Playbooks](#common-incident-playbooks)
6. [Post-Incident Process](#post-incident-process)

## Incident Classification

### Severity Levels
| Level | Response Time | Impact | Examples |
|-------|--------------|--------|----------|
| **P1 - Critical** | 15 min | Complete outage or data loss | API down, database corruption, security breach |
| **P2 - High** | 30 min | Major feature unavailable | WhatsApp integration down, payment failure |
| **P3 - Medium** | 2 hours | Minor feature degraded | Slow webhooks, reporting delays |
| **P4 - Low** | 24 hours | Minimal impact | UI glitch, non-critical bug |

### Incident Types
```yaml
incident_types:
  - service_outage:
      severity: P1
      team: infrastructure
      escalation: immediate
  
  - data_breach:
      severity: P1
      team: security
      escalation: immediate
      notify: legal, ciso
  
  - performance_degradation:
      severity: P2-P3
      team: engineering
      escalation: 30_minutes
  
  - integration_failure:
      severity: P2
      team: integrations
      escalation: 30_minutes
```

## Response Procedures

### 1. Initial Response (0-5 minutes)

#### Acknowledge Incident
```bash
# Acknowledge alert
./scripts/incident-ack.sh \
  --incident-id "$INCIDENT_ID" \
  --responder "$YOUR_NAME" \
  --severity "$SEVERITY"

# Create incident channel
slack-cli create-channel \
  --name "incident-$(date +%Y%m%d-%H%M)" \
  --purpose "Incident response coordination" \
  --invite @oncall @engineering
```

#### Initial Assessment
```bash
# Quick health check
./scripts/system-health.sh --quick

# Check affected services
for service in api worker websocket database cache; do
  echo "Checking $service..."
  kubectl get pods -n production -l app=wakala-$service
  curl -f https://wakala.com/$service/health || echo "FAILED: $service"
done

# Recent changes check
kubectl rollout history deployment -n production
git log --oneline -10
```

### 2. Incident Commander Assignment (5-10 minutes)

#### Roles and Responsibilities
```markdown
**Incident Commander (IC)**
- Overall incident coordination
- Decision making authority
- External communication

**Technical Lead**
- Technical investigation
- Solution implementation
- Resource coordination

**Communications Lead**
- Customer updates
- Internal updates
- Status page management

**Subject Matter Expert (SME)**
- Domain-specific expertise
- Technical guidance
- Impact assessment
```

#### Command Structure Setup
```bash
# Assign roles
./scripts/incident-roles.sh \
  --commander "Jane Doe" \
  --tech-lead "John Smith" \
  --comms "Sarah Johnson" \
  --sme "Mike Wilson"

# Start incident log
cat > /tmp/incident-$INCIDENT_ID.log << EOF
Incident ID: $INCIDENT_ID
Started: $(date)
Severity: $SEVERITY
Commander: $COMMANDER
Tech Lead: $TECH_LEAD

Timeline:
$(date +"%H:%M:%S") - Incident detected
$(date +"%H:%M:%S") - Incident acknowledged by $RESPONDER
$(date +"%H:%M:%S") - Incident commander assigned
EOF
```

### 3. Investigation (10-30 minutes)

#### Data Collection
```bash
# Collect comprehensive logs
./scripts/collect-incident-data.sh \
  --incident-id "$INCIDENT_ID" \
  --time-range "1 hour ago" \
  --services "all" \
  --output "/tmp/incident-$INCIDENT_ID/"

# System metrics snapshot
kubectl top nodes > /tmp/incident-$INCIDENT_ID/nodes.txt
kubectl top pods -n production > /tmp/incident-$INCIDENT_ID/pods.txt
kubectl get events -n production --sort-by='.lastTimestamp' \
  > /tmp/incident-$INCIDENT_ID/events.txt

# Database diagnostics
psql -h $DB_HOST -U postgres -d wakala << EOF > /tmp/incident-$INCIDENT_ID/db-diag.txt
SELECT 
  datname,
  count(*) as connections,
  count(*) filter (where state = 'active') as active,
  count(*) filter (where state = 'idle') as idle,
  count(*) filter (where state = 'idle in transaction') as idle_in_transaction,
  count(*) filter (where wait_event_type = 'Lock') as waiting
FROM pg_stat_activity
GROUP BY datname;

SELECT 
  query,
  state,
  wait_event_type,
  wait_event,
  age(clock_timestamp(), query_start) as duration
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC
LIMIT 10;
EOF
```

#### Root Cause Analysis
```bash
# Timeline reconstruction
grep ERROR /var/log/wakala/* | sort -k1,2 > /tmp/error-timeline.log

# Correlation analysis
./scripts/correlate-events.sh \
  --start-time "$INCIDENT_START" \
  --metrics "errors,latency,throughput" \
  --services "all"

# Change correlation
git log --since="2 hours ago" --oneline
kubectl rollout history deployment -n production --revision=0
```

### 4. Mitigation (Variable)

#### Quick Mitigation Actions
```bash
# Rollback deployment
kubectl rollout undo deployment/wakala-api -n production

# Scale up resources
kubectl scale deployment/wakala-api -n production --replicas=30

# Enable circuit breaker
kubectl set env deployment/wakala-api -n production \
  CIRCUIT_BREAKER_ENABLED=true \
  CIRCUIT_BREAKER_THRESHOLD=10

# Redirect traffic
kubectl patch service wakala -n production \
  -p '{"spec":{"selector":{"version":"stable"}}}'
```

#### Service-Specific Mitigations
```bash
# Database overload
psql -h $DB_HOST -U postgres -d wakala -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
AND query_start < now() - interval '5 minutes'
AND query NOT LIKE '%pg_stat_activity%';"

# Cache issues
redis-cli -h redis-master FLUSHALL

# Queue backup
kubectl scale deployment wakala-worker -n production --replicas=50
```

## Communication Templates

### Customer Communication

#### Initial Notification
```markdown
Subject: Service Disruption - We're Investigating

Dear Customers,

We are currently experiencing issues with [AFFECTED SERVICE]. Our team is actively investigating and working to resolve the issue.

**Current Status:** Investigating
**Services Affected:** [LIST]
**Impact:** [DESCRIPTION]

We will provide updates every 30 minutes or as soon as we have more information.

Status Page: https://status.wakala.com
```

#### Progress Update
```markdown
Subject: Service Disruption Update - Progress Report

Dear Customers,

Update on the ongoing service disruption:

**Current Status:** Identified / Implementing Fix
**Root Cause:** [BRIEF DESCRIPTION]
**Progress:** [WHAT'S BEEN DONE]
**ETA:** [ESTIMATED RESOLUTION TIME]

**What's Working:**
- [Functional services]

**What's Not Working:**
- [Affected services]

Next update in 30 minutes.
```

#### Resolution Notice
```markdown
Subject: Service Restored - Incident Resolved

Dear Customers,

We're pleased to report that the service disruption has been resolved. All systems are now operating normally.

**Duration:** [START] - [END]
**Root Cause:** [BRIEF EXPLANATION]
**Resolution:** [WHAT WAS DONE]
**Prevention:** [FUTURE MEASURES]

We apologize for any inconvenience caused. A detailed post-mortem will be published within 48 hours.

Thank you for your patience and understanding.
```

### Internal Communication

#### Slack Templates
```bash
# Incident start
@here 🚨 P$SEVERITY Incident Detected
Service: $SERVICE
Impact: $IMPACT
Incident Channel: #incident-$INCIDENT_ID
IC: @$COMMANDER

# Status update
📊 Incident Update ($TIME)
Status: $STATUS
Progress: $PROGRESS
Next Steps: $NEXT_STEPS
ETA: $ETA

# Resolution
✅ Incident Resolved
Duration: $DURATION
Root Cause: $ROOT_CAUSE
Customer Impact: $IMPACT
Post-mortem scheduled: $DATE
```

## Escalation Matrix

### Escalation Triggers
| Condition | Action | Contact |
|-----------|--------|---------|
| P1 unresolved > 30 min | Escalate to VP Engineering | vp-eng@wakala.com |
| P1 unresolved > 1 hour | Escalate to CTO | cto@wakala.com |
| Data breach suspected | Immediate CISO + Legal | security@wakala.com |
| Customer data loss | Immediate CEO + Legal | executive@wakala.com |
| Media attention | PR Team activation | pr@wakala.com |

### On-Call Rotation
```yaml
on_call_schedule:
  primary:
    current: john.doe@wakala.com
    phone: +1-555-0001
    backup: jane.smith@wakala.com
  
  secondary:
    current: mike.wilson@wakala.com
    phone: +1-555-0002
    backup: sarah.jones@wakala.com
  
  management:
    engineering_manager: em@wakala.com
    vp_engineering: vp-eng@wakala.com
    cto: cto@wakala.com
```

## Common Incident Playbooks

### 1. API Outage
```bash
#!/bin/bash
# api-outage-playbook.sh

echo "🚨 API Outage Response Started"

# 1. Verify outage
if ! curl -f https://api.wakala.com/health; then
  echo "✅ Confirmed: API is down"
else
  echo "❌ False alarm: API is responding"
  exit 0
fi

# 2. Check pod status
kubectl get pods -n production -l app=wakala-api

# 3. Check recent events
kubectl get events -n production --sort-by='.lastTimestamp' | head -20

# 4. Quick rollback if recent deployment
LAST_DEPLOY=$(kubectl rollout history deployment/wakala-api -n production | tail -2 | head -1 | awk '{print $1}')
if [ $(( $(date +%s) - $(kubectl get deployment wakala-api -n production -o jsonpath='{.metadata.creationTimestamp}' | xargs date +%s -d) )) -lt 3600 ]; then
  echo "Recent deployment detected, rolling back..."
  kubectl rollout undo deployment/wakala-api -n production
fi

# 5. Scale up if pods are crashing
RESTARTS=$(kubectl get pods -n production -l app=wakala-api -o jsonpath='{.items[*].status.containerStatuses[*].restartCount}' | tr ' ' '\n' | sort -nr | head -1)
if [ $RESTARTS -gt 5 ]; then
  echo "High restart count detected, scaling up..."
  kubectl scale deployment wakala-api -n production --replicas=20
fi

# 6. Enable maintenance mode
kubectl set env deployment/wakala-api -n production MAINTENANCE_MODE=true
```

### 2. Database Outage
```bash
#!/bin/bash
# database-outage-playbook.sh

echo "🚨 Database Outage Response Started"

# 1. Check database connectivity
if ! pg_isready -h $DB_HOST -p 5432; then
  echo "✅ Confirmed: Database is not responding"
  
  # 2. Check AWS RDS status
  aws rds describe-db-instances \
    --db-instance-identifier wakala-prod \
    --query 'DBInstances[0].DBInstanceStatus'
  
  # 3. Attempt failover to replica
  echo "Initiating failover to read replica..."
  aws rds promote-read-replica \
    --db-instance-identifier wakala-prod-replica-1
  
  # 4. Update connection strings
  kubectl set env deployment/wakala-api -n production \
    DB_HOST=wakala-prod-replica-1.xxx.rds.amazonaws.com
else
  # Database is up, check performance
  psql -h $DB_HOST -U postgres -d wakala -c "
    SELECT 
      count(*) as total_connections,
      count(*) filter (where state = 'active') as active_queries,
      count(*) filter (where wait_event_type = 'Lock') as blocked_queries
    FROM pg_stat_activity;"
fi
```

### 3. Security Incident
```bash
#!/bin/bash
# security-incident-playbook.sh

echo "🔒 Security Incident Response Started"
echo "⚠️  FOLLOW SECURITY PROTOCOLS - DO NOT SHARE DETAILS"

# 1. Isolate affected systems
kubectl cordon node-suspicious.wakala.com
kubectl drain node-suspicious.wakala.com --ignore-daemonsets --delete-emptydir-data

# 2. Revoke potentially compromised credentials
kubectl delete secret api-credentials -n production
kubectl create secret generic api-credentials-temp -n production \
  --from-literal=key=$(openssl rand -hex 32)

# 3. Enable enhanced logging
kubectl set env deployment/wakala-api -n production \
  SECURITY_AUDIT_MODE=true \
  LOG_LEVEL=DEBUG

# 4. Block suspicious IPs
./scripts/block-ips.sh --file /tmp/suspicious-ips.txt

# 5. Snapshot for forensics
for node in $(kubectl get nodes -o name); do
  instance_id=$(kubectl get $node -o jsonpath='{.spec.providerID}' | cut -d'/' -f5)
  aws ec2 create-snapshot \
    --volume-id $(aws ec2 describe-instances --instance-ids $instance_id --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text) \
    --description "Security incident forensics - $(date)"
done

# 6. Notify security team
./scripts/security-alert.sh \
  --severity CRITICAL \
  --type "Potential Breach" \
  --evidence "/tmp/security-incident-$INCIDENT_ID/"
```

## Post-Incident Process

### 1. Immediate Actions (Within 2 hours)
```bash
# Update incident log
cat >> /tmp/incident-$INCIDENT_ID.log << EOF
$(date +"%H:%M:%S") - Incident resolved
Resolution: $RESOLUTION
Duration: $DURATION
Customer Impact: $IMPACT
EOF

# Collect final metrics
./scripts/incident-metrics.sh \
  --incident-id "$INCIDENT_ID" \
  --generate-report

# Schedule post-mortem
./scripts/schedule-postmortem.sh \
  --incident-id "$INCIDENT_ID" \
  --date "$(date -d '+2 days' +%Y-%m-%d)" \
  --attendees "ic,tech-lead,team"
```

### 2. Post-Mortem Template
```markdown
# Incident Post-Mortem: $INCIDENT_ID

**Date:** $DATE
**Duration:** $DURATION
**Severity:** $SEVERITY
**Author:** $AUTHOR

## Executive Summary
[Brief description of the incident and its impact]

## Timeline
- **HH:MM** - Initial detection
- **HH:MM** - Incident acknowledged
- **HH:MM** - Root cause identified
- **HH:MM** - Fix implemented
- **HH:MM** - Incident resolved

## Root Cause Analysis

### What Happened
[Detailed technical explanation]

### Why It Happened
[Contributing factors]

### How It Was Fixed
[Resolution steps]

## Impact
- **Customers Affected:** X
- **Revenue Impact:** $Y
- **SLA Status:** [Met/Breached]
- **Data Loss:** [None/Description]

## Lessons Learned

### What Went Well
- [Positive aspects]

### What Went Poorly
- [Areas for improvement]

### Where We Got Lucky
- [Near misses]

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
| [Action 1] | [Owner] | [Date] | [ ] |
| [Action 2] | [Owner] | [Date] | [ ] |

## Supporting Data
- Logs: [Link]
- Metrics: [Link]
- Dashboards: [Link]
```

### 3. Follow-up Actions
```bash
# Create action items
./scripts/create-jira-tickets.sh \
  --from-postmortem "/tmp/postmortem-$INCIDENT_ID.md" \
  --project "INCIDENT" \
  --sprint "current"

# Update runbooks
./scripts/update-runbook.sh \
  --incident-type "$INCIDENT_TYPE" \
  --add-scenario "$INCIDENT_ID" \
  --lessons-learned "/tmp/lessons-$INCIDENT_ID.md"

# Update monitoring
./scripts/add-alert.sh \
  --name "Prevent-$INCIDENT_ID-recurrence" \
  --condition "$ALERT_CONDITION" \
  --threshold "$THRESHOLD" \
  --action "page-oncall"
```

## Incident Metrics Dashboard

### Key Metrics
```yaml
incident_metrics:
  mttr:  # Mean Time To Resolution
    target: "< 30 minutes"
    current: "22 minutes"
  
  mttd:  # Mean Time To Detection
    target: "< 5 minutes"
    current: "3 minutes"
  
  incident_rate:
    target: "< 2 per month"
    current: "1.5 per month"
  
  postmortem_completion:
    target: "100% within 48 hours"
    current: "95%"
  
  action_item_completion:
    target: "100% within 30 days"
    current: "87%"
```

### Monthly Review
```bash
# Generate monthly incident report
./scripts/incident-report.sh \
  --month "$(date +%Y-%m)" \
  --format "pdf" \
  --include-metrics \
  --include-trends \
  --output "/reports/incident-report-$(date +%Y-%m).pdf"

# Review meeting agenda
1. Incident trends and patterns
2. MTTR/MTTD progress
3. Recurring issues
4. Action item status
5. Process improvements
6. Training needs
```

## Emergency Contacts

### Internal Escalation
```yaml
contacts:
  on_call:
    primary: "+1-555-ONCALL1"
    secondary: "+1-555-ONCALL2"
  
  management:
    engineering_manager: "+1-555-MGR-001"
    director: "+1-555-DIR-001"
    vp_engineering: "+1-555-VP-0001"
    cto: "+1-555-CTO-001"
  
  specialized:
    database_expert: "+1-555-DBA-001"
    security_expert: "+1-555-SEC-001"
    network_expert: "+1-555-NET-001"
```

### External Contacts
```yaml
vendors:
  aws_support:
    url: "https://console.aws.amazon.com/support/"
    phone: "+1-800-xxx-xxxx"
    account_id: "123456789012"
  
  whatsapp_business:
    url: "https://business.whatsapp.com/support"
    account_manager: "am@meta.com"
  
  cloudflare:
    url: "https://support.cloudflare.com"
    phone: "+1-650-xxx-xxxx"
```

---

**Remember:** Stay calm, communicate clearly, and focus on resolution. Every incident is a learning opportunity.