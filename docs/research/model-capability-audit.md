# 模型选择与图像产物能力核验

更新日期：2026-10-27（Asia/Shanghai）

状态：作者先确定首版只使用Codex CLI，随后又要求方案支持Codex与Antigravity。Codex通过生图、产物取回、解码和临时本地网页显示。Antigravity前两次使用Flash Low且测试禁止委派，未取到图；按作者截图对应的Flash High + 原生`image-generator`子代理路径复核后，成功生成、定位并解码JPEG。由于两项条件同时变化，未隔离出唯一原因。父级CLI响应仍未直接交回图片，异步子代理追踪与产物回收尚需适配。官方文档称消费者计划不支持第三方应用包装`agy`，且第三方软件访问可能违反条款；因此双CLI方案中的Antigravity适配器须先找到获准的账号/调用方式。详见[实测记录](../testing/cli-image-validation-2026-10-26.md)。正式工具尚未实现。

## 用户使用方式

作者说明，OpenCode主要使用Go套餐下的DeepSeek。当前按“调用入口=OpenCode CLI，模型服务=OpenCode Go，模型=该服务可用的DeepSeek型号”理解；不能因模型同属DeepSeek就把Go套餐与DeepSeek直连API视为同一凭据或计费渠道。

作者随后报告已测试DS没有生图能力，并决定首版先接Codex和Antigravity。该项为作者实测反馈，未提供需要Agent复现的命令/原始输出，本记录不冒称Agent完成DS实测。下方OpenCode资料保留为历史核验，暂不构成首版实现范围。

## 1. 工具可以指定本次模型

