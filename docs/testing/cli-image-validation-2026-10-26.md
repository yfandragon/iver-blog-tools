# Codex / Antigravity CLI 生图最小实测

日期：2026-10-26（Asia/Shanghai）

结论：Codex 已通过非交互调用、真实图片取回、解码及临时本地网页显示。Antigravity前两次测试未取得图片，但2026-10-27按作者截图复核后，使用`gemini-3.8-flash-high`并委派原生`image-generator`子代理，实际生成并取回了JPEG。之前测试提示词明确禁止委派，因此只测了主代理直接调用生图工具的路径；截图显示的路径与本次成功验证的子代理路径不同。由于模型档位和是否委派同时变化，不能把成功单独归因于其中一个变量。正式工具仍需处理子代理异步完成、真实图片定位与回收，尚未实现博客集成。

## 授权与执行范围

作者回复“可以，你帮我验证吧”，同意先验证两个CLI各一张测试图。沿用本机既有登录，每个入口仅启动一次非交互任务，要求最多生成一张；失败不自动重试、不切换额外付费API。

两者使用同一通用场景：绿草坡、一棵树、小溪、远山、晴朗天空，横向二维手绘插画，无人物、文字或水印。这是连通性测试，不是任何文章封面或站点场景候选，不包含文章导入、关联、裁切或发布验收。

任务根目录：`/private/tmp/iverblog-cli-image-20261026-ruv7xadd/`。脚本、提示词、CLI事件、退出结果、校验数据、截图均保存在其中；临时目录未纳入博客Git，后续可能被系统清理。本文件保留可长期回查的结论和关键数值。

## 本机入口与单轮结果

| 项目 | Codex | Antigravity |
| --- | --- | --- |
| CLI版本 | `codex-cli 0.163.0-alpha.11.2` | `agy 1.4.7` |
| 本次推理模型 | `gpt-6.1-sol`，本次覆盖推理强度为`low` | `gemini-3.8-flash-low` |
| 调用方式 | `codex exec --json` | `agy -p --output-format stream-json` |
| 登录/可用性依据 | `codex login status`显示`Logged in using ChatGPT` | `agy models`成功列出所选模型，headless任务成功返回模型回复 |
| 外层进程退出码 | 0 | 0 |
| 脚本计时 | 64.13秒 | 10.00秒 |
| 完成时间（北京时间） | 17:45:08 | 17:44:23 |
| 实际图片 | 1张PNG，已取回和查看 | 任务目录无图片，事件未记录工具调用 |
| 本地网页显示 | 临时页面实际显示图片 | 无图片可供验证 |
| 本次结论 | 最小链路通过 | 产物验证未通过，原因待排查 |

这些结果只针对本机版本、账户和本次固定模型/提示词，不代表所有模型或未来版本。没有查询或计算具体额度/费用，不报告精确消耗。

## 实际命令

下列命令由临时Python执行器启动，工作目录分别为任务根目录下的`codex/`、`antigravity/`。此处`<…>`为本次任务文件路径/提示词占位，不能原样执行。运行这些命令会请求模型，不是只读检查。

```sh
codex exec --ephemeral --skip-git-repo-check --sandbox workspace-write \
  --model gpt-6.1-sol -c 'model_reasoning_effort="low"' \
  --json --output-last-message <codex/final.txt> -

agy --log-file <antigravity/runtime.log> \
  --model gemini-3.8-flash-low --output-format stream-json \
  --print-timeout 6m -p <prompt.txt完整内容>
```

Codex提示词从stdin传入；Antigravity使用`-p`参数。各自`started.json`和`prompt.txt`保存本次参数与完整提示词，执行器拒绝对已有`started.json`的入口重复启动。未修改全局默认模型、登录、代理或CLI配置，未安装依赖。CLI按正常运行方式维护自身运行记录。

沙盒初次执行`agy models`不能绑定loopback临时端口，报`bind: operation not permitted`；获准正常运行权限后模型目录读取成功，不能将沙盒限制视为账户不可用。CLI任务及临时loopback预览服务在获准的运行权限下执行。

