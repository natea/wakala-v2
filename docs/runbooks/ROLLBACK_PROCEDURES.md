# Wakala Rollback Procedures Runbook

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Owner:** DevOps Team  
**Critical Time:** 5-30 minutes

## Table of Contents
1. [Rollback Decision Matrix](#rollback-decision-matrix)
2. [Quick Rollback (< 5 minutes)](#quick-rollback)
3. [Standard Rollback (5-15 minutes)](#standard-rollback)
4. [Complex Rollback (15-30 minutes)](#complex-rollback)
5. [Database Rollback](#database-rollback)
6. [Feature Flag Rollback](#feature-flag-rollback)
7. [Emergency Procedures](#emergency-procedures)

## Rollback Decision Matrix

### When to Rollback
| Metric | Threshold | Action |
|--------|-----------|--------|
| Error Rate | > 5% | Immediate rollback |
| Response Time | > 2s (p95) | Investigate, consider rollback |
| CPU Usage | > 90% | Scale first, then rollback |
| Memory Usage | > 95% | Immediate rollback |
| Failed Health Checks | > 20% | Immediate rollback |
| Customer Reports | > 10 | Investigate urgently |

### Rollback Authority
- **Automatic:** Error rate > 10% (system initiated)
- **On-Call Engineer:** Any degradation
- **Team Lead Approval:** Database changes
- **CTO Approval:** Multi-region rollback

## Quick Rollback

### 1. Kubernetes Deployment Rollback (< 2 minutes)
```bash
# Check rollout history
kubectl rollout history deployment/wakala-api -n production

# Immediate rollback to previous version
kubectl rollout undo deployment/wakala-api -n production

# Rollback to specific revision
kubectl rollout undo deployment/wakala-api -n production --to-revision=42

# Monitor rollback progress
kubectl rollout status deployment/wakala-api -n production -w
```

### 2. Helm Release Rollback (< 3 minutes)
```bash
# List release history
helm history wakala -n production

# Rollback to previous release
helm rollback wakala -n production

# Rollback to specific revision
helm rollback wakala 3 -n production

# Verify rollback
helm status wakala -n production
```

### 3. Quick Validation
```bash
# Health check
curl -f https://api.wakala.com/health || echo "HEALTH CHECK FAILED"

# Error rate check
kubectl logs -n production -l app=wakala-api --tail=1000 | grep ERROR | wc -l

# Quick smoke test
./scripts/smoke-test.sh --minimal
```

## Standard Rollback

### 1. Blue-Green Rollback (5-10 minutes)
```bash
# Switch traffic back to blue
kubectl patch service wakala -n production \
  -p '{"spec":{"selector":{"version":"blue"}}}'

# Verify traffic switch
kubectl get endpoints wakala -n production

# Scale down green environment
kubectl scale deployment wakala-green -n production --replicas=0

# Remove green deployment
kubectl delete deployment wakala-green -n production
```

### 2. Canary Rollback (5-15 minutes)
```bash
# Stop canary traffic immediately
kubectl patch virtualservice wakala -n production --type merge -p '
spec:
  http:
  - route:
    - destination:
        host: wakala
        subset: stable
      weight: 100'

# Remove canary deployment
kubectl delete deployment wakala-canary -n production

# Clean up canary resources
kubectl delete destinationrule wakala-canary -n production
```

### 3. Multi-Service Rollback
```bash
#!/bin/bash
# Rollback multiple services

SERVICES="api worker websocket scheduler"
NAMESPACE="production"

for service in $SERVICES; do
  echo "Rolling back $service..."
  kubectl rollout undo deployment/wakala-$service -n $NAMESPACE
done

# Wait for all rollbacks
for service in $SERVICES; do
  kubectl rollout status deployment/wakala-$service -n $NAMESPACE
done
```

## Complex Rollback

### 1. Stateful Service Rollback (15-20 minutes)
```bash
# Stop traffic to service
kubectl patch service wakala-stateful -n production \
  -p '{"spec":{"selector":{"version":"maintenance"}}}'

# Create backup of current state
kubectl exec wakala-stateful-0 -n production -- \
  tar -czf /backup/state-$(date +%Y%m%d-%H%M%S).tar.gz /data

# Rollback StatefulSet
kubectl rollout undo statefulset/wakala-stateful -n production

# Restore previous state if needed
kubectl exec wakala-stateful-0 -n production -- \
  tar -xzf /backup/state-previous.tar.gz -C /

# Resume traffic
kubectl patch service wakala-stateful -n production \
  -p '{"spec":{"selector":{"version":"stable"}}}'
```

### 2. Infrastructure Rollback (20-30 minutes)
```bash
# Terraform rollback
cd infrastructure/
git checkout HEAD~1
terraform plan -out=rollback.plan
terraform apply rollback.plan

# CloudFormation rollback
aws cloudformation cancel-update-stack --stack-name wakala-production
aws cloudformation update-stack \
  --stack-name wakala-production \
  --use-previous-template

# Verify infrastructure
./scripts/verify-infrastructure.sh
```

## Database Rollback

### 1. Schema Rollback
```bash
# Check current migration version
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"

# Apply rollback migration
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala < ./migrations/rollback/rollback_to_v${PREVIOUS_VERSION}.sql

# Verify schema state
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "\dt"
```

### 2. Data Rollback
```bash
# Point-in-time recovery
RECOVERY_TIME="2025-01-10 14:30:00"

# Stop application
kubectl scale deployment wakala-api -n production --replicas=0

# Restore to point in time
pg_restore -h $DB_HOST -U postgres -d wakala_restore \
  --clean --create --jobs=4 \
  /backup/wakala_${RECOVERY_TIME}.dump

# Swap databases
psql -h $DB_HOST -U postgres << EOF
ALTER DATABASE wakala RENAME TO wakala_old;
ALTER DATABASE wakala_restore RENAME TO wakala;
EOF

# Restart application
kubectl scale deployment wakala-api -n production --replicas=10
```

### 3. Transaction Rollback
```bash
# Identify problematic transactions
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "
    SELECT pid, age(clock_timestamp(), query_start), usename, query 
    FROM pg_stat_activity 
    WHERE state != 'idle' 
    AND query_start < now() - interval '5 minutes'
    ORDER BY query_start;"

# Kill long-running transactions
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "
    SELECT pg_terminate_backend(pid) 
    FROM pg_stat_activity 
    WHERE state != 'idle' 
    AND query_start < now() - interval '10 minutes';"
```

## Feature Flag Rollback

### 1. Immediate Feature Disable
```bash
# Disable feature flag
curl -X PATCH https://api.wakala.com/admin/features \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "feature": "new_message_flow",
    "enabled": false,
    "rollout_percentage": 0
  }'

# Clear feature flag cache
kubectl exec -n production deployment/wakala-api -- \
  redis-cli -h redis-master FLUSHDB

# Verify feature is disabled
curl https://api.wakala.com/features/new_message_flow
```

### 2. Gradual Feature Rollback
```bash
# Reduce rollout percentage
for pct in 50 25 10 5 0; do
  curl -X PATCH https://api.wakala.com/admin/features \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"feature\": \"new_message_flow\",
      \"rollout_percentage\": $pct
    }"
  
  echo "Rollout at $pct%, monitoring for 2 minutes..."
  sleep 120
  
  # Check error rate
  ERROR_RATE=$(curl -s https://api.wakala.com/metrics | jq .error_rate)
  if (( $(echo "$ERROR_RATE > 0.02" | bc -l) )); then
    echo "Error rate high, continuing rollback"
  else
    echo "Error rate acceptable, pausing rollback"
    break
  fi
done
```

## Emergency Procedures

### 1. Circuit Breaker Activation
```bash
# Enable circuit breaker
kubectl patch configmap wakala-config -n production --type merge -p '
data:
  CIRCUIT_BREAKER_ENABLED: "true"
  CIRCUIT_BREAKER_THRESHOLD: "10"
  CIRCUIT_BREAKER_TIMEOUT: "60"'

# Restart pods to apply
kubectl rollout restart deployment/wakala-api -n production
```

### 2. Emergency Traffic Redirect
```bash
# Redirect to maintenance page
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: wakala-maintenance
  namespace: production
spec:
  rules:
  - host: api.wakala.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: maintenance-page
            port:
              number: 80
EOF
```

### 3. Full System Rollback
```bash
#!/bin/bash
# Emergency full rollback script

echo "EMERGENCY ROLLBACK INITIATED"

# Stop all traffic
kubectl patch service wakala -n production \
  -p '{"spec":{"selector":{"version":"maintenance"}}}'

# Rollback all deployments
DEPLOYMENTS=$(kubectl get deployments -n production -o name | grep wakala)
for deploy in $DEPLOYMENTS; do
  kubectl rollout undo $deploy -n production
done

# Rollback database
./scripts/emergency-db-rollback.sh

# Clear all caches
kubectl exec -n production deployment/wakala-api -- \
  redis-cli -h redis-master FLUSHALL

# Restart all services
kubectl rollout restart deployment -n production

# Wait for stability
sleep 300

# Resume traffic
kubectl patch service wakala -n production \
  -p '{"spec":{"selector":{"version":"stable"}}}'

echo "EMERGENCY ROLLBACK COMPLETED"
```

## Post-Rollback Procedures

### 1. Verification Steps
```bash
# Full system health check
./scripts/full-health-check.sh

# Run integration tests
./scripts/integration-tests.sh --post-rollback

# Check customer impact
./scripts/check-customer-impact.sh --last-hour
```

### 2. Communication
```bash
# Notify stakeholders
./scripts/send-notification.sh \
  --channel "#deployments" \
  --message "Rollback completed. System stable." \
  --severity "warning"

# Update status page
curl -X POST https://api.statuspage.io/v1/incidents \
  -H "Authorization: OAuth $STATUSPAGE_TOKEN" \
  -d '{
    "incident": {
      "name": "Service degradation - Resolved",
      "status": "resolved",
      "impact": "minor",
      "body": "Service has been rolled back to previous stable version."
    }
  }'
```

### 3. Root Cause Analysis
```bash
# Collect logs
kubectl logs -n production -l app=wakala --since=2h > /tmp/rollback-logs.txt

# Generate metrics report
./scripts/generate-metrics-report.sh \
  --start "2 hours ago" \
  --end "now" \
  --output /tmp/rollback-metrics.html

# Create incident report
cat > /tmp/incident-report.md << EOF
# Rollback Incident Report

**Date:** $(date)
**Duration:** $ROLLBACK_DURATION
**Impact:** $IMPACT_DESCRIPTION
**Root Cause:** [TO BE DETERMINED]

## Timeline
- T+0: Issue detected
- T+$DETECTION_TIME: Rollback initiated
- T+$ROLLBACK_TIME: Rollback completed

## Action Items
- [ ] Root cause analysis
- [ ] Fix forward plan
- [ ] Process improvements
EOF
```

## Rollback Automation

### GitOps Rollback
```yaml
# argocd-rollback.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: wakala-production
spec:
  source:
    repoURL: https://github.com/wakala/deployments
    targetRevision: $PREVIOUS_COMMIT
    path: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Automated Rollback Rules
```yaml
# rollback-policy.yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: wakala-api
spec:
  analysis:
    threshold: 5
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99
    - name: request-duration
      thresholdRange:
        max: 500
  # Automatic rollback on failure
  skipAnalysis: false
```

## Appendices

### A. Rollback Commands Cheatsheet
```bash
# Quick rollback commands
alias rollback-api='kubectl rollout undo deployment/wakala-api -n production'
alias rollback-all='for d in $(kubectl get deploy -n production -o name); do kubectl rollout undo $d -n production; done'
alias rollback-helm='helm rollback wakala -n production'
alias rollback-check='kubectl get pods -n production -w'
```

### B. Emergency Contacts
- On-Call: +1-555-ROLLBACK
- DevOps Lead: devops-lead@wakala.com
- CTO: cto@wakala.com (for major rollbacks)

### C. Rollback Metrics
- Average rollback time: 3.5 minutes
- Success rate: 99.5%
- Most common cause: Memory leaks (35%)
- Automated rollbacks: 60%

---

**Remember:** Fast rollback is better than prolonged debugging in production. When in doubt, roll back!