用途：规定后续实现的代码、注释、依赖和验证标准。

范围：src/与test/的实现约定及其验证基线；本文本身不授权修改工具配置。

# 开发约定

## 已核查基线

package.json为type:module，NestJS 12；tsconfig使用module/moduleResolution=nodenext、strict、isolatedModules、experimentalDecorators、emitDecoratorMetadata，target=ES2023。
当前lockfile解析Nest12.1.2、TypeScript6.0.3、Vitest4.1.11、Vite8.3.4、oxlint1.87.0；未来升级必须按整套工具链验证，不照抄旧版Vitest/esbuild限制。
源码相对import写.js，类型专用用import type；用于Nest DI/DTO反射的class不能错误地只做type导入。ESM路径用import.meta.url，不依赖__dirname/require。
Prettier现有singleQuote=true、trailingComma=all；TypeScript两空格缩进，函数/变量camelCase，class/interface PascalCase，文件kebab-case，常量SCREAMING_SNAKE_CASE。

lint脚本为`oxlint src/ test/`，只检查src/与test/，自动加载根目录的`.oxlintrc.json`，其中typescript/no-explicit-any为error。该文件不设plugins字段：设置plugins会覆盖默认的unicorn/typescript/oxc插件集，使规则变少。no-floating-promises需要类型信息，必须加`--type-aware`并安装oxlint-tsgolint，当前未启用，因此“Promise不得悬空”仍由代码评审把关；类型感知检查需要新增oxlint-tsgolint依赖，另行申请批准。
tsconfig.build.json排除test/与`*spec.ts`，Vitest只转译不做类型检查；测试代码的类型检查使用`-p tsconfig.json`，见[测试策略](testing.md#api-e2e与命令)。

## 必需注释

- 每个模块文件顶部一行中文用途注释。
- 每个函数/方法/类必须有JSDoc：用途、全部参数@param、返回@returns、可能抛出的异常@throws；无参数/无返回/不抛异常明确说明“不适用”，不编造异常。
- TS interface/type/enum均有用途及字段含义JSDoc；泛型必须含@template。
- 公共DTO字段写单位、默认、null语义、边界；生成OpenAPI时同步明确必填性。
- inline comment只解释非显然逻辑、竞态窗口及异常契约，不逐行复述语法。
- 每文件≤500行，包括注释；超出按单一职责拆分，不用压缩一行掩盖规模。
- 注释中文，代码标识符英文；没有TODO/FIXME/占位实现。

## 错误、日志与类型

禁止any；外部JSON先unknown后验证。不得用非空断言绕过协议缺失。Promise必须await、返回或显式处理错误，不得悬空。悬空Promise当前不由lint检查，见[已核查基线](#已核查基线)。
可恢复错误在最近能决定行为的层转换并记录，不多层重复打印；不可恢复DB/密钥/配置错误fail-fast向上抛出。
日志在入口参数、关键分支、异常处记录脱敏上下文，不在文件循环、chunk、限速器热路径打印。不静默catch；清理失败也要记录并保留必要的后续责任。
业务结果不能只用boolean：明确succeeded/failed/unknown及errorCode，但只使用[规范状态](../design/state-machines.md)，不新增同义状态。

## 依赖边界

已批准：@nestjs/config、@nestjs/swagger、@nestjs/jwt、@nestjs/schedule、cron、class-validator、class-transformer、undici、picomatch及必要类型、drizzle-orm 0.45、better-sqlite3固定版本、drizzle-kit仅dev。
使用Node crypto/stream、Nest JSON ConsoleLogger、简单semaphore/token bucket。保留已有reflect-metadata/rxjs；不增加Passport/Pino/Redis/BullMQ/第二套验证库。
所有新第三方依赖仍需项目维护者批准；不能因暂时类型错误自行引入插件。M0已精确固定drizzle-orm 0.45.1、better-sqlite3 13.0.3与drizzle-kit 0.31.8（dev），并在Node 22.23.3上验证加载、PRAGMA与迁移；better-sqlite3随包附带各平台预编译二进制，无需放开pnpm构建脚本。升级须重新核对peerDependencies并按整套验证；若兼容验证失败，在[实施细化记录](implementation-decisions.md)更新选择并取得确认，不擅自换存储方案。原生依赖需匹配Node24及Debian架构。已批准的包类别不等于允许任意未来大版本。
如直接import cron，必须直接声明依赖，不依赖pnpm传递提升。数据库结构迁移由工具（`pnpm run db:generate`）生成并审核：schema分文件并保留NodeNext的.js相对引用，drizzle-kit 0.31直接读取TS时无法解析（上游issue #2705），因此经维护者确认，drizzle.config.ts读取编译后的dist/database/schema.js，脚本先`nest build`再`drizzle-kit generate`。需要数据转换的重构只在新前向迁移中补充显式转换与失败校验，不修改已应用SQL及其元数据；schema元数据仍由工具生成。整个迁移目录（含meta/_journal.json）随发行版分发。

## 反过度设计

不加本地文件索引、hash指纹、跨Run目录快照、持久化锁、审批签名、通用规则引擎。run_config副本服务历史与运行一致性；unknown记录服务已知提交窗口，不能扩张成任意后台对账系统。
只实现已有模式；不为单一实现造interface/factory。测试验证行为，不测试私有类名、颜色或代码镜像。不要为覆盖率添加无价值测试。
Nest模块依赖按[架构](../design/architecture.md)保持无环：不使用forwardRef，不建AppModule级协调器；执行位、队列、路径占用、隔离检查、扫描间隔、Job带宽桶只由CoordinationModule持有。

## 验证与修改纪律

按[测试策略](testing.md)运行范围相关命令。
删文件、推远程、修改环境/CI/DB、修改工具配置（含package.json脚本、lint与vitest配置）等操作须先取得项目维护者确认；文档中写有的计划不等于授权执行这些操作。
PR说明具体问题、最终行为和实际测试，附命令输出并列出未运行的测试，不虚构实测。行为变更先更新设计文档再改实现，禁止以新造的测试/文档证明某项扩展必需。
