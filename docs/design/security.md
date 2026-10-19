用途：规定管理员认证、秘密存储、网络出口和日志保密边界。

范围：单管理员自托管MVP；不实现多租户、RBAC、2FA托管或秘密管理外部服务。

# 安全

## 管理员

首次数据库无admins时读取ADMIN_USERNAME/PASSWORD，已有管理员时两者不读取也不校验；无密码生成至少24字节随机base64url密码，只在首次启动时直接写入stderr一次（不经过结构化日志器，这是“日志不含秘密”的唯一例外），mustChangePassword=true；提供了ADMIN_PASSWORD则不生成、不输出、不强制改密。注意容器的stdout/stderr通常会被日志系统收集，这个初始密码因此会留在容器日志里；强制首次改密是对此的缓解。
忘记管理员密码时的离线重置：停止服务并备份数据目录，删除admins表中的唯一一行，再带ADMIN_PASSWORD启动，服务会按首次初始化重新创建管理员。由于token_version从1重新开始，同时更换JWT key（或等待ADMIN_JWT_TTL_SECONDS过期），使旧会话失效。MVP不提供在线重置接口。
随机密码JWT在改密前只允许me/change-password；改密需要currentPassword，成功tokenVersion加1、mustChangePassword=false，旧JWT立即失效。
密码采用Node异步scrypt：N=131072、r=8、p=1、salt随机16bytes、derivedKey32bytes、maxmem=201326592bytes；编码scrypt$v1$N$r$p$saltBase64$keyBase64。
比较用timingSafeEqual，参数只接受服务支持的封装值，不能从恶意数据库字段请求无限内存。scrypt并发2，登录按IP和username限流；窗口默认900s、5次失败。成功清除该账号计数但不解除其他IP的限流。
JWT HS256，独立32bytes secret；claims={sub:'1',ver:tokenVersion,iss:'openlist-cron-sync',aud:'admin-api',iat,exp}；固定alg/iss/aud校验，时钟容差30s。
无refresh token、无注册。浏览器未来接入前不默认放开CORS；MVP不允许任意Origin读取管理API。TRUST_PROXY_HOPS必须与部署匹配，不能信任所有X-Forwarded-For。

## 秘密加密

AES-256-GCM、每次随机12bytes nonce、16bytes tag；封装JSON={v:1,nonce,tag,ciphertext}，base64编码binary字段。
AAD=utf8(tableName + ':' + recordId + ':' + fieldName + ':v1')，防止密文搬到另一字段后仍可解密。snapshot是独立字段，重新加密，不直接复制AAD绑定的密文。
加密实例token/password、endpoint路径密码、Webhook完整URL与secret（推送服务常把key放在URL路径里）、需要恢复的短期secret snapshot；管理员密码只hash不加密。Webhook在API与导出中只显示scheme://host[:port]。
key由环境或/data/keys.json提供，目录0700、文件0600、容器非root。启动时把数据目录、spool目录和keys.json自身（非递归）收紧到上述权限；目录可以是符号链接，作用于解析后的目录；无法收紧即启动失败。来源优先级与生成规则见[配置](../reference/configuration.md#密钥优先级)。已有密文但缺key时fail-fast，不自动生成替代key；启动时在写入任何ENC值之前试解密已有密文，key不匹配以KEY_MISMATCH退出，避免数据库混用两把key。
密钥与DB共同泄露时不提供保护；威胁模型是单独数据库/导出泄露。文件路径和名称也可能敏感，日志默认不打印完整路径，只保留run/operation id和相对路径的必要错误展示。
MVP无在线master-key轮换API；维护窗口停止服务，备份DB+旧key，用未来专用迁移工具全量重加密后切换，不能只改环境key。该工具未实现前用备份恢复或重新录入配置，不宣称支持轮换。

## 网络边界

管理员可配置内网OpenList和Webhook；允许http(s)私网地址，这是自托管管理权限，不能当公共URL代理开放。拒绝其他scheme、URL userinfo、非法端口、控制字符。
OpenList API、multipart/put和Webhook不自动跳转；下载按[relay](relay.md)逐跳校验并剥离跨域凭据。禁用TLS校验不是MVP配置项；自签证书用受信任CA部署。
不向非管理员暴露浏览、连接测试或通知测试。API文档（Swagger UI与openapi.json）在API_DOCS_ENABLED=true时免认证提供：项目开源，文档只含公共DTO，没有保密价值；实际API调用仍需管理JWT。对任意第三方HTTP响应设置大小和时间上限，不返回原始body给调用者。
relay的spool含实际文件内容（crypt源下载后即为明文）：目录0700、文件0600，备份排除，启动时清空；清理是普通删除，不承诺安全擦除。
运营者可使用宿主防火墙限制云元数据等出口；MVP不添加自研DNS防火墙或伪称完整SSRF隔离。

## 脱敏与错误

日志只记录已筛选的参数、分支和错误。禁止Authorization、password、secret、sign、raw_url、storage.addition、Webhook URL的path与query。错误摘要最多2048字符，移除控制字符；其中的URL仅保留origin，不能只删query而留下含秘密的path。认证与Webhook错误使用本服务生成的状态摘要，不转发可能回显凭据的上游body。
远程可恢复错误就近记录一次并转换为结构化结果，重试每次不重复打印巨量body。循环/高频chunk不打印，定期聚合计数。不可恢复配置、DB、密钥错误向上抛出，不空catch。
API DTO whitelist并拒绝未知字段，数值边界和路径段验证在业务入口进行；数据库使用Drizzle参数化查询，不拼接用户SQL。
OpenAPI仅含公共DTO；不要从数据库实体自动暴露secret_enc。导出规则见[导入导出](../reference/import-export.md)。

## 来源与限制

[OWASP密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)支持scrypt参数选择；[OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)用于界定URL和重定向风险。单管理员可主动连接私网是明确权限，不承诺隔离被攻陷管理员。
