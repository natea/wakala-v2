# Infrastructure Architecture

## Executive Summary

This document defines the comprehensive infrastructure architecture for Wakala OS, including Kubernetes deployment patterns, service mesh configuration with Istio, CI/CD pipelines, monitoring and observability stack, security architecture, and disaster recovery strategies.

## 1. Kubernetes Deployment Architecture

### 1.1 Cluster Architecture

```yaml
# Multi-region cluster configuration
clusters:
  production:
    primary:
      name: wakala-prod-primary
      region: af-south-1  # Cape Town
      zones: [af-south-1a, af-south-1b, af-south-1c]
      node_groups:
        system:
          instance_type: t3.large
          min_size: 3
          max_size: 6
          labels:
            node-role: system
          taints:
            - key: node-role
              value: system
              effect: NoSchedule
        
        application:
          instance_type: c5.xlarge
          min_size: 6
          max_size: 50
          labels:
            node-role: application
            
        database:
          instance_type: r5.2xlarge
          min_size: 3
          max_size: 9
          labels:
            node-role: database
          taints:
            - key: node-role
              value: database
              effect: NoSchedule
              
        gpu:  # For ML workloads
          instance_type: g4dn.xlarge
          min_size: 0
          max_size: 5
          labels:
            node-role: gpu
          taints:
            - key: nvidia.com/gpu
              value: "true"
              effect: NoSchedule
    
    standby:
      name: wakala-prod-standby
      region: eu-west-1  # Ireland (DR)
      zones: [eu-west-1a, eu-west-1b, eu-west-1c]
      # Similar configuration with reduced capacity
```

### 1.2 Namespace Strategy

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: wakala-system
  labels:
    name: wakala-system
    istio-injection: enabled
---
apiVersion: v1
kind: Namespace
metadata:
  name: wakala-apps
  labels:
    name: wakala-apps
    istio-injection: enabled
---
apiVersion: v1
kind: Namespace
metadata:
  name: wakala-data
  labels:
    name: wakala-data
    istio-injection: enabled
---
apiVersion: v1
kind: Namespace
metadata:
  name: wakala-monitoring
  labels:
    name: wakala-monitoring
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: wakala-apps
spec:
  hard:
    requests.cpu: "100"
    requests.memory: 200Gi
    limits.cpu: "200"
    limits.memory: 400Gi
    persistentvolumeclaims: "10"
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: wakala-apps
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-istio
  namespace: wakala-apps
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: istio-system
```

### 1.3 Microservice Deployments

```yaml
# WhatsApp Service Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whatsapp-service
  namespace: wakala-apps
  labels:
    app: whatsapp-service
    version: v1
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: whatsapp-service
      version: v1
  template:
    metadata:
      labels:
        app: whatsapp-service
        version: v1
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: whatsapp-service
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - whatsapp-service
            topologyKey: kubernetes.io/hostname
      containers:
      - name: whatsapp-service
        image: wakala.azurecr.io/whatsapp-service:v1.0.0
        ports:
        - containerPort: 8080
          name: http
        - containerPort: 9090
          name: metrics
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: url
        - name: WHATSAPP_API_KEY
          valueFrom:
            secretKeyRef:
              name: whatsapp-credentials
              key: api-key
        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        volumeMounts:
        - name: config
          mountPath: /app/config
          readOnly: true
        - name: secrets
          mountPath: /app/secrets
          readOnly: true
      volumes:
      - name: config
        configMap:
          name: whatsapp-service-config
      - name: secrets
        secret:
          secretName: whatsapp-service-secrets
---
apiVersion: v1
kind: Service
metadata:
  name: whatsapp-service
  namespace: wakala-apps
  labels:
    app: whatsapp-service
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 8080
    name: http
  - port: 9090
    targetPort: 9090
    name: metrics
  selector:
    app: whatsapp-service
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: whatsapp-service-hpa
  namespace: wakala-apps
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: whatsapp-service
  minReplicas: 3
  maxReplicas: 20
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
        averageValue: "100"
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
      - type: Pods
        value: 2
        periodSeconds: 60
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: whatsapp-service-pdb
  namespace: wakala-apps
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: whatsapp-service
```

### 1.4 StatefulSet for Databases

```yaml
# PostgreSQL StatefulSet
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-primary
  namespace: wakala-data
spec:
  serviceName: postgres-primary
  replicas: 1
  selector:
    matchLabels:
      app: postgres
      role: primary
  template:
    metadata:
      labels:
        app: postgres
        role: primary
    spec:
      nodeSelector:
        node-role: database
      tolerations:
      - key: node-role
        operator: Equal
        value: database
        effect: NoSchedule
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_DB
          value: wakala
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: password
        - name: POSTGRES_REPLICATION_MODE
          value: master
        - name: POSTGRES_REPLICATION_USER
          value: replicator
        - name: POSTGRES_REPLICATION_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: replication-password
        resources:
          requests:
            cpu: 2
            memory: 8Gi
          limits:
            cpu: 4
            memory: 16Gi
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        - name: postgres-config
          mountPath: /etc/postgresql/postgresql.conf
          subPath: postgresql.conf
        - name: init-scripts
          mountPath: /docker-entrypoint-initdb.d
      volumes:
      - name: postgres-config
        configMap:
          name: postgres-config
      - name: init-scripts
        configMap:
          name: postgres-init-scripts
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 100Gi
```

## 2. Service Mesh Configuration (Istio)

### 2.1 Istio Installation and Configuration

```yaml
# Istio configuration
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
metadata:
  name: control-plane
