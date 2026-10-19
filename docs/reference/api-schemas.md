用途：定义REST公共数据形状、字段必填性、校验与序列化规则。

范围：供DTO和OpenAPI实现；状态enum仅引用[RunStatus](../design/state-machines.md#run-status)与[OperationStatus](../design/state-machines.md#operation-status)，默认值仅引用[配置](configuration.md)。

# API schemas

## 通用约定

文中形状的字段未标?均必填；可空写null，?只表示请求可省略。响应可空字段总是返回null，不随机省略。禁止未声明字段，400 VALIDATION_ERROR。
Id=应用生成的UUIDv4字符串；Time=RFC3339 UTC毫秒，例如2026-10-19T02:00:00.000Z；Size=0..9007199254740991整数。所有出参不含ENC、JWT缓存、sign、storage.addition。
Entity基础字段={id:Id,createdAt:Time,updatedAt:Time}。Page<T>={items:T[],page:integer,pageSize:integer,total:integer}；空页items=[]，total仍为总数。
List排序createdAt DESC,id DESC；operations按(runId,seq) ASC，seq是Run内从1开始的计划顺序（维护Operation取所属Run的下一个seq），见[执行表](../design/execution-tables.md)。相同请求的offset分页不承诺并发写入快照。
RunView/OperationView的error.code、stopReason、RunTargetView.blockReasons、ScanIssueView.code、authBlockReason等固定原因码登记在[固定原因码](rest-api.md#reason-codes)；HTTP错误code见同文件的HTTP表。

## Instance

InstanceCreate={name:string,baseUrl:string,auth:AuthInput,limits?:InstanceLimits,downloadMode?:'d'|'p'}。
AuthInput为判别联合：{mode:'token',secret:string}或{mode:'password',username:string,secret:string}。只有import可创建缺secret对象。
InstanceLimits={maxApiConcurrency?:integer,apiRequestsPerSecond?:integer,maxOutstandingTasks?:integer,maxDownloadConnections?:integer,maxUploadSessions?:integer,maxChunkConcurrency?:integer}。
InstancePatch={name?:string,baseUrl?:string,auth?:AuthInput,limits?:InstanceLimits,downloadMode?:'d'|'p'}，至少一个字段；嵌套limits按字段合并。auth整体替换，不接受掩码或secret:null。
InstanceView=Entity+{name,baseUrl,auth:{mode,username:string|null,hasSecret:boolean},limits:所有有效值,downloadMode,authState,authBlockReason:string|null,authBlockedUntil:Time|null,accountUsername:string|null,accountBasePath:string|null,accountRole:integer|null,accountPermissions:integer|null,lastTestAt:Time|null,openlistVersion:string|null,multipartEnabled:boolean|null,lastError:{code,message}|null,archivedAt:Time|null}。
accountUsername/accountBasePath/accountRole/accountPermissions是最近一次/api/me成功时记录的账号身份，两种auth mode都保存；身份不一致时不覆盖，authBlockReason=ACCOUNT_CHANGED。

TestRequest={retryAuth?:boolean=false}；TestResult={reachable:boolean,authenticated:boolean,account:{username,basePath,role,permissions}|null,warnings:{code,message}[],error:{code,message}|null}。测试失败仍200表示测试已完成；无认证权限执行请求返回401。
BrowseRequest={path:string,password?:string,refresh?:boolean=false,page?:integer=1,pageSize?:integer=50}。
BrowseResult={path:string,items:{name:string,size:Size|null,isDir:boolean,modified:string|null}[],page,pageSize,total,write:boolean,warnings:{code,message}[]}。不返回raw_url或sign。

## Endpoint、Job、Target

EndpointInput={instanceId:Id,path:string,password?:string|null,refresh?:boolean}；create缺password表示无密码，patch省略保留、null清除。EndpointView={instanceId,path,hasPassword:boolean,refresh:boolean}。
Filters={include?:string[],exclude?:string[],minSizeBytes?:Size|null,maxSizeBytes?:Size|null}。省略字段使用默认；完整View返回全部字段。
DeleteLimits={enabled?:boolean,maxCount?:integer|null,maxPercent?:integer|null}。
TargetInput=EndpointInput+{id?:Id,mode?:'incremental'|'mirror',deleteLimits?:DeleteLimits}。
JobCreate={name:string,source:EndpointInput,targets:TargetInput[],createMode?:'relay'|'server_copy',enabled?:boolean,cron?:string|null,timezone?:string,filters?:Filters,allowEmptySource?:boolean,syncEmptyDirs?:boolean,relayBandwidthLimit?:integer,timeoutSeconds?:integer,notificationChannelIds?:Id[]}。
JobPatch顶层字段任选且至少一项；source为EndpointInput各字段均可省略的补丁，filters按字段合并，合并后验证完整对象。targets数组决定完整目标集合：已有target用{id,...可选字段补丁}按字段合并，deleteLimits也按字段合并；新target不带id且必须提供instanceId/path。JobCreate的targets禁止指定id。外Job或归档target id拒绝。删除target归档旧行，不能重用id。
JobView=Entity+{name,source:EndpointView,targets:(EndpointView+{id,position,mode,deleteLimits:完整值})[],createMode,enabled,cron,timezone,filters:完整值,allowEmptySource,syncEmptyDirs,relayBandwidthLimit,timeoutSeconds,notificationChannelIds:Id[],archivedAt:Time|null}。
enabled=true要求所有实例/渠道secret齐全，endpoint身份已测试；不能通过enabled开启无法解析的路径。manual run也检查必要secret，但允许Job.enabled=false。

## Stats

所有字段非负安全整数：sourceFiles、sourceDirectories、targetFiles、unchangedFiles、filteredFiles、protectedFiles、plannedCreates、plannedReplacements、plannedExtraDeletes、plannedDirectoryDeletes、succeededCreates、deletedForReplace、deletedAsExtra、failedOperations、unknownOperations、skippedOperations、cancelledOperations、retryAttempts、plannedBytes、downloadedBytes、transferredBytes、actualDeletedBytes。
Run Stats对Target相关字段求和；sourceFiles/sourceDirectories只统计一次。filteredFiles统计源文件一次，各Target内部计数在target.stats中；unchangedFiles可跨目标相加。计划文件大小为逻辑bytes；downloadedBytes为relay下载字节（含续传），transferredBytes为relay上传字节（含chunk重传）；server_copy两者均为0，不伪造网络bytes。
plannedCreates包含new与replace所需的逻辑create数；plannedReplacements为其中替换子集。成功create/删除按逻辑目标路径计一次，重试不重复计文件；failed/unknown/skipped/cancelledOperations按每个必要逻辑动作的最后attempt计数，retryAttempts单列额外attempt总数。历史Run终态后计数固定。dry-run实际计数为0。

## Run与Operation

RunView={id,jobId,trigger:'manual'|'cron',scheduledAt:Time|null,dryRun:boolean,confirmDeletes:boolean,status:RunStatus,stats:Stats,stopReason:string|null,error:{code,message}|null,createdAt,updatedAt,startedAt:Time|null,scanCompletedAt:Time|null,endedAt:Time|null,deadlineAt:Time|null,queueDeadlineAt:Time,cancelRequestedAt:Time|null,recoveryDeadlineAt:Time|null}。
RunDetail=RunView+{config:不含秘密的固定Job/Instance配置,targets:RunTargetView[],issueCount:integer}；operations/issues另分页。
RunTargetView={id,targetId,config:固定Target公共配置,stats,sourceComplete,targetComplete,suspect,deleteBlocked,extrasBlocked,blockReasons:string[],observedTargetFileCount,plannedReplaceCount,plannedExtraCount,deleteBudgetCount:integer|null}。
deleteBudgetCount是保护检查时固定的本Target删除预算（计算见[文件阈值](../design/deletion.md#文件阈值)）；null表示不限，即deleteLimits.enabled=false或本Run confirmDeletes=true。
OperationView={id,runId,runTargetId,seq:integer,action,method,reason,status:OperationStatus,sourceInstanceId:Id|null,sourcePath:string|null,targetInstanceId:Id,targetPath:string,isDir:boolean,expectedSourceSize:Size|null,expectedTargetSize:Size|null,affectedFileCount:integer,affectedBytes:Size,retryOf:Id|null,causedByOperationId:Id|null,attemptNo:integer,task:{id,state:integer|null}|null,multipart:{uploadId:string,chunkSize:integer,state:string|null,attempt:integer|null,sourceStreamCompletedAt:Time|null}|null,bytesDownloaded:Size,bytesTransferred:Size,error:{code,message}|null,createdAt,updatedAt,submittedAt:Time|null,endedAt:Time|null,unknownSince:Time|null,unknownUntil:Time|null,quarantineReleasedAt:Time|null,quarantineReleaseReason:string|null,reobservedAt:Time|null,resolution:{kind:'observed'|'superseded'|'abandoned',note:string|null,resolvedAt:Time,runId:Id|null}|null}。
action/method/reason枚举与SQL相同，见[执行表](../design/execution-tables.md)。task只在server_copy时非null，只公开本服务创建的id，不含任务原始名称；multipart只在relay收到有效init响应后非null，state与attempt为最近一次观察到的OpenList原始值。
causedByOperationId只在error.code=REMOTE_TASK_CHANGED的维护Operation上非null，指向原Operation。reobservedAt是首个完成受影响父目录refresh=true读取的非dry-run Run写入的时间。resolution.note在kind=abandoned时为管理员reason，其他kind为null；幂等重复请求不覆盖已存note。
ScanIssueView={id,runId,runTargetId:Id|null,endpointRole:'source'|'target',instanceId,path,code,message,protectSubtree:boolean,createdAt}。

隔离状态（active / reobserve_required / clear）由status、unknownUntil、quarantineReleasedAt、resolution与reobservedAt派生，规则见[辅助状态](../design/state-machines.md#auxiliary-states)；不额外提供可写的quarantine.status。

## NotificationChannel与Delivery

ChannelCreate={name:string,type:'webhook',url:string,secret?:string,enabled?:boolean,events?:('run.succeeded'|'run.partial'|'run.failed')[]}。url为完整Webhook URL（http(s)，无userinfo，可含path与query）。enabled与events省略时取[通知渠道默认值](configuration.md#通知渠道默认值)；events必须是非空子集，只有订阅的事件才创建delivery。省略secret由服务生成32随机字节，201唯一一次返回secret；手工secret按UTF-8≥32bytes。后续GET仅hasSecret。
ChannelPatch={name?:string,url?:string,secret?:string,enabled?:boolean,events?:事件数组}，不接受null清除secret；导入可无secret且必须disabled。提供url即替换完整URL并清除needsUrlReview；needsUrlReview=true时请求enabled=true（且同一请求未提供url）返回409 URL_REVIEW_REQUIRED。
ChannelView=Entity+{name,type,urlOrigin:string,urlHasPathOrQuery:boolean,needsUrlReview:boolean,hasSecret:boolean,enabled:boolean,events,archivedAt:Time|null}。
urlOrigin=`scheme://host[:port]`；urlHasPathOrQuery表示完整URL含“/”以外的path或任何query。完整URL按秘密加密保存，任何响应都不返回。needsUrlReview来自导入（见[配置传输](import-export.md)）。
DeliveryView={id,runId:Id|null,channelId,eventId,eventType,status:'pending'|'sending'|'succeeded'|'failed',attemptCount:integer,nextAttemptAt:Time|null,httpStatus:integer|null,errorCode:string|null,createdAt,updatedAt,endedAt:Time|null}。

## 系统

Health={status:'ok'|'not_ready',database:'ok'|'error',schedulerReady:boolean}，不含秘密/路径。
Info={version:string,schemaVersion:integer,nodeVersion:string,singleProcess:true,activeRuns:integer,queuedRuns:integer,unresolvedOperations:integer,oldestUnresolvedAt:Time|null,spool:{dir:string,usedBytes:Size,availableBytes:Size,reserveBytes:Size},defaults:非秘密有效服务配置}。
导入导出形状见[配置传输](import-export.md)。
