# TODO List

## 编辑器

- [ ] 重写Image Align Button, Image Node Pro

## 内容系统

- [ ] 打通文章置顶能力（后台编辑入口、列表排序、前台展示）
- [ ] 完成独立页面系统（Page）的模型、迁移、仓储、服务、控制器与路由联调

## 前台页面

- [ ] 完成归档页内容与交互
- [ ] 完成分类页（含按 slug 的页面路由与筛选展示）
- [ ] 完成标签页（统一独立标签页与首页标签筛选的体验）
- [ ] 补全 sitemap 中的 categories、labels、archives 数据

## 后台管理

- [ ] 完成后台评论管理接口与页面
- [ ] 完成后台全局设置页面，并接入站点配置持久化
- [ ] 完成后台 OIDC 管理页面，并接入现有管理 API
- [ ] 为后台 OIDC 管理补齐创建/编辑表单，优先使用 `react-hook-form`
- [ ] 确保后台 OIDC 管理表单覆盖后端管理员 DTO 字段：`name`、`client_id`、`client_secret`、`display_name`、`icon`、`oidc_discovery_url`、`issuer`、`authorization_endpoint`、`token_endpoint`、`userinfo_endpoint`、`jwks_uri`、`type`、`enabled`
- [ ] 明确 OIDC 管理页面的字段策略：自动发现字段支持查看与手动编辑，避免存在后端有字段但前端无入口的情况

测试构建提交