spec:
  profile: production
  hub: docker.io/istio
  tag: 1.18.0
  
  meshConfig:
    accessLogFile: /dev/stdout
    accessLogFormat: |
      [%START_TIME%] "%REQ(:METHOD)% %REQ(X-ENVOY-ORIGINAL-PATH?:PATH)% %PROTOCOL%"
      %RESPONSE_CODE% %RESPONSE_FLAGS% %BYTES_RECEIVED% %BYTES_SENT%
      "%DOWNSTREAM_REMOTE_ADDRESS%" "%REQ(X-FORWARDED-FOR)%" "%REQ(USER-AGENT)%"
      "%REQ(X-REQUEST-ID)%" "%REQ(:AUTHORITY)%" "%UPSTREAM_HOST%"
      tenant_id="%REQ(X-TENANT-ID)%" trace_id="%REQ(X-B3-TRACEID)%"
    
    defaultConfig:
      proxyStatsMatcher:
        inclusionRegexps:
        - ".*outlier_detection.*"
        - ".*circuit_breakers.*"
        - ".*upstream_rq_retry.*"
        - ".*upstream_rq_pending.*"
        - ".*tenant_id.*"
      
      tracing:
        sampling: 10.0  # 10% sampling
        zipkin:
          address: jaeger-collector.wakala-monitoring:9411
    
    extensionProviders:
    - name: prometheus
      prometheus:
        configOverride:
          inboundSidecar:
            disable_host_header_fallback: true
          outboundSidecar:
            disable_host_header_fallback: true
    
  components:
    pilot:
      k8s:
        resources:
          requests:
            cpu: 1000m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 2Gi
        hpaSpec:
          minReplicas: 2
          maxReplicas: 5
    
    ingressGateways:
    - name: istio-ingressgateway
      enabled: true
      k8s:
        service:
          type: LoadBalancer
          ports:
          - port: 80
            targetPort: 8080
            name: http2
          - port: 443
            targetPort: 8443
            name: https
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 1Gi
        hpaSpec:
          minReplicas: 3
          maxReplicas: 10
    
    egressGateways:
    - name: istio-egressgateway
      enabled: true
      k8s:
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
```

### 2.2 Virtual Services and Destination Rules

```yaml
# Gateway configuration
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: wakala-gateway
  namespace: istio-system
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - "api.wakala.os"
    tls:
      httpsRedirect: true
  - port:
      number: 443
      name: https
      protocol: HTTPS
    hosts:
    - "api.wakala.os"
    tls:
      mode: SIMPLE
      credentialName: wakala-tls-cert
---
# Virtual Service for WhatsApp webhook
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: whatsapp-webhook
  namespace: wakala-apps
spec:
  hosts:
  - "api.wakala.os"
  gateways:
  - wakala-gateway
  http:
  - match:
    - uri:
        prefix: "/webhook/whatsapp"
    timeout: 3s
    route:
    - destination:
        host: whatsapp-service
        port:
          number: 80
      weight: 100
    retryPolicy:
      attempts: 3
      perTryTimeout: 1s
      retryOn: 5xx,reset,connect-failure,refused-stream
---
# Destination Rule with circuit breaker
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: whatsapp-service
  namespace: wakala-apps
spec:
  host: whatsapp-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http1MaxPendingRequests: 50
        http2MaxRequests: 100
        maxRequestsPerConnection: 2
    outlierDetection:
      consecutiveErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
      minHealthPercent: 30
      splitExternalLocalOriginErrors: true
  subsets:
  - name: v1
    labels:
      version: v1
    trafficPolicy:
      connectionPool:
        tcp:
          maxConnections: 50
---
# Service Entry for external services
apiVersion: networking.istio.io/v1beta1
kind: ServiceEntry
metadata:
  name: whatsapp-api
  namespace: wakala-apps
spec:
  hosts:
  - graph.facebook.com
  ports:
  - number: 443
    name: https
    protocol: HTTPS
  location: MESH_EXTERNAL
  resolution: DNS
---
# Authorization Policy
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: whatsapp-webhook-auth
  namespace: wakala-apps
spec:
  selector:
    matchLabels:
      app: whatsapp-service
  action: ALLOW
  rules:
  - to:
    - operation:
        paths: ["/webhook/whatsapp"]
        methods: ["POST"]
    when:
    - key: request.headers[x-hub-signature-256]
      notValues: [""]
---
# Request Authentication
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: jwt-auth
  namespace: wakala-apps
spec:
  selector:
    matchLabels:
      app: api-gateway
  jwtRules:
  - issuer: "https://auth.wakala.os"
    jwksUri: "https://auth.wakala.os/.well-known/jwks.json"
    audiences:
    - "wakala-api"
    forwardOriginalToken: true