- [OpenCode run](https://opencode.ai/docs/cli/#run)支持 `--model` / `-m`，格式为 `provider/model`；`--format json`输出JSON事件。
- [模型加载顺序](https://opencode.ai/docs/models/#loading-models)明确优先使用命令行的模型参数，然后才是配置、上次选择或内置优先项。因此可以把本地页面选择转换为本次CLI参数，不要求用户每次到终端切模型，也不需要为此改全局默认配置。
- [OpenCode Go](https://opencode.ai/v2/docs/console/go/)是提供模型访问的服务；可选模型需以该使用者的配置、权限和实际可用列表为准。

示意命令，未执行模型请求：

```sh
opencode run --model opencode-go/deepseek-v4.1-flash --format json "根据文章准备封面描述"
```

上述ID在下方缓存中存在；此命令不证明该账户当前有权调用，也不表示该模型可以原生生成图片。

## 2. 多模态输入和图像输出是不同能力

本轮只读检查 `/Users/duanyifan/.cache/opencode/models.json`。文件修改时间为2026-10-24 16:35:29（本机时间），不是本轮刷新或服务端实时查询；它是模型目录缓存，不是账户授权清单。

| 服务商ID | 模型ID | 目录声明输入 | 目录声明输出 |
| --- | --- | --- | --- |
| opencode-go | deepseek-v4.1-flash | text、image | text |
| opencode-go | deepseek-v4-pro | text | text |

[DeepSeek Vision官方文档](https://api-docs.deepseek.com/guides/vision/)说明Flash可接收图片，完成描述、截图文字识别、图表分析，并以文字回答；[当前模型详情](https://api-docs.deepseek.com/quick_start/pricing/)也区分Flash的Vision支持与Pro未支持。不能从“DeepSeek”“多模态”或CLI能接图片推导它会输出封面图。

结论限定为当前核对的型号和接入信息：Go下这些DeepSeek型号不作为已确认的原生图像输出通道。OpenCode如另配置生图工具/MCP/API，可由模型调度该工具出图，但图像能力属于所接生图服务，不是给DS换一个CLI就增加的原生能力；本轮未核验任何这样的用户插件配置。

## 3. Codex和反重力的生图来自工具能力

- [OpenAI官方生图说明](https://learn.chatgpt.com/docs/image-generation)描述内置生图及在交互会话使用imagegen技能，并说明使用独立图像模型。该页面本身不是对本机版本、账户或 `codex exec` 生图成功的实测证明；本轮真实文件与网页读取证据另见实测记录，底层图像模型未确认。
- [Antigravity官方工具说明](https://antigravity.google/docs/hooks#interaction-and-media)列出 `generate_image`，可生成或编辑图像；[官方SDK多模态示例](https://github.com/google-antigravity/antigravity-sdk-python/blob/main/skills/google-antigravity-sdk/examples/getting_started/multimodal.md)也明确启用 `GENERATE_IMAGE` 工具。2026-10-26两次Flash Low直接调用时，CLI虽声明该工具，模型仍称不可用且没有图片；2026-10-27委派子代理的复核后来取得真实JPEG，详见下方补充证据。
- 后续复核确认：根会话若提示“禁止委派”只会测到主代理直接生图，无法覆盖UI中的专用agent流程。本机按`gemini-3.8-flash-high`调用`define_subagent`/`invoke_subagent`后，子代理日志记录了`generate_image`，并实际生成1376×768 JPEG；但根会话提前返回等待文字，集成器还需观察子代理完成并从Antigravity托管会话目录回收文件。[Headless CLI](https://www.antigravity.google/docs/cli/headless/)与[Subagents](https://www.antigravity.google/docs/subagents/)说明了这些执行机制。模型和委派方式同时变化，未能分离各自贡献。
- 官方[FAQ](https://www.antigravity.google/docs/faq)指出第三方软件/工具访问Antigravity可能违反服务条款，并说明消费者计划不支持在第三方应用中包装`agy`。本项目的本地前端/服务直接调用CLI，须先确认适用账号计划和许可方式；消费者计划下不得启用该调用。此约束不影响Codex适配器。
- dsh、OpenCode和Codex是执行入口，模型是入口调用的推理能力，图像生成工具又是另一项能力。界面不应把所有可选推理模型都标为可生图。

## 4. 图片如何回到本地页面（设计建议，未实现）

1. 每个生图接入明确约定本次任务的输出位置和产物标识。
2. 若CLI把图片保存成本地文件，工具读取并校验真实文件；如接口提供图像字节/base64或可获取的结果URL，由接入层转存为本次任务产物。
3. 校验文件在允许的任务目录内、格式可解码、尺寸合理；本地服务再把实际图片提供给本地页面预览。
4. 只有收到实际可解码的图像才报告成功。CLI退出0、文字说“图片已生成”、绘图提示词或Markdown链接均不能独立证明图片产物有效。

本轮Codex已验证调用到真实图片文件再到临时网页读取的最小链路；这证明该接入方向可行，不能据此承诺所有CLI、模型或套餐均已满足，也不等于正式工具页面与博客预览已经实现。

## 首轮最小验证方案（已执行）

以下步骤对应当时将Codex与Antigravity都列为首版候选时制定并执行的一轮验证，现保留作历史记录。作者之后曾短暂将首版范围收敛至Codex，现再次要求双CLI；后续正式验证应覆盖两种CLI，但Antigravity需先满足许可/计划条件并完成子代理产物回收验证：

1. 核对本机两个CLI的实际版本、非交互调用与模型参数，沿用既有登录；不改用户认证或代理配置。
2. 使用同一简单测试场景，各尝试生成一张图片；输出进入独立临时任务目录，不关联博客文章，不覆盖现有素材。单轮共两次生图尝试，失败先记录，不自动循环重试或切到额外付费API。
3. 获取本次任务的真实产物，验证文件存在、格式可解码、尺寸和路径有效，并实际查看图片；同时记录所选推理模型、生图工具和能确认的图像模型信息，无法确认的分开注明。
4. 确认接入程序能够读取图片并提供预览所需的数据；CLI生成文件和本地工具网页显示是两项证据，尚无网页时不报告后者通过。
5. 两个入口分别记录成功/失败与原因。若某入口的非交互生图不通，先给出具体缺口并调整接入方案，不用本聊天的imagegen结果代替，也不因退出码为0而跳过图片检查。

## 前期OpenCode只读命令边界（历史）

- `command -v opencode`找到 `/opt/homebrew/bin/opencode`；其符号链接指向 `../Cellar/opencode/2.1.2/bin/opencode`。这只是安装路径证据。
- 执行 `opencode --version` 时，程序试图打开 `/Users/duanyifan/.local/share/opencode/log/opencode.log`，被当前沙盒以 `EPERM: operation not permitted` 拒绝，退出1。该命令链后续的run/models帮助未执行；未把此错误解释为CLI或账户不可用。
- 该次OpenCode核验没有提权重试，没有读取认证文件或修改配置；使用官方文档和现有公开模型缓存继续核验，当时未发出模型请求或生成图片。此历史边界不替代后来获准执行的Codex/Antigravity实测。

## 已执行最小验证与下一步

- Codex CLI `0.163.0-alpha.11.2`，本次`gpt-6.1-sol`推理强度`low`，取得1672×941 PNG并通过解码、原图比对和临时浏览器显示；实际图像模型未确认。
- Antigravity CLI `1.4.7`的前两次Flash Low直接调用没有生成图片，且测试禁止委派；后来一次Flash High委派子代理复核中，子代理实际调用`generate_image`并写出可解码JPEG。模型档位和委派方式同时改变，尚不能隔离唯一原因。父级流没有直接回传文件，只报告等待子代理，因此正式集成需处理异步完成与托管路径回收。该能力结果当时未自动改变作者的Codex-only决定；作者随后明确要求双CLI方案，且Antigravity调用须满足官方许可/计划边界。
- 官方FAQ指出消费者计划下在第三方应用中包装`agy`不受支持，并警告第三方工具访问Antigravity可能违反服务条款；双CLI实现前必须先找到获准的账号/调用方式。
- 两个入口各启动一次任务，没有自动重试或切换额外付费API。临时网页和服务已关闭；博客源码、文章和资源未改动，未创建正式工具项目或发布。
- 首版计划实现Codex与Antigravity两种CLI适配器；Antigravity暂为有条件目标，只有在官方允许的账号计划/调用方式确认后才能启用，并需处理子代理异步结果。文章发布流程对两种入口共享，正式实现尚未开始。
