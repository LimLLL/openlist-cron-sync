用途：定义脱敏配置导出和原子配置导入的可移植格式。

范围：配置迁移，不是数据库备份；不包含Run、Operation、unknown责任或管理员身份。

# 配置传输

## ExportDocument v1

形状为{formatVersion:1,exportedAt:Time,instances:ExportInstance[],jobs:ExportJob[],notificationChannels:ExportChannel[]}。
ExportInstance={id,name,baseUrl,auth:{mode,username:string|null,hasSecret:boolean},limits,downloadMode}。
ExportChannel={id,name,type:'webhook',url:string,hasSecret:boolean,enabled,events,needsUrlReview:boolean}。导出时url只写原URL的源站部分`scheme://host[:port]`。needsUrlReview为已保存的needs_url_review与本次是否截去非根path/query的逻辑或；不能因为上次导入只剩origin，就在再次导出时清除尚未完成的复核要求。
ExportTarget=EndpointView+{id,position,mode,createMode:'relay'|'server_copy',deleteLimits:完整值}；createMode为必填的逐目标配置。
ExportJob使用JobView的配置字段及id，不含Entity时间、archivedAt；source/targets仅带hasPassword，不带password。引用instanceId和notificationChannelIds保留导出UUID；Job顶层不含createMode。同一Job允许混合创建方式，导入时按最终引用校验每个server_copy Target与source的Instance ID相同，不自动切换。
导出只包含活动配置；实例token/password、路径密码、Webhook secret、JWT key、master key、管理员hash一律省略，不输出******占位符。
Webhook URL按秘密处理：很多接收端把密钥放在path中（例如Bark、ServerChan），query也可能含用户放入的secret，因此导出删除path和query，只保留源站，并按上式设置needsUrlReview。
hasSecret/hasPassword是提示，绝不是可恢复秘密。Export不是完整备份，恢复运行责任必须使用DB+keys备份。

## ImportRequest

{mode:'create'|'update',document:ExportDocument,secrets?:ImportSecrets,dryRun?:boolean=false}。
ImportSecrets={instances?:Record<exportId,string>,pathPasswords?:Record<endpointKey,string|null>,notificationChannels?:Record<exportId,string>}。
endpointKey格式source:<jobId>或target:<targetId>，只引用document中对象；所有map未知key返回400。
管理员可以在导入前把document中的url改回完整URL，并把needsUrlReview改为false。导入按document持久化needs_url_review（不重新推断）；导入的channel一律disabled。
needs_url_review=1期间，启用该channel返回409 URL_REVIEW_REQUIRED；任何提供url的PATCH都会清除该标记，视为管理员已复核。
Body≤10MiB；formatVersion非1返回400 IMPORT_VERSION_UNSUPPORTED。所有对象id、引用、枚举、权限无关静态字段先验证，再单事务提交；失败不部分导入。

## create与update

| 条件                       | create                                        | update                                                                             |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| ID                         | 为全部对象及targets分配新UUID，返回映射       | 保留ID，要求所有ID已存在且未归档                                                   |
| 相同名称                   | 允许，名称不是身份                            | 不按名称匹配                                                                       |
| 外部引用                   | 必须在document中                              | 可引用document或本地已有活动对象                                                   |
| 缺instance/channel secret  | 保存NULL，authState=untested/channel disabled | 保留已有secret；切换auth mode/username却缺secret则400                              |
| 缺pathPassword             | 新对象无密码                                  | 保留已有密码                                                                       |
| pathPassword=null          | 无密码                                        | 显式清除                                                                           |
| channel url                | 保存document.url及needsUrlReview              | needsUrlReview=true且url等于本地URL的源站时保留本地完整URL及本地标记；否则同create |
| enabled                    | Job和channel一律false                         | Job和channel一律false                                                              |
| 当前有活动Run/未决身份责任 | 不影响其他对象                                | 与普通PATCH相同409，整批不提交                                                     |
| document未包含本地对象     | 不处理                                        | 不删除、不禁用该对象                                                               |

创建缺secret的对象可以浏览配置，但不能执行依赖它的Job；后续通过普通PATCH补secret、连接测试并显式启用。
不把hasSecret=false解释为删除已有secret。API不接受******作为保留指令，提交该字面值视为无效secret。
update的targets数组整体替换语义与JobPatch相同；已有target id必须是对应未归档Job的当前成员（archived_at为NULL本身不足以证明可更新）；删除旧target只能将其移出成员集合（写archived_at），不能损坏旧历史。

## ImportResult

{dryRun:boolean,created:{instances:integer,jobs:integer,notificationChannels:integer},updated:{instances:integer,jobs:integer,notificationChannels:integer},idMap:{instances:Record<oldId,newId>,jobs:Record<oldId,newId>,targets:Record<oldId,newId>,notificationChannels:Record<oldId,newId>},warnings:{code,objectId,message}[]}。
dryRun=true只验证并给数量/warnings，idMap各项为空，避免提供虚假的已保留ID；不访问OpenList、不创建密钥或远程文件。
非dry-run提交后仅刷新内存配置和cron（导入Job均disabled），不启动Run、不发送测试webhook。HTTP200表示配置事务完成。

## 导入边界

导入权限仅管理员；错误和日志不回显秘密值，包括Webhook URL的path与query。脱敏URL或缺密码导致新环境不可运行是预期，必须通过warnings解释；needsUrlReview=true的channel给出code=URL_REVIEW_REQUIRED的warning。
导出与导入不转移unknown职责；不能用配置导入替代有状态迁移。见[部署](../design/deployment.md)。