```

### 2.3 Traffic Management

```yaml
# Canary deployment
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: order-service-canary
  namespace: wakala-apps
spec:
  hosts:
  - order-service
  http:
  - match:
    - headers:
        x-canary:
          exact: "true"
    route:
    - destination:
        host: order-service
        subset: v2
      weight: 100
  - route:
    - destination:
        host: order-service
        subset: v1
      weight: 90
    - destination:
        host: order-service
        subset: v2
      weight: 10
---
# Fault injection for testing
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payment-service-fault
  namespace: wakala-apps
spec:
  hosts:
  - payment-service
  http:
  - match:
    - headers:
        x-test-scenario:
          exact: "fault-injection"
    fault:
      delay:
        percentage:
          value: 10
        fixedDelay: 5s
      abort:
        percentage:
          value: 5
        httpStatus: 503
    route:
    - destination:
        host: payment-service
  - route:
    - destination:
        host: payment-service
```

## 3. CI/CD Pipeline Architecture

### 3.1 GitOps with ArgoCD

```yaml
# ArgoCD Application
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: wakala-platform
  namespace: argocd
  finalizers:
  - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/wakala-os/infrastructure
    targetRevision: HEAD
    path: k8s/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: wakala-apps
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
    - Validate=true
    - CreateNamespace=true
    - PrunePropagationPolicy=foreground
    - PruneLast=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
  revisionHistoryLimit: 10
```

### 3.2 GitHub Actions Pipeline

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [whatsapp-service, order-service, payment-service]
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
        cache-dependency-path: services/${{ matrix.service }}/package-lock.json
    
    - name: Install dependencies
      working-directory: services/${{ matrix.service }}
      run: npm ci
    
    - name: Run tests
      working-directory: services/${{ matrix.service }}
      run: |
        npm run test:unit
        npm run test:integration
        npm run test:coverage
    
    - name: SonarCloud Scan
      uses: SonarSource/sonarcloud-github-action@master
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
      with:
        projectBaseDir: services/${{ matrix.service }}

  build:
    needs: test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [whatsapp-service, order-service, payment-service]
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v2
    
    - name: Log in to Container Registry
      uses: docker/login-action@v2
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    
    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v4
      with:
        images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/${{ matrix.service }}
        tags: |
          type=ref,event=branch
          type=ref,event=pr
          type=semver,pattern={{version}}
          type=semver,pattern={{major}}.{{minor}}
          type=sha,prefix={{branch}}-
    
    - name: Build and push Docker image
      uses: docker/build-push-action@v4
      with:
        context: services/${{ matrix.service }}
        platforms: linux/amd64,linux/arm64
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
        build-args: |
          BUILD_VERSION=${{ github.sha }}
          BUILD_TIME=${{ steps.meta.outputs.created }}

  security-scan:
    needs: build
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Run Trivy vulnerability scanner
      uses: aquasecurity/trivy-action@master
      with:
        scan-type: 'repo'
        scan-ref: '.'
        format: 'sarif'
        output: 'trivy-results.sarif'
    
    - name: Upload Trivy scan results to GitHub Security tab
      uses: github/codeql-action/upload-sarif@v2
      with:
        sarif_file: 'trivy-results.sarif'
    
    - name: Run Snyk security scan
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      with:
        args: --severity-threshold=high

  deploy-staging:
    needs: [build, security-scan]
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Update Kubernetes manifests
      run: |
        cd k8s/overlays/staging
        kustomize edit set image wakala-*=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/*:${{ github.sha }}
    
    - name: Commit and push changes
      uses: EndBug/add-and-commit@v9
      with:
        add: 'k8s/overlays/staging'
        message: 'Update staging images to ${{ github.sha }}'
        default_author: github_actions

  deploy-production:
    needs: [build, security-scan]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
    - uses: actions/checkout@v3
    
    - name: Update Kubernetes manifests
      run: |
        cd k8s/overlays/production
        kustomize edit set image wakala-*=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}/*:${{ github.sha }}
    
    - name: Create release
      uses: actions/create-release@v1
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      with:
        tag_name: v${{ github.run_number }}
        release_name: Release v${{ github.run_number }}
        draft: false
        prerelease: false
    
    - name: Commit and push changes
      uses: EndBug/add-and-commit@v9
      with:
        add: 'k8s/overlays/production'
        message: 'Update production images to ${{ github.sha }}'
        default_author: github_actions
```

### 3.3 Tekton Pipeline

