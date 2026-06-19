# n8n-nodes-domain

[中文](README.md) | [English](README.en.md)

用于查询域名注册信息的 n8n community node 包。

当前提供的第一个节点是 **Domain Lookup**。它接收域名、子域名或 HTTP(S) URL，并返回标准化后的 RDAP 注册信息，可用于 n8n 工作流中的域名到期检查。

## 功能

- 将用户输入标准化为 ASCII 可注册域名。
- 自动把子域名归并到可注册域名，例如 `api.shop.example.co.uk` 会归并为 `example.co.uk`。
- 查询免费的 RDAP 数据源，不需要 credentials 或 API key。
- 为已注册、未找到和失败场景返回稳定的输出结构。
- 可选将当前输入 item 的 `json` 数据合并到查询结果中，方便后续节点继续使用前置数据。
- 不输出注册人、联系人、地址、电话等个人信息字段。

## 支持的顶级域名

当前支持两类顶级域名：

- `.cn`：直接查询 CNNIC WHOIS `whois.cnnic.cn:43`，不走通用 RDAP fallback。
- IANA RDAP DNS bootstrap 中发布了 RDAP endpoint 的顶级域名：运行时从 `https://data.iana.org/rdap/dns.json` 获取并缓存 24 小时。

常见可支持示例：

- `.com`
- `.net`
- `.org`
- `.io`
- `.uk`
- `.cn`

不支持的顶级域名不会进入 RDAP fallback 检查流程，会直接返回不支持错误，避免把“没有权威查询来源”误判为“域名未注册”。

## 节点

### Domain Lookup

输入：

- `Domain`：必填。支持域名、子域名、HTTP(S) URL，或无协议的 URL-like 输入。

可选设置：

- `Include Input Data`：默认关闭。开启后，把当前输入 item 的 `json` 数据放入输出结果。
- `Input Data Mode`：选择 `All Fields` 时合并完整输入 `json`；选择 `Selected Fields` 时只合并指定字段。
- `Input Field Name`：输出中的容器字段名，默认是 `input`。字段名只能使用字母、数字、下划线，且不能和节点输出字段冲突。
- `Input Fields`：在 `Selected Fields` 模式下使用，支持逗号或换行分隔，例如 `id, domain, customer.name`。不存在的字段会被忽略。

输出字段：

- `asciiDomain`
- `publicSuffix`
- `isRegistered`
- `status`
- `dates.registeredAt`
- `dates.expiresAt`
- `dates.lastChangedAt`
- `dates.dataUpdatedAt`
- `expiry.daysUntilExpiration`
- `expiry.isExpired`
- `nameservers`
- `source`

`isRegistered` 是区分“已找到域名”和“权威来源返回未找到”的字段。

`.cn` 查询的 `source.protocol` 为 `whois`；RDAP 查询的 `source.protocol` 为 `rdap`。

## 开发

环境要求：

- Node.js 22 或更新版本
- npm

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

类型检查：

```bash
npm run typecheck
```

检查格式：

```bash
npm run format:check
```

## 运行时依赖

本包使用 `tldts` 基于 ICANN Public Suffix List 计算可注册域名。这样才能把 `api.shop.example.co.uk` 正确标准化为 `example.co.uk`，而不是使用不可靠的“取最后两段”规则。

`.cn` 使用 CNNIC WHOIS 查询。CNNIC WHOIS 返回的时间字段没有显式时区，节点会按 UTC 输出为 ISO 8601 字符串，以保持输出格式稳定。

## 构建说明

节点在 n8n 运行环境中从 n8n 自身导入 `n8n-workflow`。本仓库当前使用 `types/n8n-workflow.d.ts` 中的本地最小类型声明，以避免在项目安装和构建时把完整 n8n runtime 依赖树拉入本项目。

## 发布

本项目使用 GitHub Actions 和 npm Trusted Publishing 发布包。

触发条件：

- 推送匹配 `v*` 的 Git tag，例如 `v0.1.1`。
- workflow 文件：`.github/workflows/publish.yml`。
- GitHub Actions 使用 Node.js 24。
- 不需要配置 `NPM_TOKEN`，但 npm 包需要先在 npm 官网配置 Trusted Publisher。

发布步骤：

```bash
npm version patch
git push
git push --tags
```

注意：

- 每次发布前都必须更新 `package.json` 的 `version`，包版本号不能重复。
- 如果 npm 上还没有 `n8n-nodes-domain` 包，可能需要先完成首次发布，之后才能在包 Settings 中配置 Trusted Publisher。

## Credentials

v1 不需要 credentials。
