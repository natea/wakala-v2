{{/*
Expand the name of the chart.
*/}}
{{- define "wakala-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "wakala-platform.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "wakala-platform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "wakala-platform.labels" -}}
helm.sh/chart: {{ include "wakala-platform.chart" . }}
{{ include "wakala-platform.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "wakala-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "wakala-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "wakala-platform.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "wakala-platform.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the PostgreSQL connection string
*/}}
{{- define "wakala-platform.postgresqlConnectionString" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s-postgresql:5432/%s?sslmode=require" .Values.postgresql.auth.username (include "wakala-platform.fullname" .) .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.externalDatabase.connectionString }}
{{- end }}
{{- end }}

{{/*
Get the Redis connection string
*/}}
{{- define "wakala-platform.redisConnectionString" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://:%s@%s-redis-master:6379/0" "$(REDIS_PASSWORD)" (include "wakala-platform.fullname" .) }}
{{- else }}
{{- .Values.externalRedis.connectionString }}
{{- end }}
{{- end }}

{{/*
Get the RabbitMQ connection string
*/}}
{{- define "wakala-platform.rabbitmqConnectionString" -}}
{{- if .Values.rabbitmq.enabled }}
{{- printf "amqp://%s:$(RABBITMQ_PASSWORD)@%s-rabbitmq:5672/" .Values.rabbitmq.auth.username (include "wakala-platform.fullname" .) }}
{{- else }}
{{- .Values.externalRabbitmq.connectionString }}
{{- end }}
{{- end }}

{{/*
Get the Elasticsearch URL
*/}}
{{- define "wakala-platform.elasticsearchUrl" -}}
{{- if .Values.elasticsearch.enabled }}
{{- printf "http://%s-elasticsearch:9200" (include "wakala-platform.fullname" .) }}
{{- else }}
{{- .Values.externalElasticsearch.url }}
{{- end }}
{{- end }}

{{/*
Common environment variables for all services
*/}}
{{- define "wakala-platform.commonEnvVars" -}}
- name: ENVIRONMENT
  value: {{ .Values.global.environment }}
- name: REGION
  value: {{ .Values.global.region }}
- name: SERVICE_NAME
  value: {{ .serviceName }}
- name: LOG_LEVEL
  value: {{ .logLevel | default "info" }}
- name: DATABASE_URL
  value: {{ include "wakala-platform.postgresqlConnectionString" . }}
- name: REDIS_URL
  value: {{ include "wakala-platform.redisConnectionString" . }}
- name: RABBITMQ_URL
  value: {{ include "wakala-platform.rabbitmqConnectionString" . }}
- name: ELASTICSEARCH_URL
  value: {{ include "wakala-platform.elasticsearchUrl" . }}
- name: JAEGER_AGENT_HOST
  value: jaeger-agent.monitoring.svc.cluster.local
- name: JAEGER_AGENT_PORT
  value: "6831"
{{- if .Values.postgresql.enabled }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.postgresql.auth.existingSecret }}
      key: postgres-password
{{- end }}
{{- if .Values.redis.enabled }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.redis.auth.existingSecret }}
      key: redis-password
{{- end }}
{{- if .Values.rabbitmq.enabled }}
- name: RABBITMQ_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.rabbitmq.auth.existingPasswordSecret }}
      key: rabbitmq-password
{{- end }}
{{- end }}

{{/*
Pod Disruption Budget
*/}}
{{- define "wakala-platform.podDisruptionBudget" -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "wakala-platform.fullname" . }}-{{ .serviceName }}
  labels:
    {{- include "wakala-platform.labels" . | nindent 4 }}
    app.kubernetes.io/component: {{ .serviceName }}
spec:
  minAvailable: {{ .minAvailable | default 1 }}
  selector:
    matchLabels:
      {{- include "wakala-platform.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: {{ .serviceName }}
{{- end }}

{{/*
Service Monitor for Prometheus
*/}}
{{- define "wakala-platform.serviceMonitor" -}}
{{- if .Values.monitoring.prometheus.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "wakala-platform.fullname" . }}-{{ .serviceName }}
  labels:
    {{- include "wakala-platform.labels" . | nindent 4 }}
    app.kubernetes.io/component: {{ .serviceName }}
spec:
  selector:
    matchLabels:
      {{- include "wakala-platform.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: {{ .serviceName }}
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
{{- end }}
{{- end }}