```yaml
# Tekton Pipeline for complex workflows
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: wakala-build-deploy
  namespace: tekton-pipelines
spec:
  params:
  - name: repo-url
    type: string
  - name: revision
    type: string
    default: main
  - name: service-name
    type: string
  
  workspaces:
  - name: shared-workspace
  - name: docker-credentials
  
  tasks:
  - name: fetch-source
    taskRef:
      name: git-clone
    workspaces:
    - name: output
      workspace: shared-workspace
    params:
    - name: url
      value: $(params.repo-url)
    - name: revision
      value: $(params.revision)
  
  - name: run-tests
    runAfter: ["fetch-source"]
    taskRef:
      name: npm-test
    workspaces:
    - name: source
      workspace: shared-workspace
    params:
    - name: service-path
      value: services/$(params.service-name)
  
  - name: build-image
    runAfter: ["run-tests"]
    taskRef:
      name: kaniko
    workspaces:
    - name: source
      workspace: shared-workspace
    - name: dockerconfig
      workspace: docker-credentials
    params:
    - name: IMAGE
      value: wakala.azurecr.io/$(params.service-name):$(tasks.fetch-source.results.commit)
    - name: DOCKERFILE
      value: services/$(params.service-name)/Dockerfile
    - name: CONTEXT
      value: services/$(params.service-name)
  
  - name: deploy-to-k8s
    runAfter: ["build-image"]
    taskRef:
      name: kubernetes-deploy
    params:
    - name: manifest
      value: |
        apiVersion: apps/v1
        kind: Deployment
        metadata:
          name: $(params.service-name)
          namespace: wakala-apps
        spec:
          template:
            spec:
              containers:
              - name: $(params.service-name)
                image: wakala.azurecr.io/$(params.service-name):$(tasks.fetch-source.results.commit)
```

## 4. Monitoring and Observability Stack

### 4.1 Prometheus Configuration

```yaml
# Prometheus configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: wakala-monitoring
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s
      external_labels:
        cluster: 'production'
        region: 'af-south-1'
    
    rule_files:
      - /etc/prometheus/rules/*.yml
    
    alerting:
      alertmanagers:
      - static_configs:
        - targets:
          - alertmanager:9093
    
    scrape_configs:
    - job_name: 'kubernetes-apiservers'
      kubernetes_sd_configs:
      - role: endpoints
      scheme: https
      tls_config:
        ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      bearer_token_file: /var/run/secrets/kubernetes.io/serviceaccount/token
      relabel_configs:
      - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
        action: keep
        regex: default;kubernetes;https
    
    - job_name: 'kubernetes-nodes'
      kubernetes_sd_configs:
      - role: node
      relabel_configs:
      - action: labelmap
        regex: __meta_kubernetes_node_label_(.+)
      - target_label: __address__
        replacement: kubernetes.default.svc:443
      - source_labels: [__meta_kubernetes_node_name]
        regex: (.+)
        target_label: __metrics_path__
        replacement: /api/v1/nodes/${1}/proxy/metrics
    
    - job_name: 'kubernetes-pods'
      kubernetes_sd_configs:
      - role: pod
      relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - action: labelmap
        regex: __meta_kubernetes_pod_label_(.+)
      - source_labels: [__meta_kubernetes_namespace]
        action: replace
        target_label: kubernetes_namespace
      - source_labels: [__meta_kubernetes_pod_name]
        action: replace
        target_label: kubernetes_pod_name
      - source_labels: [__meta_kubernetes_pod_label_app]
        action: replace
        target_label: app
      metric_relabel_configs:
      - source_labels: [__name__]
        regex: '(container_memory_working_set_bytes|container_cpu_usage_seconds_total)'
        action: keep
    
    - job_name: 'istio-mesh'
      kubernetes_sd_configs:
      - role: endpoints
        namespaces:
          names:
          - istio-system
          - wakala-apps
      relabel_configs:
      - source_labels: [__meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
        action: keep
        regex: istio-telemetry;prometheus
---
# Prometheus Rules
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-rules
  namespace: wakala-monitoring
data:
  service-rules.yml: |
    groups:
    - name: service.rules
      interval: 30s
      rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
          /
          sum(rate(http_requests_total[5m])) by (service)
          > 0.05
        for: 5m
        labels:
          severity: critical
          component: service
        annotations:
          summary: "High error rate on {{ $labels.service }}"
          description: "{{ $labels.service }} has error rate of {{ $value | humanizePercentage }}"
      
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (service, le)
          ) > 1
        for: 5m
        labels:
          severity: warning
          component: service
        annotations:
          summary: "High latency on {{ $labels.service }}"
          description: "95th percentile latency is {{ $value }}s"
      
      - alert: PodCPUUsage
        expr: |
          sum(rate(container_cpu_usage_seconds_total[5m])) by (pod, namespace)
          > 0.9
        for: 5m
        labels:
          severity: warning
          component: pod
        annotations:
          summary: "High CPU usage for pod {{ $labels.pod }}"
          description: "Pod {{ $labels.pod }} in {{ $labels.namespace }} is using {{ $value | humanizePercentage }} CPU"
      
      - alert: PodMemoryUsage
        expr: |
          sum(container_memory_working_set_bytes) by (pod, namespace)
          /
          sum(container_spec_memory_limit_bytes) by (pod, namespace)
          > 0.9
        for: 5m
        labels:
          severity: warning
          component: pod
        annotations:
          summary: "High memory usage for pod {{ $labels.pod }}"
          description: "Pod {{ $labels.pod }} in {{ $labels.namespace }} is using {{ $value | humanizePercentage }} memory"
    
    - name: business.rules
      interval: 60s
      rules:
      - alert: LowOrderRate
        expr: |
          sum(rate(order_created_total[15m])) < 10
        for: 15m
        labels:
          severity: warning
          component: business
        annotations:
          summary: "Low order rate"
          description: "Order rate is {{ $value }} orders per minute"
      
      - alert: PaymentFailureRate
        expr: |
          sum(rate(payment_failed_total[5m]))
          /
          sum(rate(payment_attempted_total[5m]))
          > 0.1
        for: 5m
        labels:
          severity: critical
          component: payment
        annotations:
          summary: "High payment failure rate"
          description: "Payment failure rate is {{ $value | humanizePercentage }}"
```

