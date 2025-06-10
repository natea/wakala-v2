# Wakala Service Scaling Runbook

**Version:** 1.0  
**Last Updated:** January 10, 2025  
**Owner:** Infrastructure Team  
**Response Time:** 2-10 minutes

## Table of Contents
1. [Scaling Triggers](#scaling-triggers)
2. [Horizontal Scaling](#horizontal-scaling)
3. [Vertical Scaling](#vertical-scaling)
4. [Database Scaling](#database-scaling)
5. [Cache Scaling](#cache-scaling)
6. [Auto-Scaling Configuration](#auto-scaling-configuration)

## Scaling Triggers

### Automatic Scaling Metrics
| Metric | Scale Up | Scale Down | Cool Down |
|--------|----------|------------|-----------|
| CPU Usage | > 70% for 5m | < 30% for 10m | 5 minutes |
| Memory Usage | > 80% for 5m | < 40% for 10m | 5 minutes |
| Request Queue | > 100 for 3m | < 10 for 10m | 3 minutes |
| Response Time | > 1s p95 for 5m | < 200ms for 10m | 5 minutes |
| Active Connections | > 80% limit | < 30% limit | 10 minutes |

### Manual Scaling Decisions
```bash
# Check current metrics
kubectl top nodes
kubectl top pods -n production

# Database metrics
psql -h $DB_HOST -U postgres -d wakala -c "
SELECT 
  (SELECT count(*) FROM pg_stat_activity) as connections,
  (SELECT setting::int FROM pg_settings WHERE name='max_connections') as max_connections,
  (SELECT count(*) FROM pg_stat_activity WHERE state='active') as active_queries,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock') as waiting_queries;"

# Cache metrics
redis-cli -h redis-master info stats
```

## Horizontal Scaling

### 1. API Service Scaling
```bash
# Check current replicas
kubectl get hpa wakala-api -n production

# Manual scale up
kubectl scale deployment wakala-api -n production --replicas=20

# Update HPA limits
kubectl patch hpa wakala-api -n production -p '
spec:
  minReplicas: 5
  maxReplicas: 50
  targetCPUUtilizationPercentage: 70'

# Monitor scaling progress
kubectl get pods -n production -l app=wakala-api -w
```

### 2. Worker Service Scaling
```bash
# Scale based on queue depth
QUEUE_DEPTH=$(redis-cli -h redis-master llen message:queue)

if [ $QUEUE_DEPTH -gt 10000 ]; then
  WORKERS=30
elif [ $QUEUE_DEPTH -gt 5000 ]; then
  WORKERS=20
else
  WORKERS=10
fi

kubectl scale deployment wakala-worker -n production --replicas=$WORKERS

# Scale specific worker types
kubectl scale deployment wakala-worker-priority -n production --replicas=5
kubectl scale deployment wakala-worker-bulk -n production --replicas=15
```

### 3. WebSocket Service Scaling
```bash
# Check connection count
CONNECTIONS=$(kubectl exec -n production deployment/wakala-websocket -- \
  curl -s localhost:9090/metrics | grep ws_connections | tail -1 | awk '{print $2}')

# Scale based on connections (1000 per pod)
REPLICAS=$((($CONNECTIONS / 1000) + 1))
kubectl scale deployment wakala-websocket -n production --replicas=$REPLICAS

# Update sticky session configuration
kubectl patch service wakala-websocket -n production -p '
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 86400'
```

## Vertical Scaling

### 1. Resource Limit Updates
```bash
# Update API resources
kubectl set resources deployment/wakala-api -n production \
  --limits=cpu=4000m,memory=8Gi \
  --requests=cpu=2000m,memory=4Gi

# Update Worker resources for heavy processing
kubectl set resources deployment/wakala-worker-bulk -n production \
  --limits=cpu=8000m,memory=16Gi \
  --requests=cpu=4000m,memory=8Gi

# Trigger rolling update
kubectl rollout restart deployment/wakala-api -n production
kubectl rollout status deployment/wakala-api -n production
```

### 2. Node Pool Scaling
```bash
# AWS EKS node group scaling
aws eks update-nodegroup-config \
  --cluster-name wakala-production \
  --nodegroup-name workers-general \
  --scaling-config minSize=5,maxSize=50,desiredSize=20

# Add specialized node pool for high-memory workloads
eksctl create nodegroup \
  --cluster=wakala-production \
  --name=workers-memory-optimized \
  --instance-types=r5.2xlarge \
  --nodes-min=2 \
  --nodes-max=10 \
  --node-labels="workload=memory-intensive"
```

### 3. Instance Type Changes
```bash
# Cordon existing nodes
kubectl cordon node-1.wakala.com

# Drain workloads safely
kubectl drain node-1.wakala.com \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --grace-period=300

# Update instance type (AWS)
aws ec2 modify-instance-attribute \
  --instance-id i-1234567890abcdef0 \
  --instance-type "{\"Value\": \"c5.4xlarge\"}"

# Restart and uncordon
aws ec2 reboot-instances --instance-ids i-1234567890abcdef0
kubectl uncordon node-1.wakala.com
```

## Database Scaling

### 1. Read Replica Scaling
```bash
# Add read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier wakala-prod-read-$(date +%s) \
  --source-db-instance-identifier wakala-prod \
  --db-instance-class db.r5.xlarge \
  --publicly-accessible false \
  --multi-az

# Update application configuration
kubectl create configmap db-read-endpoints -n production \
  --from-literal=read1=wakala-prod-read-1.xxx.rds.amazonaws.com \
  --from-literal=read2=wakala-prod-read-2.xxx.rds.amazonaws.com \
  --from-literal=read3=wakala-prod-read-3.xxx.rds.amazonaws.com \
  -o yaml --dry-run=client | kubectl apply -f -

# Restart applications to pick up new endpoints
kubectl rollout restart deployment/wakala-api -n production
```

### 2. Connection Pool Scaling
```bash
# Update PgBouncer configuration
kubectl exec -n production pgbouncer-0 -- bash -c "cat > /etc/pgbouncer/pgbouncer.ini << EOF
[databases]
wakala = host=$DB_HOST port=5432 pool_size=100 reserve_pool=20
wakala_read = host=$DB_READ_HOST port=5432 pool_size=200 reserve_pool=30

[pgbouncer]
pool_mode = transaction
max_client_conn = 5000
default_pool_size = 100
reserve_pool_size = 20
reserve_pool_timeout = 5
server_lifetime = 3600
server_idle_timeout = 600
EOF"

# Reload configuration
kubectl exec -n production pgbouncer-0 -- pgbouncer -R
```

### 3. Database Instance Scaling
```bash
# Vertical scaling (requires downtime)
echo "Scheduling maintenance window..."
aws rds modify-db-instance \
  --db-instance-identifier wakala-prod \
  --db-instance-class db.r5.4xlarge \
  --apply-immediately \
  --allocated-storage 1000 \
  --iops 10000

# Monitor modification
aws rds describe-db-instances \
  --db-instance-identifier wakala-prod \
  --query 'DBInstances[0].DBInstanceStatus'
```

### 4. Sharding Implementation
```bash
# Add shard information to tenants
psql -h $DB_HOST -U postgres -d wakala << EOF
ALTER TABLE tenants ADD COLUMN shard_id INTEGER DEFAULT 1;

-- Distribute tenants across shards
UPDATE tenants 
SET shard_id = (hashtext(tenant_id::text) % 4) + 1
WHERE shard_id = 1;

-- Create shard mapping
CREATE TABLE shard_config (
  shard_id INTEGER PRIMARY KEY,
  host VARCHAR(255) NOT NULL,
  port INTEGER DEFAULT 5432,
  database VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true
);

INSERT INTO shard_config VALUES
  (1, 'shard1.wakala.com', 5432, 'wakala_shard1', true),
  (2, 'shard2.wakala.com', 5432, 'wakala_shard2', true),
  (3, 'shard3.wakala.com', 5432, 'wakala_shard3', true),
  (4, 'shard4.wakala.com', 5432, 'wakala_shard4', true);
EOF
```

## Cache Scaling

### 1. Redis Cluster Scaling
```bash
# Add Redis nodes
kubectl scale statefulset redis-cluster -n production --replicas=6

# Rebalance cluster
kubectl exec -n production redis-cluster-0 -- \
  redis-cli --cluster rebalance redis-cluster-0:6379 \
  --cluster-use-empty-masters

# Check cluster status
kubectl exec -n production redis-cluster-0 -- \
  redis-cli cluster nodes
```

### 2. Cache Partitioning
```bash
# Configure cache pools
cat << EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: redis-pools
  namespace: production
data:
  pools.yaml: |
    pools:
      - name: session
        endpoints:
          - redis-session-0:6379
          - redis-session-1:6379
        maxConnections: 1000
      - name: cache
        endpoints:
          - redis-cache-0:6379
          - redis-cache-1:6379
          - redis-cache-2:6379
        maxConnections: 2000
      - name: queue
        endpoints:
          - redis-queue-0:6379
          - redis-queue-1:6379
        maxConnections: 500
EOF
```

### 3. CDN Scaling
```bash
# Increase CDN cache size
aws cloudfront update-distribution \
  --id E1ABCDEF123456 \
  --distribution-config file://cdn-config.json

# Add edge locations
curl -X PATCH https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/cache_level \
  -H "X-Auth-Email: $CF_EMAIL" \
  -H "X-Auth-Key: $CF_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"value":"aggressive"}'

# Purge and warm cache
./scripts/cdn-cache-warm.sh --files "static/*" --regions "all"
```

## Auto-Scaling Configuration

### 1. Kubernetes HPA
```yaml
# hpa-config.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: wakala-api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: wakala-api
  minReplicas: 5
  maxReplicas: 100
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
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "1000"
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
      - type: Pods
        value: 2
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
      - type: Pods
        value: 10
        periodSeconds: 30
```

### 2. Cluster Autoscaler
```yaml
# cluster-autoscaler.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  template:
    spec:
      containers:
      - image: k8s.gcr.io/autoscaling/cluster-autoscaler:v1.21.0
        name: cluster-autoscaler
        command:
        - ./cluster-autoscaler
        - --v=4
        - --stderrthreshold=info
        - --cloud-provider=aws
        - --skip-nodes-with-local-storage=false
        - --expander=least-waste
        - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/wakala-production
        - --scale-down-delay-after-add=5m
        - --scale-down-unneeded-time=10m
        - --scale-down-utilization-threshold=0.5
        - --max-node-provision-time=15m
        - --max-nodes-total=200
```

### 3. Predictive Scaling
```python
# predictive-scaling.py
import boto3
import pandas as pd
from datetime import datetime, timedelta
from sklearn.ensemble import RandomForestRegressor

def predict_scaling_needs():
    # Fetch historical metrics
    cloudwatch = boto3.client('cloudwatch')
    
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=7)
    
    response = cloudwatch.get_metric_statistics(
        Namespace='Wakala/Production',
        MetricName='RequestCount',
        Dimensions=[{'Name': 'Service', 'Value': 'API'}],
        StartTime=start_time,
        EndTime=end_time,
        Period=3600,
        Statistics=['Average']
    )
    
    # Prepare data
    df = pd.DataFrame(response['Datapoints'])
    df['hour'] = pd.to_datetime(df['Timestamp']).dt.hour
    df['day_of_week'] = pd.to_datetime(df['Timestamp']).dt.dayofweek
    
    # Train model
    features = ['hour', 'day_of_week']
    X = df[features]
    y = df['Average']
    
    model = RandomForestRegressor()
    model.fit(X, y)
    
    # Predict next 6 hours
    future_hours = []
    current = datetime.utcnow()
    
    for i in range(6):
        future = current + timedelta(hours=i)
        future_hours.append({
            'hour': future.hour,
            'day_of_week': future.weekday()
        })
    
    predictions = model.predict(pd.DataFrame(future_hours))
    
    # Scale based on predictions
    for i, prediction in enumerate(predictions):
        if prediction > 10000:  # High load expected
            scale_replicas = max(20, int(prediction / 500))
            print(f"Hour +{i}: Scaling to {scale_replicas} replicas")
            
            # Schedule scaling
            schedule_scaling(i, scale_replicas)

def schedule_scaling(hours_ahead, replicas):
    """Schedule future scaling action"""
    subprocess.run([
        'at', f'now + {hours_ahead} hours',
        '-f', f'echo "kubectl scale deployment wakala-api -n production --replicas={replicas}"'
    ])
```

## Scaling Playbooks

### 1. Traffic Spike Response
```bash
#!/bin/bash
# rapid-scale.sh - Emergency scaling for traffic spikes

echo "🚨 Rapid scaling initiated at $(date)"

# 1. Immediately scale API pods
kubectl scale deployment wakala-api -n production --replicas=50

# 2. Increase cache capacity
kubectl scale statefulset redis-cache -n production --replicas=5

# 3. Add more nodes
aws eks update-nodegroup-config \
  --cluster-name wakala-production \
  --nodegroup-name workers-general \
  --scaling-config desiredSize=30

# 4. Increase rate limits temporarily
kubectl set env deployment/wakala-api -n production \
  RATE_LIMIT_REQUESTS=10000 \
  RATE_LIMIT_WINDOW=60

# 5. Enable caching headers
kubectl set env deployment/wakala-api -n production \
  AGGRESSIVE_CACHING=true

# 6. Alert team
./scripts/alert-team.sh \
  --message "Traffic spike detected - rapid scaling in progress" \
  --severity high
```

### 2. Gradual Scale Down
```bash
#!/bin/bash
# gradual-scale-down.sh - Safe scale down after peak

echo "📉 Gradual scale down starting at $(date)"

# Get current replica counts
CURRENT_API=$(kubectl get deployment wakala-api -n production -o jsonpath='{.spec.replicas}')
CURRENT_WORKER=$(kubectl get deployment wakala-worker -n production -o jsonpath='{.spec.replicas}')

# Scale down in steps
for step in 0.8 0.6 0.4 0.3; do
  NEW_API=$(echo "$CURRENT_API * $step" | bc | cut -d. -f1)
  NEW_WORKER=$(echo "$CURRENT_WORKER * $step" | bc | cut -d. -f1)
  
  # Ensure minimum replicas
  NEW_API=$(( NEW_API < 5 ? 5 : NEW_API ))
  NEW_WORKER=$(( NEW_WORKER < 3 ? 3 : NEW_WORKER ))
  
  echo "Scaling to API: $NEW_API, Worker: $NEW_WORKER"
  kubectl scale deployment wakala-api -n production --replicas=$NEW_API
  kubectl scale deployment wakala-worker -n production --replicas=$NEW_WORKER
  
  # Monitor for 10 minutes
  echo "Monitoring metrics for 10 minutes..."
  sleep 600
  
  # Check if metrics are stable
  ERROR_RATE=$(kubectl exec -n production deployment/wakala-api -- \
    curl -s localhost:9090/metrics | grep error_rate | tail -1 | awk '{print $2}')
  
  if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
    echo "Error rate increased, stopping scale down"
    break
  fi
done

echo "Scale down completed"
```

## Monitoring During Scaling

### Real-time Dashboards
```bash
# Open monitoring dashboards
echo "📊 Monitoring URLs:"
echo "Grafana: https://grafana.wakala.com/d/scaling-overview"
echo "K8s Dashboard: https://k8s.wakala.com/scaling"
echo "APM: https://apm.wakala.com/services"

# Terminal monitoring
watch -n 5 'kubectl top nodes; echo "---"; kubectl top pods -n production | head -20'
```

### Scaling Metrics Collection
```bash
# Collect scaling metrics
cat << 'EOF' > /tmp/collect-scaling-metrics.sh
#!/bin/bash

while true; do
  TIMESTAMP=$(date +%s)
  
  # Pod counts
  API_PODS=$(kubectl get pods -n production -l app=wakala-api --no-headers | wc -l)
  WORKER_PODS=$(kubectl get pods -n production -l app=wakala-worker --no-headers | wc -l)
  
  # Resource usage
  CPU_USAGE=$(kubectl top nodes --no-headers | awk '{sum+=$3} END {print sum/NR}')
  MEMORY_USAGE=$(kubectl top nodes --no-headers | awk '{sum+=$5} END {print sum/NR}')
  
  # Database connections
  DB_CONNECTIONS=$(psql -h $DB_HOST -U postgres -d wakala -t -c \
    "SELECT count(*) FROM pg_stat_activity")
  
  # Log metrics
  echo "$TIMESTAMP,$API_PODS,$WORKER_PODS,$CPU_USAGE,$MEMORY_USAGE,$DB_CONNECTIONS" \
    >> /var/log/scaling-metrics.csv
  
  sleep 30
done
EOF

chmod +x /tmp/collect-scaling-metrics.sh
nohup /tmp/collect-scaling-metrics.sh &
```

## Cost Optimization

### Resource Right-Sizing
```bash
# Analyze resource usage patterns
kubectl resource-capacity --pods --util --sort cpu.util

# Recommend optimal resource requests
./scripts/resource-optimizer.sh \
  --namespace production \
  --history 7d \
  --output recommendations.yaml

# Apply recommendations
kubectl apply -f recommendations.yaml
```

### Spot Instance Usage
```yaml
# spot-nodegroup.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: wakala-production
  region: us-east-1

nodeGroups:
  - name: spot-workers
    desiredCapacity: 10
    minSize: 0
    maxSize: 100
    instancesDistribution:
      maxPrice: 0.5
      instanceTypes:
        - c5.xlarge
        - c5a.xlarge
        - c5n.xlarge
      onDemandBaseCapacity: 0
      onDemandPercentageAboveBaseCapacity: 0
      spotInstancePools: 3
    labels:
      workload: stateless
      lifecycle: spot
    taints:
      - key: spot
        value: "true"
        effect: NoSchedule
```

---

**Important:** Always monitor the impact of scaling changes for at least 10 minutes before considering the operation complete. Use gradual scaling for production workloads whenever possible.