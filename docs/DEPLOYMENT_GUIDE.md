# Wakala V2 Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Environment Configuration](#environment-configuration)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Monitoring Setup](#monitoring-setup)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Production Deployment](#production-deployment)
8. [Troubleshooting](#troubleshooting)
9. [Maintenance](#maintenance)

## Prerequisites

### Required Tools
- Node.js 18+ and pnpm 8+
- Docker 24+ and Docker Compose 2.20+
- Kubernetes 1.28+ (kubectl)
- Helm 3.12+
- Git 2.40+
- Redis 7+
- PostgreSQL 15+
- MongoDB 6+ (for certain services)

### Optional Tools
- k9s (Kubernetes CLI UI)
- Lens (Kubernetes IDE)
- Postman (API testing)
- ngrok (WhatsApp webhook testing)

### Cloud Accounts
- AWS/GCP/Azure account (for production)
- WhatsApp Business API access
- Payment gateway accounts (EcoCash, M-Pesa, Paystack)
- Monitoring services (optional: Datadog, New Relic)

## Local Development Setup

### 1. Clone Repository
```bash
git clone https://github.com/wakala/wakala-v2.git
cd wakala-v2
```

### 2. Install Dependencies
```bash
# Install all dependencies for the entire workspace
# This will install dependencies for all services and packages
pnpm install

# Dependencies will be automatically installed for all workspace packages
# No need to install individually when using pnpm workspaces
```

### 3. Setup Local Databases
```bash
# Start local databases with Docker Compose
docker-compose -f docker-compose.dev.yml up -d

# Verify databases are running
docker-compose ps

# Expected output:
# wakala-postgres    running  0.0.0.0:5432->5432/tcp
# wakala-redis       running  0.0.0.0:6379->6379/tcp
# wakala-mongo       running  0.0.0.0:27017->27017/tcp
```

### 4. Initialize Databases
```bash
# Run migrations
pnpm run db:migrate

# Seed test data (optional)
pnpm run db:seed

# Create test tenants
pnpm run create:test-tenants
```

### 5. Configure Environment
```bash
# Copy example environment files
cp .env.example .env.local
cp backend/services/api-gateway/.env.example backend/services/api-gateway/.env
# ... repeat for each service

# Edit .env.local with your configuration
nano .env.local
```

### 6. Start Services
```bash
# Start all services in development mode
pnpm run dev

# Or start individually
pnpm run dev:api-gateway
pnpm run dev:order-service
pnpm run dev:payment-service
# ... etc

# Services will be available at:
# API Gateway: http://localhost:3000
# Order Service: http://localhost:3001
# Payment Service: http://localhost:3002
# ... etc
```

### 7. Setup WhatsApp Webhook (Local Testing)
```bash
# Install ngrok
brew install ngrok  # macOS
# or download from https://ngrok.com

# Expose API Gateway
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Configure this URL in WhatsApp Business API webhook settings
```

### 8. Run Tests
```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm run test:unit
pnpm run test:integration
pnpm run test:e2e

# Run with coverage
pnpm run test:coverage
```

## Environment Configuration

### Core Environment Variables
```env
# Application
NODE_ENV=development
APP_NAME=wakala-v2
API_VERSION=v1
LOG_LEVEL=debug

# API Gateway
API_GATEWAY_PORT=3000
JWT_SECRET=your-secret-key
JWT_EXPIRY=7d

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/wakala
REDIS_URL=redis://localhost:6379
MONGODB_URL=mongodb://localhost:27017/wakala

# Multi-tenant
TENANT_HEADER=X-Tenant-ID
DEFAULT_TENANT=default

# WhatsApp
WHATSAPP_API_URL=https://graph.facebook.com/v17.0
WHATSAPP_VERIFY_TOKEN=your-verify-token
WHATSAPP_WEBHOOK_PATH=/webhooks/whatsapp

# Payment Gateways
ECOCASH_API_URL=https://api.ecocash.co.zw
ECOCASH_MERCHANT_ID=your-merchant-id
ECOCASH_API_KEY=your-api-key

PAYSTACK_API_URL=https://api.paystack.co
PAYSTACK_SECRET_KEY=your-secret-key

MPESA_API_URL=https://sandbox.safaricom.co.ke
MPESA_CONSUMER_KEY=your-consumer-key
MPESA_CONSUMER_SECRET=your-consumer-secret

# AWS/Cloud
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=wakala-assets

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
```

### Service-Specific Configuration

#### Order Service
```env
ORDER_SERVICE_PORT=3001
ORDER_STATE_MACHINE_TIMEOUT=300000
MAX_ORDER_ITEMS=50
DEFAULT_CURRENCY=USD
```

#### Payment Service
```env
PAYMENT_SERVICE_PORT=3002
PAYMENT_TIMEOUT=30000
RECONCILIATION_INTERVAL=3600000
REFUND_WINDOW_DAYS=30
```

#### Delivery Service
```env
DELIVERY_SERVICE_PORT=3003
WEBSOCKET_PORT=3004
GPS_UPDATE_INTERVAL=5000
MAX_DELIVERY_DISTANCE_KM=50
```

## Kubernetes Deployment

### 1. Setup Kubernetes Cluster

#### Local (Minikube)
```bash
# Install Minikube
brew install minikube  # macOS

# Start cluster
minikube start --cpus=4 --memory=8192

# Enable addons
minikube addons enable ingress
minikube addons enable metrics-server
```

#### Production (EKS Example)
```bash
# Install eksctl
brew install eksctl

# Create cluster
eksctl create cluster \
  --name wakala-prod \
  --region us-east-1 \
  --nodegroup-name workers \
  --node-type t3.medium \
  --nodes 3 \
  --nodes-min 2 \
  --nodes-max 5 \
  --managed
```

### 2. Install Istio Service Mesh
```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -

# Install Istio
istioctl install --set profile=production -y

# Enable sidecar injection
kubectl label namespace default istio-injection=enabled
```

### 3. Create Namespaces
```bash
# Create namespaces
kubectl create namespace wakala-prod
kubectl create namespace wakala-staging
kubectl create namespace wakala-monitoring

# Label for Istio injection
kubectl label namespace wakala-prod istio-injection=enabled
kubectl label namespace wakala-staging istio-injection=enabled
```

### 4. Install Helm Charts
```bash
# Add Helm repositories
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install PostgreSQL
helm install postgres bitnami/postgresql \
  --namespace wakala-prod \
  --set auth.postgresPassword=secretpassword \
  --set auth.database=wakala

# Install Redis
helm install redis bitnami/redis \
  --namespace wakala-prod \
  --set auth.password=secretpassword

# Install RabbitMQ
helm install rabbitmq bitnami/rabbitmq \
  --namespace wakala-prod \
  --set auth.password=secretpassword
```

### 5. Deploy Wakala Services
```bash
# Build and push Docker images
docker build -t wakala/api-gateway:latest ./backend/services/api-gateway
docker push wakala/api-gateway:latest
# ... repeat for each service

# Apply Kubernetes manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/services/
kubectl apply -f k8s/deployments/
kubectl apply -f k8s/ingress.yaml

# Or use Helm
helm install wakala ./helm/wakala \
  --namespace wakala-prod \
  --values ./helm/wakala/values.prod.yaml
```

### 6. Configure Ingress
```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: wakala-ingress
  namespace: wakala-prod
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  tls:
  - hosts:
    - api.wakala.africa
    secretName: wakala-tls
  rules:
  - host: api.wakala.africa
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-gateway
            port:
              number: 80
```

### 7. Setup Auto-scaling
```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
  namespace: wakala-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Monitoring Setup

### 1. Install Prometheus
```bash
# Install Prometheus Operator
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace wakala-monitoring \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=50Gi
```

### 2. Install Grafana
```bash
# Grafana is included with kube-prometheus-stack
# Access Grafana
kubectl port-forward -n wakala-monitoring svc/prometheus-grafana 3000:80

# Default credentials: admin/prom-operator
# Import dashboards from grafana/ directory
```

### 3. Install ELK Stack
```bash
# Install Elasticsearch
helm install elasticsearch elastic/elasticsearch \
  --namespace wakala-monitoring \
  --set replicas=3 \
  --set minimumMasterNodes=2

# Install Kibana
helm install kibana elastic/kibana \
  --namespace wakala-monitoring \
  --set elasticsearchHosts=http://elasticsearch:9200

# Install Filebeat
helm install filebeat elastic/filebeat \
  --namespace wakala-monitoring \
  --set filebeatConfig.filebeat\.yml.output.elasticsearch.hosts=["elasticsearch:9200"]
```

### 4. Setup Alerts
```yaml
# k8s/prometheus-alerts.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: wakala-alerts
  namespace: wakala-monitoring
spec:
  groups:
  - name: wakala
    interval: 30s
    rules:
    - alert: HighErrorRate
      expr: rate(http_request_errors_total[5m]) > 0.05
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: High error rate detected
        description: "Error rate is above 5% for {{ $labels.service }}"
    
    - alert: HighResponseTime
      expr: histogram_quantile(0.95, http_request_duration_seconds_bucket) > 0.5
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: High response time
        description: "95th percentile response time is above 500ms"
```

## CI/CD Pipeline

### GitHub Actions Workflow
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'pnpm'
    
    - name: Setup pnpm
      uses: pnpm/action-setup@v2
      with:
        version: 8
    
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    
    - name: Run tests
      run: |
        pnpm run test:unit
        pnpm run test:integration
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3

  build:
    needs: test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api-gateway, order-service, payment-service, delivery-service]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Docker Buildx
      uses: docker/setup-buildx-action@v2
    
    - name: Log in to Registry
      uses: docker/login-action@v2
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    
    - name: Build and push
      uses: docker/build-push-action@v4
      with:
        context: ./backend/services/${{ matrix.service }}
        push: true
        tags: |
          ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/${{ matrix.service }}:latest
          ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/${{ matrix.service }}:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup kubectl
      uses: azure/setup-kubectl@v3
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v2
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Update kubeconfig
      run: aws eks update-kubeconfig --name wakala-prod --region us-east-1
    
    - name: Deploy to Kubernetes
      run: |
        helm upgrade --install wakala ./helm/wakala \
          --namespace wakala-prod \
          --values ./helm/wakala/values.prod.yaml \
          --set image.tag=${{ github.sha }} \
          --wait
```

## Production Deployment

### 1. Pre-deployment Checklist
- [ ] All tests passing
- [ ] Security scan completed
- [ ] Performance benchmarks met
- [ ] Database migrations tested
- [ ] Rollback plan documented
- [ ] Monitoring alerts configured
- [ ] Load balancer health checks verified
- [ ] SSL certificates valid
- [ ] Environment variables set
- [ ] Secrets rotated

### 2. Deployment Steps
```bash
# 1. Create database backup
kubectl exec -n wakala-prod postgres-0 -- pg_dump -U postgres wakala > backup-$(date +%Y%m%d).sql

# 2. Run migrations
kubectl apply -f k8s/jobs/migration-job.yaml
kubectl wait --for=condition=complete job/db-migration -n wakala-prod

# 3. Deploy services (canary deployment)
kubectl set image deployment/api-gateway api-gateway=wakala/api-gateway:$NEW_VERSION \
  -n wakala-prod \
  --record

# 4. Monitor deployment
kubectl rollout status deployment/api-gateway -n wakala-prod

# 5. Run smoke tests
pnpm run test:smoke -- --env=production

# 6. Complete rollout or rollback
kubectl rollout undo deployment/api-gateway -n wakala-prod  # If issues
```

### 3. Post-deployment Verification
```bash
# Check pod status
kubectl get pods -n wakala-prod

# Check service endpoints
kubectl get endpoints -n wakala-prod

# Check logs
kubectl logs -f deployment/api-gateway -n wakala-prod

# Run health checks
curl https://api.wakala.africa/health
curl https://api.wakala.africa/ready

# Monitor metrics
open http://grafana.wakala.africa
```

## Troubleshooting

### Common Issues

#### 1. Pod Crashes
```bash
# Check pod status
kubectl describe pod <pod-name> -n wakala-prod

# Check logs
kubectl logs <pod-name> -n wakala-prod --previous

# Common causes:
# - Memory limits too low
# - Missing environment variables
# - Database connection issues
# - Health check failures
```

#### 2. Database Connection Issues
```bash
# Test connection from pod
kubectl exec -it <pod-name> -n wakala-prod -- nc -zv postgres 5432

# Check secrets
kubectl get secret postgres-credentials -n wakala-prod -o yaml

# Verify network policies
kubectl get networkpolicies -n wakala-prod
```

#### 3. WhatsApp Webhook Failures
```bash
# Check webhook logs
kubectl logs -f deployment/whatsapp-service -n wakala-prod | grep webhook

# Test webhook manually
curl -X POST https://api.wakala.africa/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Verify webhook token
kubectl get secret whatsapp-config -n wakala-prod -o jsonpath='{.data.WEBHOOK_VERIFY_TOKEN}' | base64 -d
```

#### 4. Payment Gateway Issues
```bash
# Check payment service logs
kubectl logs -f deployment/payment-service -n wakala-prod

# Test gateway connectivity
kubectl exec -it deployment/payment-service -n wakala-prod -- curl https://api.ecocash.co.zw/health

# Verify API keys
kubectl get secret payment-gateway-keys -n wakala-prod
```

#### 5. Performance Issues
```bash
# Check resource usage
kubectl top pods -n wakala-prod
kubectl top nodes

# Check HPA status
kubectl get hpa -n wakala-prod

# Analyze slow queries
kubectl exec -it postgres-0 -n wakala-prod -- psql -U postgres -d wakala -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

### Debug Commands
```bash
# Enable debug logging
kubectl set env deployment/api-gateway LOG_LEVEL=debug -n wakala-prod

# Port forward for local debugging
kubectl port-forward deployment/api-gateway 3000:3000 -n wakala-prod

# Execute commands in pod
kubectl exec -it deployment/api-gateway -n wakala-prod -- /bin/sh

# Copy files from pod
kubectl cp wakala-prod/api-gateway-xxx:/app/logs/error.log ./error.log
```

## Maintenance

### Regular Tasks

#### Daily
- Monitor error rates and response times
- Check disk usage
- Review security alerts
- Verify backup completion

#### Weekly
- Review performance metrics
- Update dependencies
- Rotate logs
- Test disaster recovery

#### Monthly
- Security patches
- Performance optimization
- Cost analysis
- Capacity planning

### Database Maintenance
```bash
# Vacuum database
kubectl exec -it postgres-0 -n wakala-prod -- psql -U postgres -d wakala -c "VACUUM ANALYZE;"

# Reindex tables
kubectl exec -it postgres-0 -n wakala-prod -- psql -U postgres -d wakala -c "REINDEX DATABASE wakala;"

# Update statistics
kubectl exec -it postgres-0 -n wakala-prod -- psql -U postgres -d wakala -c "ANALYZE;"
```

### Certificate Renewal
```bash
# Check certificate expiration
kubectl get certificate -n wakala-prod

# Force renewal
kubectl delete certificate wakala-tls -n wakala-prod
# cert-manager will automatically create a new one
```

### Scaling Operations
```bash
# Manual scaling
kubectl scale deployment api-gateway --replicas=5 -n wakala-prod

# Update HPA limits
kubectl patch hpa api-gateway-hpa -n wakala-prod --patch '{"spec":{"maxReplicas":20}}'

# Add nodes to cluster
eksctl scale nodegroup --cluster=wakala-prod --nodes=5 --name=workers
```

## Security Best Practices

1. **Secrets Management**
   - Use Kubernetes secrets
   - Rotate regularly
   - Never commit to git
   - Use sealed-secrets or external-secrets

2. **Network Security**
   - Implement network policies
   - Use service mesh (Istio)
   - Enable mTLS
   - Restrict egress traffic

3. **Container Security**
   - Scan images for vulnerabilities
   - Use minimal base images
   - Run as non-root user
   - Read-only root filesystem

4. **Access Control**
   - RBAC for Kubernetes
   - JWT for API authentication
   - API key management
   - Audit logging

## Disaster Recovery

### Backup Strategy
```bash
# Automated daily backups
0 2 * * * kubectl exec -n wakala-prod postgres-0 -- pg_dump -U postgres wakala | gzip > /backups/wakala-$(date +\%Y\%m\%d).sql.gz

# Application data backup
kubectl exec -n wakala-prod minio-0 -- mc mirror /data s3://wakala-backups/minio-data
```

### Recovery Procedures
```bash
# Restore database
gunzip < backup-20240110.sql.gz | kubectl exec -i -n wakala-prod postgres-0 -- psql -U postgres wakala

# Restore application state
kubectl apply -f k8s/disaster-recovery/restore-job.yaml
```

## Support

### Getting Help
- Documentation: https://docs.wakala.africa
- Slack: #wakala-support
- Email: support@wakala.africa
- On-call: +1-xxx-xxx-xxxx

### Reporting Issues
1. Check existing issues
2. Collect logs and metrics
3. Create detailed bug report
4. Include reproduction steps
5. Tag with severity level

## Appendix

### Useful Links
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Istio Documentation](https://istio.io/docs/)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)

### Architecture Diagrams
See `/docs/diagrams/` for detailed architecture diagrams

### Configuration Templates
See `/k8s/templates/` for Kubernetes manifest templates