### 4.2 Grafana Dashboards

```json
{
  "dashboard": {
    "title": "Wakala Platform Overview",
    "panels": [
      {
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "title": "Request Rate by Service",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total[5m])) by (service)",
            "legendFormat": "{{ service }}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "title": "Error Rate by Service",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{status=~\"5..\"}[5m])) by (service) / sum(rate(http_requests_total[5m])) by (service)",
            "legendFormat": "{{ service }}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
        "title": "P95 Latency by Service",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (service, le))",
            "legendFormat": "{{ service }}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 8},
        "title": "Active Orders",
        "targets": [
          {
            "expr": "sum(orders_active_total) by (status)",
            "legendFormat": "{{ status }}"
          }
        ],
        "type": "graph"
      },
      {
        "gridPos": {"h": 8, "w": 24, "x": 0, "y": 16},
        "title": "Business Metrics",
        "type": "row",
        "panels": [
          {
            "title": "Orders per Hour",
            "targets": [{"expr": "sum(increase(order_created_total[1h]))"}],
            "type": "stat"
          },
          {
            "title": "Revenue Today",
            "targets": [{"expr": "sum(increase(revenue_total[1d]))"}],
            "type": "stat"
          },
          {
            "title": "Active Drivers",
            "targets": [{"expr": "sum(drivers_active_total)"}],
            "type": "stat"
          },
          {
            "title": "Payment Success Rate",
            "targets": [
              {
                "expr": "sum(rate(payment_success_total[1h])) / sum(rate(payment_attempted_total[1h]))"
              }
            ],
            "type": "gauge"
          }
        ]
      }
    ]
  }
}
```

### 4.3 Logging with ELK Stack

