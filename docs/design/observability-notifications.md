用途：定义运行统计、结构化日志和可验证的Webhook协议。

范围：轮询进度、JSON日志、有界best-effort通知；不引入消息队列、SSE或外部遥测平台。

# 观测与通知

## 日志

Nest ConsoleLogger JSON模式，记录timestamp、level、context、message及params中的requestId/runId/operationId/instanceId、decision、errorCode。
入口仅记录脱敏后的参数，分支记录保护/重试/未知结果原因，异常记录一次归属明确的上下文。文件循环和传输chunk不打印；每5s最多聚合一次进度，SQLite进度更新最多每5s一次且终态强制保存。
不开debug也应看到Run接受、扫描结束、保护阻断、终态、认证阻断、远程 task 重新启动、spool写盘失败。缺少空间等不可恢复错误退出前记录原因。
webhook URL按秘密处理（Bark、ServerChan等把key放在path中）：日志只记录其origin（scheme://host[:port]），从不记录path或query。
统计形状见[API schemas](../reference/api-schemas.md)；操作详情分页，维护动作不改变旧Run同步Stats。

## 事件选择

自动事件仅run.succeeded、run.partial、run.failed。dry-run不发送自动通知；cancelled/interrupted不自动通知，仍可API和日志查询。这是MVP的取舍，不伪造failed来通知取消。
创建终态Run的同一SQLite事务内，逐个检查本轮配置（Run快照中的通知channel id）里的channel：只有当前enabled=true、未归档，且本事件类型在channel.events中，才创建delivery。ChannelCreate省略events时默认订阅全部三种事件（见[配置](../reference/configuration.md)）。channel在运行中被禁用、归档或取消订阅该事件时，不再为它创建新delivery。
delivery创建时固定加密的URL快照（url_snapshot_enc）和secret快照（secret_snapshot_enc）；之后修改、禁用或归档channel，不影响已创建delivery完成其有限尝试。
唯一(eventId,channelId)防止同一终态重复创建，但HTTP丢失响应会造成重复投递；不承诺exactly-once。

## Payload v1

```json
{
  "schemaVersion": 1,
  "eventId": "run:00000000-0000-4000-8000-000000000001:terminal",
  "type": "run.partial",
  "occurredAt": "2026-10-19T02:00:00.000Z",
  "job": { "id": "00000000-0000-4000-8000-000000000002", "name": "照片同步" },
  "run": {
    "id": "00000000-0000-4000-8000-000000000001",
    "status": "partial",
    "trigger": "manual",
    "dryRun": false,
    "startedAt": "2026-10-19T01:00:00.000Z",
    "endedAt": "2026-10-19T02:00:00.000Z"
  },
  "summary": {
    "succeededCreates": 10,
    "deletedForReplace": 2,
    "deletedAsExtra": 0,
    "failedOperations": 1,
    "unknownOperations": 0
  },
  "errorCodes": ["DELETE_LIMIT"]
}
```

字段固定如下，不增减；Time与Id的格式见[API schemas](../reference/api-schemas.md)的通用约定。

| 字段          | 类型                                                               | 规则                                                                                                                        |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| schemaVersion | 整数1                                                              | 固定                                                                                                                        |
| eventId       | string                                                             | Run事件为`run:<runId>:terminal`，同一Run所有渠道相同；测试为`test:<deliveryId>`                                             |
| type          | 'run.succeeded' \| 'run.partial' \| 'run.failed' \| 'webhook.test' | Run事件与run.status对应                                                                                                     |
| occurredAt    | Time                                                               | Run终态时间，等于run.endedAt；测试为delivery创建时间                                                                        |
| job           | {id:Id,name:string} \| null                                        | name取Run快照中的Job名称；测试为null                                                                                        |
| run           | RunPayload \| null                                                 | 测试为null                                                                                                                  |
| summary       | 五个非负整数                                                       | succeededCreates、deletedForReplace、deletedAsExtra、failedOperations、unknownOperations，取自Run终态Stats同名字段；测试全0 |
| errorCodes    | string[]                                                           | 去重、按字典序升序、最多20项；测试为[]                                                                                      |

RunPayload={id:Id,status:'succeeded'|'partial'|'failed',trigger:'manual'|'cron',dryRun:false,startedAt:Time|null,endedAt:Time}。dryRun恒为false，因为dry-run不发自动通知。startedAt在Run从未开始时为null，例如排队超时以QUEUE_TIMEOUT失败的Run仍会发run.failed。
errorCodes取以下非空错误码的并集：runs.error_code、每个逻辑动作最后一次attempt的operations.error_code、run_targets.block_reasons_json中的code、scan_issues.code。先去重，再按字典序升序取前20项；不放文件路径、秘密或原始错误消息。
body在首次投递前以UTF-8 JSON序列化，所有重试保持同一字节序列。

## 签名

- Content-Type: application/json。
- X-OpenList-Sync-Event-Id: eventId。
- X-OpenList-Sync-Timestamp: 当前Unix秒的十进制字符串，每次attempt更新。
- X-OpenList-Sync-Signature: `v1=`加小写hex HMAC-SHA256。
- 签名字节为 UTF8(timestamp + '.') 拼接原始body bytes，key为channel secret的UTF-8字节。服务生成的secret是base64url文本，接收方不再次base64解码。

接收方使用原始body验签，常量时间比较，建议接受±300s时间窗口，并按eventId幂等；eventId也在已签名body里。不得重新序列化body后验签。

## 投递

POST到解密后的URL快照，不跟随重定向；HTTP2xx成功。连接/网络、408、429、5xx在预算内重试；其他4xx和3xx直接failed。单次请求超时为NOTIFICATION_TIMEOUT_SECONDS；响应只消费最多64KiB摘要，不记录完整body。
总尝试次数为NOTIFICATION_MAX_ATTEMPTS（含首次，默认值见[配置](../reference/configuration.md)）。第1、2次失败后分别等待5s、30s；之后每次等待min(300s,30s×2^(attempt-2))并加±20%抖动（attempt为刚失败的尝试序号）；有效Retry-After优先。达到总次数仍未成功则failed。
服务重启：pending/sending的旧delivery统一failed（error_code=PROCESS_RESTART），不补发；本轮通知是best-effort。delivery与Run结果分离，通知失败不改变Run.status。
delivery终态时清除url_snapshot_enc与secret_snapshot_enc。关联Run的delivery随所属Run按[SQLite历史](retention.md#sqlite历史)规则整组清理（RUN_RETENTION_DAYS，存在未决责任时更久）；测试delivery（run_id为NULL）由每日历史清理在endedAt后30天删除（固定基线见[配置](../reference/configuration.md)）。
DeliveryView、错误信息和日志都不包含URL的path或query。同步任务不等待Webhook完成才释放路径占用。

## 用户可见风险

OpenList成功但云端稍后失败时，不撤销旧通知；后续扫描可能产生另一Run结果。后续 Run 或 task 维护不重发历史终态事件。

M3定期持久化relay字节并在本地收尾强制保存；强杀可能丢失最近一个进度周期，interrupted统计不承诺逐字节精确。没有每chunk数据库日志，也不据此增加续传索引。通知仍在M7实现。