## Codex产物证据

- 最终文件：`codex/hillside-stream.png`，1672×941，RGB/8bit，2,874,904字节。
- SHA-256：`7784f63ff81e24a51f8d9a4222adb9096a1c36073490b367cb50ef21f61725bb`。
- 校验PNG签名、IHDR尺寸、4个PNG块的CRC，并成功解压像素数据；`sips`独立识别格式和尺寸。已实际查看图片，内容符合本次通用测试场景。
- 文件与该CLI会话的托管原图逐字节一致。原图位于`/Users/duanyifan/.codex/generated_images/01a17798-7b57-7030-958d-45201eace147/exec-6a80502b-63f3-4a79-81e3-bb259f02b1c2.png`；CLI事件记录了将该文件复制到本次任务目录并检查格式的操作。
- CLI最终回复报告`tool_used: image_gen.imagegen`、`image_model: null`。JSON事件未包含独立的图像工具调用明细，因此工具名称标为会话报告；真实文件是本轮成功依据，实际底层图像模型未确认，不把推理模型名当作图像模型。
- 本地临时服务只监听`127.0.0.1`，仅提供`/`测试页和`/image`这张PNG，未提供目录浏览或博客文件。浏览器请求`/image`得到200和2,874,904字节，已在Codex内置浏览器实际看到图片并保存`browser-preview.png`。
- 临时浏览器页已关闭，服务已停止；本次临时预览地址不是持续运行的正式工具入口。

## Antigravity未通过及矛盾证据

初始化事件实际包含：`model: gemini-3.8-flash-low`、`permission_mode: request-review`，其`tools`清单包含`generate_image`。

随后只有`user_input`和`agent_response`类型的step事件，没有记录`generate_image`或其他工具执行；模型回复如下错误，图片路径为空：

```text
The built-in 'generate_image' tool is unavailable in the current tool declarations.
```

外层`result.status`却为`SUCCESS`、进程退出0；它们代表任务正常结束，不能代替图片验证。首轮只能确认这组条件下未取得图片，尚不能认定Antigravity整体不支持生图。首轮测试未绕过默认权限或切换模型；随后第二次复测另见下文。

## Antigravity复测：模型连接恢复，生图工具仍不可用

时间：2026-10-26 18:47（Asia/Shanghai）。作者说明刚才代理不稳定，并明确要求再次测试。

- CLI仍为`agy 1.4.7`，使用同一个`gemini-3.8-flash-low`与同一提示词，仅发起这一次额外的图片任务；没有更换模型、自动重试或修改代理/认证配置。
- 先运行`agy models`成功获取六个模型，包含所选型号；随后headless模型在约17.7秒内正常返回。由此可确认本次模型目录及推理调用有响应。
- 初始化事件工具清单仍列出`generate_image`；模型回复为`The built-in 'generate_image' tool is unavailable in the current toolset.`，事件中没有该工具的调用，任务目录下没有PNG/JPEG/WebP文件。外层exit code为0、事件`result.status`为`SUCCESS`，但图像状态为失败。
- 本轮网络路径正常响应而生图工具再次不可调用，因此当前证据更指向headless工具接入或声明传递问题；这属于基于日志的判断，尚未定位根因，也不外推Antigravity其他模式/版本。两次尝试仍不足以说产品整体不支持生图。
- 复测材料在`antigravity-retest/`：`prompt.txt`、`attempt.py`、`started.json`、`events.jsonl`、`execution-result.json`、`runtime.log`、`stderr.log`。本次没有实际图片，不进行浏览器预览。

## Antigravity复核：委派image-generator后实际生成

日期：2026-10-27（Asia/Shanghai）。作者提供的截图显示所选模型为`Gemini 3.8 Flash High`，并由`Anime Landscape Generator (image-generator)`子代理生成图片。复核前两次失败测试的执行说明后发现，二者都使用`gemini-3.8-flash-low`，并在提示词/临时`AGENTS.md`中禁止主代理委派；因此它们没有测试截图所示的代理路径。