```yaml
# Elasticsearch configuration
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: wakala-elasticsearch
  namespace: wakala-monitoring
spec:
  version: 8.8.0
  nodeSets:
  - name: master
    count: 3
    config:
      node.roles: ["master"]
      node.store.allow_mmap: false
    podTemplate:
      spec:
        containers:
        - name: elasticsearch
          resources:
            requests:
              memory: 2Gi
              cpu: 1
            limits:
              memory: 2Gi
              cpu: 2
    volumeClaimTemplates:
    - metadata:
        name: elasticsearch-data
      spec:
        accessModes:
        - ReadWriteOnce
        resources:
          requests:
            storage: 10Gi
        storageClassName: fast-ssd
  
  - name: data
    count: 3
    config:
      node.roles: ["data", "ingest"]
      node.store.allow_mmap: false
    podTemplate:
      spec:
        containers:
        - name: elasticsearch
          resources:
            requests:
              memory: 4Gi
              cpu: 2
            limits:
              memory: 8Gi
              cpu: 4
    volumeClaimTemplates:
    - metadata:
        name: elasticsearch-data
      spec:
        accessModes:
        - ReadWriteOnce
        resources:
          requests:
            storage: 100Gi
        storageClassName: fast-ssd
---
# Kibana configuration
apiVersion: kibana.k8s.elastic.co/v1
kind: Kibana
metadata:
  name: wakala-kibana
  namespace: wakala-monitoring
spec:
  version: 8.8.0
  count: 2
  elasticsearchRef:
    name: wakala-elasticsearch
  http:
    tls:
      selfSignedCertificate:
        disabled: true
  podTemplate:
    spec:
      containers:
      - name: kibana
        resources:
          requests:
            memory: 1Gi
            cpu: 0.5
          limits:
            memory: 2Gi
            cpu: 1
---
# Fluentd configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
  namespace: wakala-monitoring
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/containers/*.log
      pos_file /var/log/fluentd-containers.log.pos
      tag kubernetes.*
      read_from_head true
      <parse>
        @type json
        time_format %Y-%m-%dT%H:%M:%S.%NZ
      </parse>
    </source>
    
    <filter kubernetes.**>
      @type kubernetes_metadata
      @id filter_kube_metadata
      kubernetes_url "#{ENV['FLUENT_FILTER_KUBERNETES_URL'] || 'https://' + ENV.fetch('KUBERNETES_SERVICE_HOST') + ':' + ENV.fetch('KUBERNETES_SERVICE_PORT') + '/api'}"
      verify_ssl "#{ENV['KUBERNETES_VERIFY_SSL'] || true}"
    </filter>
    
    <filter kubernetes.**>
      @type record_transformer
      enable_ruby true
      <record>
        tenant_id ${record.dig("kubernetes", "labels", "tenant-id") || "system"}
        service ${record.dig("kubernetes", "labels", "app") || "unknown"}
        namespace ${record.dig("kubernetes", "namespace_name")}
        pod ${record.dig("kubernetes", "pod_name")}
        container ${record.dig("kubernetes", "container_name")}
      </record>
    </filter>
    
    <match kubernetes.**>
      @type elasticsearch
      @id out_es
      @log_level info
      include_tag_key true
      host "#{ENV['FLUENT_ELASTICSEARCH_HOST']}"
      port "#{ENV['FLUENT_ELASTICSEARCH_PORT']}"
      path "#{ENV['FLUENT_ELASTICSEARCH_PATH']}"
      scheme "#{ENV['FLUENT_ELASTICSEARCH_SCHEME'] || 'http'}"
      ssl_verify "#{ENV['FLUENT_ELASTICSEARCH_SSL_VERIFY'] || 'true'}"
      ssl_version "#{ENV['FLUENT_ELASTICSEARCH_SSL_VERSION'] || 'TLSv1_2'}"
      user "#{ENV['FLUENT_ELASTICSEARCH_USER'] || use_default}"
      password "#{ENV['FLUENT_ELASTICSEARCH_PASSWORD'] || use_default}"
      reload_connections "#{ENV['FLUENT_ELASTICSEARCH_RELOAD_CONNECTIONS'] || 'false'}"
      reconnect_on_error true
      reload_on_failure true
      log_es_400_reason false
      logstash_prefix "#{ENV['FLUENT_ELASTICSEARCH_LOGSTASH_PREFIX'] || 'logstash'}"
      logstash_dateformat "#{ENV['FLUENT_ELASTICSEARCH_LOGSTASH_DATEFORMAT'] || '%Y.%m.%d'}"
      logstash_format "#{ENV['FLUENT_ELASTICSEARCH_LOGSTASH_FORMAT'] || 'true'}"
      index_name "#{ENV['FLUENT_ELASTICSEARCH_LOGSTASH_INDEX_NAME'] || 'logstash'}"
      type_name "#{ENV['FLUENT_ELASTICSEARCH_LOGSTASH_TYPE_NAME'] || 'fluentd'}"
      include_timestamp false
      template_name "#{ENV['FLUENT_ELASTICSEARCH_TEMPLATE_NAME'] || use_nil}"
      template_file "#{ENV['FLUENT_ELASTICSEARCH_TEMPLATE_FILE'] || use_nil}"
      template_overwrite "#{ENV['FLUENT_ELASTICSEARCH_TEMPLATE_OVERWRITE'] || use_default}"
      sniffer_class_name "#{ENV['FLUENT_SNIFFER_CLASS_NAME'] || 'Fluent::Plugin::ElasticsearchSimpleSniffer'}"
      request_timeout "#{ENV['FLUENT_ELASTICSEARCH_REQUEST_TIMEOUT'] || '5s'}"
      <buffer>
        flush_thread_count "#{ENV['FLUENT_ELASTICSEARCH_BUFFER_FLUSH_THREAD_COUNT'] || '8'}"
        flush_interval "#{ENV['FLUENT_ELASTICSEARCH_BUFFER_FLUSH_INTERVAL'] || '5s'}"
        chunk_limit_size "#{ENV['FLUENT_ELASTICSEARCH_BUFFER_CHUNK_LIMIT_SIZE'] || '2M'}"
        queue_limit_length "#{ENV['FLUENT_ELASTICSEARCH_BUFFER_QUEUE_LIMIT_LENGTH'] || '32'}"
        retry_max_interval "#{ENV['FLUENT_ELASTICSEARCH_BUFFER_RETRY_MAX_INTERVAL'] || '30'}"
        retry_forever true
      </buffer>
    </match>
```

### 4.4 Distributed Tracing with Jaeger

```yaml
# Jaeger deployment
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: wakala-jaeger
  namespace: wakala-monitoring
spec:
  strategy: production
  
  collector:
    maxReplicas: 5
    resources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: 1
        memory: 2Gi
    autoscale: true
    options:
      collector.zipkin.host-port: ":9411"
  
  storage:
    type: elasticsearch
    options:
      es:
        server-urls: https://wakala-elasticsearch-es-http:9200
        index-prefix: jaeger
        username: elastic
        password: changeme
    esIndexCleaner:
      enabled: true
      numberOfDays: 7
      schedule: "55 23 * * *"
  
  query:
    replicas: 3
    resources:
      requests:
        cpu: 200m
        memory: 256Mi
      limits:
        cpu: 500m
        memory: 512Mi
  
  ingester:
    maxReplicas: 10
    autoscale: true
    resources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: 1
        memory: 2Gi
    options:
      kafka:
        consumer:
          brokers: kafka-cluster:9092
          topic: jaeger-spans
```

## 5. Security Architecture

### 5.1 Network Policies

```yaml
# Default deny all ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: wakala-apps
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
# Allow ingress from Istio
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-from-istio-system
  namespace: wakala-apps
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: istio-system
    - podSelector:
        matchLabels:
          app: istio-ingressgateway
---
# Database access policy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-access
  namespace: wakala-data
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: wakala-apps
    - podSelector:
        matchLabels:
          database-access: "true"
    ports:
    - protocol: TCP
      port: 5432
```

