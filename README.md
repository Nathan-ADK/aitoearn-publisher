# @nathan-adk/aitoearn-publisher

本地一键发布 npm 包与创建 GitHub Release 的独立 npm 包 / CLI。

**不依赖 aitoearn.cn 服务端 API**：所有操作都从本机直接调用 npm CLI 与 GitHub REST API。可以独立于 AiToEarn 项目使用。

## 安装

```bash
npm install -g @nathan-adk/aitoearn-publisher
# 或本地引用
bun add @nathan-adk/aitoearn-publisher
```

## 前置凭据

- **npm**：先 `npm login`（或使用 `NPM_TOKEN` 并配置 `~/.npmrc`）。
- **GitHub**：设置环境变量 `GITHUB_TOKEN`。fine-grained token 需 `contents: write` 权限；classic token 需 `repo` 权限。本工具**不依赖 `gh` CLI**，内置 `fetch` 直连 REST API。

## 用法

```bash
aitoearn-publisher --target npm|github|both --dir <path> [options]
# 未全局安装时
node src/cli.js --target npm|github|both --dir <path> [options]
```

主要选项：

- `--tag <tag>`：npm dist-tag，同时作为 GitHub Release tag（默认取 package.json version，加 `v` 前缀）。
- `--since <rev>`：changelog 起点，如 `v0.1.0`、`HEAD~5`。
- `--notes <file>`：从文件读取 Release notes（默认用本地 `git log` 生成的 changelog）。
- `--repo <owner/repo>`：GitHub 仓库；缺省从 `git remote get-url origin` 推断。
- `--draft` / `--prerelease`：Release 标记。
- `--asset <file>`：上传 asset，可重复。
- `--dry-run`（默认）：只打印将发送的请求，不实际发布。
- `--publish`：真实发布，必须显式指定。
- `--changelog-only`：只生成并打印 changelog。

退出码：`0` 成功 / `2` 用法 / `3` 校验 / `4` 凭据 / `5` 网络 / `1` 其他。

## 安全默认

默认 dry-run。只有 `--publish` 才会执行 `npm publish` 与 `POST /repos/.../releases`。npm 发布前始终执行 `npm pack --dry-run` 预检。

## 库用法

```js
import { publishNpm, publishGithub, generateChangelog } from '@nathan-adk/aitoearn-publisher';

const log = await generateChangelog({ dir: '/path/to/repo', since: 'v0.1.0' });
await publishNpm({ dir: '/path/to/pkg', publish: false });
await publishGithub({ repo: 'owner/repo', tagName: 'v0.1.0', body: log.markdown, publish: false });
```

## 测试

```bash
bun test
```

## License

MIT
