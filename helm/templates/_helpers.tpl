{{/*
Expand the name of the chart.
*/}}
{{- define "neo-blog.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "neo-blog.fullname" -}}
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
{{- define "neo-blog.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "neo-blog.labels" -}}
helm.sh/chart: {{ include "neo-blog.chart" . }}
{{ include "neo-blog.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "neo-blog.selectorLabels" -}}
app.kubernetes.io/name: {{ include "neo-blog.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Selector labels for Frontend
*/}}
{{- define "neo-blog.frontend.selectorLabels" -}}
{{- include "neo-blog.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Selector labels for Backend
*/}}
{{- define "neo-blog.backend.selectorLabels" -}}
{{- include "neo-blog.selectorLabels" . }}
app.kubernetes.io/component: backend
{{- end }}
{{/*
多副本部署校验：后端多于 1 个副本（或启用自动扩缩容）时，必须配置 Redis 共享状态并使用 Postgres
*/}}
{{- define "neo-blog.validateReplicas" -}}
{{- if or .Values.autoscaling.enabled (gt (int .Values.replicaCount) 1) }}
{{- if not (or .Values.redis.url .Values.redis.existingSecret .Values.backend.env.REDIS_URL) }}
{{- fail "后端多副本部署（replicaCount > 1 或启用 autoscaling）必须配置 redis.url 或 redis.existingSecret，否则各副本的登录状态、验证码、限流与任务状态互不可见" }}
{{- end }}
{{- /* 设置了 DB_URL 时由其 scheme 判断驱动；existingSecret 的内容渲染时不可见，由后端启动时检查 */}}
{{- if not .Values.database.existingSecret }}
{{- $dbURL := lower (toString (.Values.database.url | default .Values.backend.env.DB_URL | default "")) }}
{{- $sqlite := eq (toString (default "sqlite" .Values.backend.env.DB_DRIVER)) "sqlite" }}
{{- if $dbURL }}
{{- $sqlite = or (hasPrefix "sqlite:" $dbURL) (hasPrefix "file:" $dbURL) }}
{{- end }}
{{- if $sqlite }}
{{- fail "后端多副本部署必须使用 Postgres（database.url 指向 postgres://，或 backend.env.DB_DRIVER: postgres），SQLite 只支持单实例" }}
{{- end }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "neo-blog.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "neo-blog.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
镜像拉取策略：image.pullPolicy 留空时，latest 标签用 Always（节点上已有旧的 latest 时也重新拉取），其他标签用 IfNotPresent。
用法：include "neo-blog.pullPolicy" (dict "root" . "tag" $tag)
*/}}
{{- define "neo-blog.pullPolicy" -}}
{{- if .root.Values.image.pullPolicy }}
{{- .root.Values.image.pullPolicy }}
{{- else if eq (toString .tag) "latest" }}
{{- "Always" }}
{{- else }}
{{- "IfNotPresent" }}
{{- end }}
{{- end }}

{{/*
生产模式必须提供 JWT_SECRET 与 PASSWORD_SALT（明文或 backend.secrets.existingSecret），否则后端启动即退出
*/}}
{{- define "neo-blog.validateSecrets" -}}
{{- if and (eq (toString .Values.backend.env.MODE) "prod") (not .Values.backend.secrets.existingSecret) }}
{{- if not (and .Values.backend.env.JWT_SECRET .Values.backend.env.PASSWORD_SALT) }}
{{- fail "生产模式（backend.env.MODE=prod）必须设置 JWT_SECRET 与 PASSWORD_SALT：推荐用 backend.secrets.existingSecret 从 Secret 读取，或在 backend.env 中填写" }}
{{- end }}
{{- end }}
{{- end }}