### 5.2 RBAC Configuration

```yaml
# Service Account for WhatsApp Service
apiVersion: v1
kind: ServiceAccount
metadata:
  name: whatsapp-service
  namespace: wakala-apps
---
# Role for WhatsApp Service
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: whatsapp-service-role
  namespace: wakala-apps
rules:
- apiGroups: [""]
  resources: ["configmaps"]
  resourceNames: ["whatsapp-config"]
  verbs: ["get", "watch"]
- apiGroups: [""]
  resources: ["secrets"]
  resourceNames: ["whatsapp-secrets"]
  verbs: ["get"]
---
# RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: whatsapp-service-binding
  namespace: wakala-apps
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: whatsapp-service-role
subjects:
- kind: ServiceAccount
  name: whatsapp-service
  namespace: wakala-apps
---
# ClusterRole for monitoring
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: prometheus-scraper
rules:
- apiGroups: [""]
  resources:
  - nodes
  - nodes/proxy
  - services
  - endpoints
  - pods
  verbs: ["get", "list", "watch"]
- apiGroups: ["extensions", "apps"]
  resources:
  - deployments
  verbs: ["get", "list", "watch"]
- nonResourceURLs: ["/metrics"]
  verbs: ["get"]
```

### 5.3 Pod Security Policies

```yaml
apiVersion: policy/v1beta1
kind: PodSecurityPolicy
metadata:
  name: restricted
spec:
  privileged: false
  allowPrivilegeEscalation: false
  requiredDropCapabilities:
    - ALL
  volumes:
    - 'configMap'
    - 'emptyDir'
    - 'projected'
    - 'secret'
    - 'downwardAPI'
    - 'persistentVolumeClaim'
  hostNetwork: false
  hostIPC: false
  hostPID: false
  runAsUser:
    rule: 'MustRunAsNonRoot'
  seLinux:
    rule: 'RunAsAny'
  supplementalGroups:
    rule: 'RunAsAny'
  fsGroup:
    rule: 'RunAsAny'
  readOnlyRootFilesystem: true
---
# Security Context for pods
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod-example
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 2000
    seccompProfile:
      type: RuntimeDefault
  containers:
  - name: app
    image: wakala/app:latest
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL
    volumeMounts:
    - name: tmp
      mountPath: /tmp
    - name: var-cache
      mountPath: /var/cache
  volumes:
  - name: tmp
    emptyDir: {}
  - name: var-cache
    emptyDir: {}
```

### 5.4 Secrets Management

```yaml
# External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: wakala-apps
spec:
  provider:
    vault:
      server: "https://vault.wakala.internal:8200"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "wakala-apps"
          serviceAccountRef:
            name: "external-secrets"
---
# External Secret
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: whatsapp-credentials
  namespace: wakala-apps
spec:
  refreshInterval: 15m
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: whatsapp-credentials
    creationPolicy: Owner
  data:
  - secretKey: api-key
    remoteRef:
      key: whatsapp/credentials
      property: api_key
  - secretKey: webhook-secret
    remoteRef:
      key: whatsapp/credentials
      property: webhook_secret
---
# Sealed Secrets for GitOps
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: database-credentials
  namespace: wakala-apps
spec:
  encryptedData:
    username: AgBvA7aN+...
    password: AgCdE9fG+...
  template:
    metadata:
      name: database-credentials
      namespace: wakala-apps
    type: Opaque
```

## 6. Disaster Recovery and Scaling Strategies

### 6.1 Backup Configuration

```yaml
# Velero backup configuration
apiVersion: velero.io/v1
kind: Schedule
metadata:
  name: daily-backup
  namespace: velero
spec:
  schedule: "0 2 * * *"  # 2 AM daily
  template:
    ttl: 720h0m0s  # 30 days retention
    includedNamespaces:
    - wakala-apps
    - wakala-data
    includedResources:
    - persistentvolumeclaims
    - persistentvolumes
    - deployments
    - statefulsets
    - services
    - configmaps
    - secrets
    excludedResources:
    - events
    - pods
    - replicasets
    labelSelector:
      matchLabels:
        backup: "true"
    hooks:
      resources:
      - name: postgres-backup
        includedNamespaces:
        - wakala-data
        labelSelector:
          matchLabels:
            app: postgres
        pre:
        - exec:
            container: postgres
            command:
            - /bin/bash
            - -c
            - pg_dump -U $POSTGRES_USER $POSTGRES_DB > /backup/dump.sql
            onError: Fail
            timeout: 30m
---
# Backup location
apiVersion: velero.io/v1
kind: BackupStorageLocation
metadata:
  name: default
  namespace: velero
spec:
  provider: aws
  objectStorage:
    bucket: wakala-backups
    prefix: velero
  config:
    region: af-south-1
    s3ForcePathStyle: "false"
    s3Url: https://s3.af-south-1.amazonaws.com
```

### 6.2 Multi-Region Failover