- 经作者当前请求授权，仅发起一次受控复核：指定`gemini-3.8-flash-high`，允许主代理定义并调用一个原生`image-generator`子代理，只生成一张通用山坡溪流图，不改博客、不重试、不改CLI配置。
- `stream-json`根会话记录了`invoke_subagent`，子会话类型为`image-generator`、角色为`Anime Landscape Generator`；子会话日志中有一次`generate_image`工具调用和完成消息。实际JPEG出现在Antigravity CLI托管的该会话目录，并复制到本次临时任务目录供验证。
- 真实图片是JPEG，1376×768，`sips`和`file`识别格式/尺寸成功，图片已实际查看。它证明本机这条headless委派路径可以产出图片。
- 父级`agy -p`返回`SUCCESS`，但文本仍是“等待子代理完成”，没有直接把图像路径作为最终响应交回。因此集成端必须跟踪子代理完成状态、用会话信息定位托管文件、验证并复制到当前任务输出目录；退出0或父级文字不能单独当作图片成功。
- 这次与前两次相比同时更换了模型档位并允许委派，不能从三次结果中隔离出唯一原因。最明确的测试缺口是先前禁止了截图所示的子代理流程；模型档位也与截图不一致。未发现本机持久化的`image-generator`定义，但Antigravity支持会话内定义临时子代理。
- 官方[Headless CLI文档](https://www.antigravity.google/docs/cli/headless/)说明可选择模型/agent并以JSON事件脚本化；[Subagents文档](https://www.antigravity.google/docs/subagents/)说明可通过`define_subagent`创建会话内临时子代理，再用`invoke_subagent`委派。
- 作者随后要求首版方案支持Codex与Antigravity两种CLI；Antigravity的本地应用包装仍须满足官方许可/账号计划边界。官方[FAQ](https://www.antigravity.google/docs/faq)指出第三方软件/工具访问Antigravity可能违反服务条款，并说明消费者计划不支持在第三方应用中包装`agy`。若未确认获准方式，不能启用该适配器。

本次完整临时材料保存在`/private/tmp/iverblog-agy-agent-probe-20261027/`，包括单次执行器、提示词、事件流、子代理日志索引、验证过的JPEG副本和执行结果。没有运行浏览器服务；本次验证目标仅为找出生图路径和取得真实文件，不是正式页面验收。

## 对工具设计的影响与剩余门槛

- Codex可作为首条已验证的生图接入基础：指定本次推理模型、请求生成、取回真实图片，再由本地服务提供给页面。该结果不等于正式适配器、任务队列或博客预览已完成。
- 作者于2026-10-27曾将首版收敛至Codex CLI，随后再次要求方案支持Codex与Antigravity。两次Antigravity直接调用无图仍作为历史记录，后续一次委派子代理的复核则取得真实JPEG。详见[讨论记录](../product/discussion.md)。
- 双CLI仍是方案目标而非已实现能力。Antigravity需要子代理等待、托管文件回收和格式校验；同时须先确认官方许可与账号计划，因为FAQ指出第三方工具访问可能违反服务条款，消费者计划不支持第三方应用包装`agy`。
- 后续接入必须同时检查CLI结果与真实产物，避免将本次Antigravity的退出0误判为生图成功。若CLI先写入托管目录，由接入层校验来源并复制到本次任务允许的输出目录。
- 尚未验证文章理解/元数据、正式封面提示词、资源派生与关联、目标博客真实预览、用户选择不同模型、发布失败恢复或Cloudflare部署。未创建独立工具项目，未修改博客源码、文章或图片，未commit/push/deploy。

完整临时证据索引为`test-summary.json`；对应入口目录内有`prompt.txt`、`started.json`、`events.jsonl`、`execution-result.json`，Codex另有`final.txt`、`image-validation.json`，Antigravity另有`runtime.log`。浏览器请求证据为`preview-requests.jsonl`，测试服务代码为`preview_image.py`。
