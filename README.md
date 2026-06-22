# n8n-nodes-domain

[中文](README.md) | [English](README.en.md)

用于查询域名注册信息的 n8n community node 包。

当前提供的第一个节点是 **Domain Lookup**。它接收域名、子域名或 HTTP(S) URL，并返回标准化后的域名注册信息，可用于 n8n 工作流中的域名到期检查。

## 功能

- 将用户输入标准化为 ASCII 可注册域名。
- 自动把子域名归并到可注册域名，例如 `api.shop.example.co.uk` 会归并为 `example.co.uk`。
- 查询免费的 IANA RDAP 或 CNNIC WHOIS 数据源，不需要 credentials 或 API key。
- 为已注册、未找到和失败场景返回稳定的输出结构。
- 可选将当前输入 item 的 `json` 数据合并到查询结果中，方便后续节点继续使用前置数据。
- 不输出注册人、联系人、地址、电话等个人信息字段。

## 查询路线

节点当前有两条查询路线：

- 根 TLD 为 `.cn` 的域名，包括 `.cn`、`.com.cn`、`.net.cn`、`.org.cn` 等：直接查询 CNNIC WHOIS `whois.cnnic.cn:43`，不走通用 RDAP fallback。
- IANA RDAP DNS bootstrap 中发布了 RDAP endpoint 的 TLD：运行时从 `https://data.iana.org/rdap/dns.json` 获取，并在当前 n8n 进程内缓存最多 24 小时。

常见可查询示例：

- `.com`
- `.net`
- `.org`
- `.xyz`
- `.uk`
- `.cn`

如果标准化后的 TLD 既不属于 `.cn` 查询路线，也没有出现在运行时 IANA RDAP DNS bootstrap 中，节点会输出结构化 `TLD_NOT_SUPPORTED` 结果，不请求 RDAP fallback，避免把“没有权威查询来源”误判为“域名未注册”。

## 节点

### Domain Lookup

输入：

- `Domain`：必填。支持域名、子域名、HTTP(S) URL，或无协议的 URL-like 输入。

可选设置：

- `Include Input Data`：未添加该选项时关闭；在 `Options` 中添加该选项后默认开启，把当前输入 item 的 `json` 数据放入输出结果。
- `Input Data Mode`：选择 `All Fields` 时合并完整输入 `json`；选择 `Selected Fields` 时只合并指定字段。
- `Input Field Name`：输出中的容器字段名，默认是 `input`。字段名只能使用字母、数字、下划线，且不能和节点输出字段冲突。
- `Input Fields`：在 `Selected Fields` 模式下使用，支持逗号或换行分隔，也可以从 n8n 输入数据面板拖拽多个字段。不存在的字段会被忽略。

`Input Fields` 需要填写字段路径，而不是字段值。中文字段或包含特殊字符的字段建议使用 bracket 写法。

`Input Fields` 示例：

```text
recordId, fields.domain, fields["中文字段"].text
```

也支持 n8n 常见的当前 item 路径写法：

```text
$json.fields["到期时间"]
={{ $json.fields["中文字段"].text }}
```

输出字段按用途分为：

- 域名：`asciiDomain`、`publicSuffix`
- 注册状态：`isRegistered`、`status`
- 时间：`dates`、`expiry`
- DNS：`nameservers`
- 查询来源：`source`
- 错误信息：`error`

`isRegistered` 是区分“已找到域名”和“权威来源返回未找到”的字段。

`.cn` 查询的 `source.protocol` 为 `whois`；RDAP 查询的 `source.protocol` 为 `rdap`。

查询成功或权威来源明确未找到时，`error` 为 `null`。无法判断注册状态时，`isRegistered` 为 `null`，并通过 `error.code` 输出原因，例如 `TLD_NOT_SUPPORTED`。

RDAP fallback 是内部可靠性机制，不是节点选项。fallback 成功时，`source.type` 为 `fallback`，`source.url` 记录本节点请求的 fallback 入口 URL。

`expiry.expiresAtTimestamp` 是 `dates.expiresAt` 对应的毫秒时间戳；没有有效到期时间时为 `null`。`expiry.daysUntilExpiration` 使用当前节点执行时间和到期时间计算，按完整天数向下取整。本节点不输出提醒阈值；提前多少天提醒应由后续 n8n 节点处理。

错误处理：

| 错误码                              | 含义                                          |
| ----------------------------------- | --------------------------------------------- |
| `INVALID_INPUT`                     | 输入不是可支持的域名、子域名或 HTTP(S) URL    |
| `TLD_NOT_SUPPORTED`                 | 域名已标准化，但该 TLD 没有项目支持的查询路线 |
| `RDAP_BOOTSTRAP_UNAVAILABLE`        | IANA RDAP bootstrap 请求失败或响应结构异常    |
| `RDAP_SOURCE_UNAVAILABLE`           | RDAP 查询来源 HTTP、网络或服务不可用          |
| `RDAP_RESPONSE_PARSE_FAILED`        | RDAP 响应无法按 domain object 解析            |
| `CNNIC_WHOIS_UNAVAILABLE`           | CNNIC WHOIS 连接、超时或网络不可用            |
| `CNNIC_WHOIS_RATE_LIMITED`          | CNNIC WHOIS 返回限流信息                      |
| `CNNIC_WHOIS_RESPONSE_PARSE_FAILED` | CNNIC WHOIS 响应无法按域名记录解析            |

输入格式错误默认抛出节点错误。已经成功标准化域名后的查询阶段错误，在 n8n `Continue On Fail` 开启时会进入结构化 `error` 输出。

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