```yaml
# Global Load Balancer configuration
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: wakala-global-ingress
  annotations:
    kubernetes.io/ingress.class: "nginx"
    external-dns.alpha.kubernetes.io/hostname: "api.wakala.os"
    external-dns.alpha.kubernetes.io/ttl: "60"
    external-dns.alpha.kubernetes.io/cloudflare-proxied: "true"
spec:
  tls:
  - hosts:
    - api.wakala.os
    secretName: wakala-tls
  rules:
  - host: api.wakala.os
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: istio-ingressgateway
            port:
              number: 80
---
# Health check endpoint
apiVersion: v1
kind: Service
metadata:
  name: health-check
  namespace: wakala-apps
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
  selector:
    app: health-check
---
# Cross-region replication
apiVersion: batch/v1
kind: CronJob
metadata:
  name: cross-region-sync
  namespace: wakala-data
spec:
  schedule: "*/5 * * * *"  # Every 5 minutes
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: sync
            image: wakala/data-sync:latest
            command:
            - /bin/sh
            - -c
            - |
              # Sync critical data to standby region
              pg_dump $PRIMARY_DB | psql $STANDBY_DB
              aws s3 sync s3://wakala-data-primary/ s3://wakala-data-standby/ --delete
          restartPolicy: OnFailure
```

### 6.3 Auto-scaling Configuration

```yaml
# Cluster Autoscaler
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: cluster-autoscaler
  template:
    metadata:
      labels:
        app: cluster-autoscaler
    spec:
      serviceAccountName: cluster-autoscaler
      containers:
      - image: k8s.gcr.io/autoscaling/cluster-autoscaler:v1.26.0
        name: cluster-autoscaler
        resources:
          limits:
            cpu: 100m
            memory: 300Mi
          requests:
            cpu: 100m
            memory: 300Mi
        command:
        - ./cluster-autoscaler
        - --v=4
        - --stderrthreshold=info
        - --cloud-provider=aws
        - --skip-nodes-with-local-storage=false
        - --expander=least-waste
        - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/wakala-prod
        - --balance-similar-node-groups
        - --skip-nodes-with-system-pods=false
        env:
        - name: AWS_REGION
          value: af-south-1
---
# Vertical Pod Autoscaler
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: whatsapp-service-vpa
  namespace: wakala-apps
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: whatsapp-service
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
    - containerName: whatsapp-service
      minAllowed:
        cpu: 100m
        memory: 128Mi
      maxAllowed:
        cpu: 2
        memory: 2Gi
      controlledResources: ["cpu", "memory"]
```

## 7. Cost Optimization

### 7.1 Resource Management

```yaml
# Namespace resource quotas
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-resources
  namespace: wakala-apps
spec:
  hard:
    requests.cpu: "100"
    requests.memory: 200Gi
    limits.cpu: "200"
    limits.memory: 400Gi
    requests.storage: 500Gi
    persistentvolumeclaims: "20"
    count/deployments.apps: "50"
    count/services: "50"
---
# Limit ranges
apiVersion: v1
kind: LimitRange
metadata:
  name: resource-limits
  namespace: wakala-apps
spec:
  limits:
  - max:
      cpu: "2"
      memory: 4Gi
    min:
      cpu: 50m
      memory: 64Mi
    default:
      cpu: 250m
      memory: 512Mi
    defaultRequest:
      cpu: 100m
      memory: 128Mi
    type: Container
  - max:
      storage: 10Gi
    type: PersistentVolumeClaim
```

### 7.2 Spot Instance Configuration

```yaml
# Node pool with spot instances
apiVersion: karpenter.sh/v1alpha5
kind: Provisioner
metadata:
  name: spot-provisioner
spec:
  requirements:
    - key: karpenter.sh/capacity-type
      operator: In
      values: ["spot"]
    - key: kubernetes.io/arch
      operator: In
      values: ["amd64"]
    - key: node.kubernetes.io/instance-type
      operator: In
      values:
        - m5.large
        - m5.xlarge
        - m5.2xlarge
        - m5a.large
        - m5a.xlarge
  limits:
    resources:
      cpu: 1000
      memory: 1000Gi
  provider:
    subnetSelector:
      karpenter.sh/discovery: "wakala-prod"
    securityGroupSelector:
      karpenter.sh/discovery: "wakala-prod"
    userData: |
      #!/bin/bash
      /etc/eks/bootstrap.sh wakala-prod
      /opt/aws/bin/cfn-signal --exit-code $? \
        --stack  ${AWS::StackName} \
        --resource NodeGroup \
        --region ${AWS::Region}
  ttlSecondsAfterEmpty: 30
  ttlSecondsUntilExpired: 604800  # 7 days
```

## Conclusion

This infrastructure architecture provides a robust, scalable, and secure foundation for Wakala OS with:

1. **High Availability** through multi-region deployment and automatic failover
2. **Scalability** with horizontal and vertical auto-scaling
3. **Security** through defense-in-depth with network policies, RBAC, and encryption
4. **Observability** with comprehensive monitoring, logging, and tracing
5. **Reliability** through circuit breakers, retries, and gradual rollouts
6. **Cost Optimization** through resource limits and spot instances

The architecture supports both current requirements and future growth while maintaining operational excellence.