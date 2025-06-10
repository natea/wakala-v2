# Wakala Deployment Procedures Runbook

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Owner:** DevOps Team

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Blue-Green Deployment](#blue-green-deployment)
4. [Database Migration](#database-migration)
5. [Service Deployment](#service-deployment)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Rollback Procedures](#rollback-procedures)

## Prerequisites

### Required Access
- [ ] AWS/Azure console access with deployment permissions
- [ ] Kubernetes cluster admin access
- [ ] Database admin credentials
- [ ] Git repository write access
- [ ] CI/CD pipeline access
- [ ] Monitoring dashboard access

### Required Tools
```bash
# Install required tools
brew install kubectl helm aws-cli terraform
pip install ansible awscli
npm install -g @railway/cli
```

### Environment Variables
```bash
export KUBECONFIG=/path/to/kubeconfig
export AWS_PROFILE=wakala-production
export DEPLOY_ENV=production
export SLACK_WEBHOOK_URL=https://hooks.slack.com/xxx
```

## Pre-Deployment Checklist

### 1. Code Validation
```bash
# Run automated checks
./scripts/pre-deploy-check.sh

# Checklist:
- [ ] All tests passing in CI/CD
- [ ] Security scan completed
- [ ] Code review approved
- [ ] Performance benchmarks met
- [ ] Documentation updated
```

### 2. Backup Current State
```bash
# Backup databases
kubectl exec -n production postgres-primary-0 -- \
  pg_dump -U postgres wakala > backup-$(date +%Y%m%d-%H%M%S).sql

# Backup configuration
kubectl get configmap -n production -o yaml > configmaps-backup.yaml
kubectl get secret -n production -o yaml > secrets-backup.yaml

# Snapshot persistent volumes
aws ec2 create-snapshot --volume-id vol-xxxxx \
  --description "Pre-deployment backup $(date +%Y%m%d-%H%M%S)"
```

### 3. Communication
```bash
# Send deployment notification
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-type: application/json' \
  --data '{
    "text": "🚀 Deployment starting for version '"$VERSION"'",
    "channel": "#deployments"
  }'
```

## Blue-Green Deployment

### Step 1: Deploy to Green Environment
```bash
# Set target environment
export TARGET_ENV=green

# Deploy new version to green
helm upgrade --install wakala-green ./helm/wakala \
  --namespace production \
  --values ./helm/values/production.yaml \
  --set image.tag=$VERSION \
  --set environment=green \
  --wait --timeout 10m
```

### Step 2: Run Smoke Tests
```bash
# Execute smoke tests against green environment
./scripts/smoke-tests.sh --environment green

# Verify health endpoints
curl -f https://green.wakala.com/health || exit 1
curl -f https://green.wakala.com/ready || exit 1
```

### Step 3: Gradual Traffic Shift
```bash
# Start with 10% traffic to green
kubectl apply -f - <<EOF
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: wakala-production
  namespace: production
spec:
  http:
  - match:
    - headers:
        canary:
          exact: "true"
    route:
    - destination:
        host: wakala-green
      weight: 100
  - route:
    - destination:
        host: wakala-blue
      weight: 90
    - destination:
        host: wakala-green
      weight: 10
EOF

# Monitor metrics for 10 minutes
sleep 600

# If metrics are good, increase to 50%
kubectl patch virtualservice wakala-production -n production \
  --type merge -p '{"spec":{"http":[{"route":[{"destination":{"host":"wakala-blue"},"weight":50},{"destination":{"host":"wakala-green"},"weight":50}]}]}}'

# Monitor for another 10 minutes
sleep 600

# Complete cutover to green
kubectl patch virtualservice wakala-production -n production \
  --type merge -p '{"spec":{"http":[{"route":[{"destination":{"host":"wakala-green"},"weight":100}]}]}}'
```

### Step 4: Promote Green to Blue
```bash
# Update blue deployment to match green
helm upgrade --install wakala-blue ./helm/wakala \
  --namespace production \
  --values ./helm/values/production.yaml \
  --set image.tag=$VERSION \
  --set environment=blue \
  --wait --timeout 10m

# Update service to point to blue
kubectl patch service wakala -n production \
  -p '{"spec":{"selector":{"environment":"blue"}}}'

# Scale down green
kubectl scale deployment wakala-green -n production --replicas=0
```

## Database Migration

### Step 1: Pre-Migration Checks
```bash
# Check current schema version
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"

# Verify migration files
ls -la ./migrations/
```

### Step 2: Run Migrations
```bash
# Put application in maintenance mode
kubectl scale deployment wakala-blue -n production --replicas=1
kubectl exec -n production deployment/wakala-blue -- \
  ./manage.py maintenance_mode --enable

# Execute migrations
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala < ./migrations/$(date +%Y%m%d)_migration.sql

# Verify migration success
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "SELECT * FROM schema_migrations WHERE success = false;"
```

### Step 3: Post-Migration
```bash
# Update schema version
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala -c "INSERT INTO schema_migrations (version, applied_at) VALUES ('$VERSION', NOW());"

# Disable maintenance mode
kubectl exec -n production deployment/wakala-blue -- \
  ./manage.py maintenance_mode --disable

# Scale back up
kubectl scale deployment wakala-blue -n production --replicas=10
```

## Service Deployment

### API Service
```bash
# Deploy API service
kubectl set image deployment/wakala-api \
  -n production \
  wakala-api=wakala/api:$VERSION \
  --record

# Wait for rollout
kubectl rollout status deployment/wakala-api -n production

# Verify endpoints
./scripts/verify-api-endpoints.sh
```

### Worker Service
```bash
# Deploy worker service
kubectl set image deployment/wakala-worker \
  -n production \
  wakala-worker=wakala/worker:$VERSION \
  --record

# Verify job processing
kubectl logs -n production -l app=wakala-worker --tail=100
```

### WebSocket Service
```bash
# Deploy WebSocket service
kubectl set image deployment/wakala-websocket \
  -n production \
  wakala-websocket=wakala/websocket:$VERSION \
  --record

# Test WebSocket connections
wscat -c wss://wakala.com/ws/health
```

## Post-Deployment Verification

### 1. Health Checks
```bash
# Check all services
for service in api worker websocket scheduler; do
  echo "Checking $service..."
  curl -f https://wakala.com/$service/health || echo "FAILED: $service"
done
```

### 2. Functional Tests
```bash
# Run integration tests
./scripts/integration-tests.sh --environment production

# Test critical user flows
./scripts/test-user-flows.sh \
  --flow login \
  --flow send-message \
  --flow webhook-delivery
```

### 3. Performance Verification
```bash
# Run load test
k6 run ./tests/load/production-baseline.js

# Check response times
curl -w "@curl-format.txt" -o /dev/null -s https://wakala.com/api/health
```

### 4. Monitoring Alerts
```bash
# Check for any triggered alerts
./scripts/check-alerts.sh --duration 30m

# Verify metrics
./scripts/verify-metrics.sh \
  --metric error_rate \
  --metric response_time \
  --metric throughput
```

## Rollback Procedures

### Immediate Rollback (< 5 minutes)
```bash
# Quick rollback using Kubernetes
kubectl rollout undo deployment/wakala-api -n production
kubectl rollout undo deployment/wakala-worker -n production
kubectl rollout undo deployment/wakala-websocket -n production

# Verify rollback
kubectl rollout status deployment/wakala-api -n production
```

### Database Rollback
```bash
# Stop application
kubectl scale deployment wakala-blue -n production --replicas=0

# Restore database backup
kubectl exec -n production postgres-primary-0 -- \
  psql -U postgres -d wakala < backup-$BACKUP_TIMESTAMP.sql

# Restart application with previous version
helm rollback wakala-blue 1 -n production
```

### Full Environment Rollback
```bash
# Switch traffic back to previous blue environment
kubectl patch virtualservice wakala-production -n production \
  --type merge -p '{"spec":{"http":[{"route":[{"destination":{"host":"wakala-blue-previous"},"weight":100}]}]}}'

# Scale up previous version
kubectl scale deployment wakala-blue-previous -n production --replicas=10

# Remove failed deployment
kubectl delete deployment wakala-green -n production
```

## Troubleshooting

### Common Issues

#### 1. Pod CrashLoopBackOff
```bash
# Check logs
kubectl logs -n production -l app=wakala --tail=100

# Describe pod
kubectl describe pod -n production -l app=wakala

# Check events
kubectl get events -n production --sort-by='.lastTimestamp'
```

#### 2. Database Connection Issues
```bash
# Test connection
kubectl exec -n production deployment/wakala-api -- \
  pg_isready -h postgres-primary -p 5432

# Check connection pool
kubectl exec -n production deployment/wakala-api -- \
  ./manage.py check_db_connections
```

#### 3. Memory/CPU Issues
```bash
# Check resource usage
kubectl top pods -n production

# Increase resources if needed
kubectl set resources deployment/wakala-api -n production \
  --limits=cpu=2000m,memory=4Gi \
  --requests=cpu=1000m,memory=2Gi
```

## Emergency Contacts

- **On-Call Engineer:** +1-xxx-xxx-xxxx
- **DevOps Lead:** devops-lead@wakala.com
- **CTO:** cto@wakala.com
- **Incident Channel:** #incidents (Slack)
- **War Room:** https://meet.wakala.com/war-room

## Post-Deployment Report

```markdown
# Deployment Report Template

**Date:** [DATE]
**Version:** [VERSION]
**Duration:** [START] - [END]
**Status:** SUCCESS/FAILED/PARTIAL

## Changes Deployed
- [List of changes]

## Issues Encountered
- [Any issues and resolutions]

## Metrics
- Deployment time: X minutes
- Downtime: X minutes
- Error rate change: X%
- Performance impact: X%

## Action Items
- [Follow-up tasks]

## Sign-off
- DevOps: [NAME]
- QA: [NAME]
- Product: [NAME]
```

---

**Note:** Always follow the deployment schedule and notify stakeholders before beginning any production deployment.