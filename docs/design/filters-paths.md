用途：定义路径、过滤、名称碰撞和类型冲突的确定性规则。

范围：纯规划逻辑；API传输编码见[OpenList集成](openlist-integration.md)。

# 路径与过滤

## 路径规范

endpoint.path采用账号base_path内的绝对形式，根为 /。输入禁止NUL、控制字符、反斜杠、独立的 . 和 .. 路径段；重复/尾部斜杠规范化，根保留 /。
OpenList的list/get对以“/@s”开头的请求路径（按字符串前缀，“/@sync”也算）改读分享命名空间，写接口却仍按账号路径处理，读写会指向不同对象。因此规范化后以“/@s”开头的endpoint.path保存时返回400；endpoint为根 / 时，根下名称以“@s”开头的条目在源和每个Target上都固定排除并保护（不列举、不复制、不删除）。
名称按JSON解码后的原始字符串比较，拒绝包含“/”或“\”、NUL、或等于.、..的异常条目，记录INVALID_NAME并保护所在目录。“\”也被拒绝，是因为OpenList在所有文件API及/d、/p路径中都把“\”规范化为“/”，含“\”的名字会让copy/move/remove作用到另一个对象。
不得trim文件名，不对URL字符串使用本地操作系统path.resolve。使用POSIX路径段连接。
INVALID_NAME的父目录保护禁止删除该父目录及祖先；不尝试访问非法名称所指路径。仅Target单侧出现此问题时，合法兄弟条目仍按普通规则比较与删除，不因此阻断整个Target的extras；源侧异常则按[原因码分类](state-machines.md#code-classification)阻断所有Target的extras。
包含关系是 a=b 或 b以a加/开头；根/单独处理。/a不包含/ab。
配置时同Instance内source和每个Target、Targets彼此均不能相等或包含；已知规范化相同baseUrl的不同Instance，先加accountBasePath再检查。未知basePath需连接确认，未连接Job不能执行。
若无法确定不同地址/挂载是否别名，记录部署前提，不构建底层文件指纹或探测写入。

## glob

- picomatch对相对endpoint根的路径匹配，无前导/；分隔符固定/，大小写敏感、dot=true。
- include=[]表示全部；否则任意include匹配。任意exclude匹配则排除，exclude优先。
- 不支持前导!的反选、gitignore规则顺序、跟随文件系统glob扫描；输入!规则返回400。
- exclude同时对文件和目录的相对路径（不带结尾/）测试；匹配到目录时剪枝并保护整个子树（源和每个Target都是），例如 `**/tmp` 排除任意深度名为tmp的目录及文件。
- 以/结束的exclude只匹配目录，并锚定在endpoint根，例如 `cache/` 只匹配根下的cache目录；需要任意深度时写 `**/cache/`。`*.log`不跨层：作为include只筛根下文件，作为exclude同时匹配根下文件与目录；任意深度写 `**/*.log`。
- include只筛选文件；不能因为目录不匹配 **/*.jpg 就不递归，也不决定是否创建目录。
- 目录被排除后不列举、不mkdir、不删除，也禁止删除其祖先。
- min/max包含边界；0字节正常；大小未知且存在大小条件时不能判符合，记录UNKNOWN_SIZE并保护同名目标。
- 同名源因大小过滤排除时，对应目标也保护，即使目标自己的大小通过过滤。
- 目标单侧extras只有自身路径/大小符合规则且源确认不存在时才可删除。

## 名称碰撞

比较使用原名；检测键采用 NFC(name).toLowerCase().normalize('NFC')，无locale参数，称为“已知简单折叠”，不宣称完整Unicode case-fold或存储命名等价。
同一目录出现不同原名但键相同，标NAME_COLLISION；检测集合包含源与该Target过滤前可见条目，避免先过滤后删除碰撞对象。

| 来源               | 处理                                           |
| ------------------ | ---------------------------------------------- |
| source内部         | 所有Target保护冲突名；目录冲突保护全部后代     |
| Target内部         | 仅该Target保护相关名称/后代                    |
| source与Target之间 | 仅该Target保护；不转换为新增小写名加删除大写名 |

过滤已剪枝子树不再枚举内部碰撞，因为整个子树已保护。上游ObjMerge隐藏的同名重复无法检测，属于已接受视图限制。
Windows尾随点/空格、Unicode多字符fold等未覆盖；非法目标名错误作为操作失败，不自行改名。

## 类型冲突

同名但is_dir不同，记录TYPE_CONFLICT，跳过并保护路径/子树；所有模式都不自动删除阻挡对象。Target其他不冲突文件仍可继续，但本Target的extras阶段禁用。
不存在目标目录可规划mkdir；目标list出错不能解释成目录不存在。只有成功父列表中缺名、且视图未被标为[可疑](deletion.md#可疑视图)，才建立缺失快速路径。

## 空目录

| syncEmptyDirs | 创建                                                                 | 清理                                                                                                         |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| false（默认） | 只为需要create文件的路径mkdir                                        | 从不删除目标目录；extras删除后可能留下空目录壳                                                               |
| true          | 每个未被排除、未受保护的源目录都在目标创建，即使其中没有可传输的文件 | 仅mirror：源中不存在、未受保护的目标单侧目录，在其中extras删除后自底向上清理，每个目录先refresh=true确认为空 |

include模式只筛选文件，不决定目录是否创建；匹配目录的exclude剪枝并保护该目录。目录不计入文件比例分子，但展示plannedDirectoryDeletes。
MVP删除按文件及已确认空目录执行，不将非空目录合并成一个move/remove，避免任务子树和过滤边界失真；完整子树整目录优化进入backlog。
空目录删除前refresh=true列出该目录，存在任何条目则skipped PRECONDITION_CHANGED，不递归清除；仍为空才remove。任何时候都不删除endpoint根。
