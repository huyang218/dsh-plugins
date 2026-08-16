# dsh-plugins

DeepSeek Harness 插件仓库。

## 结构

```
packages/           通用插件(每个都是可安装的 dsh bundle)
  astock/           A 股行情与技术指标工具(astock_data / astock_indicators / astock_quote / astock_search)
  gateway-compat/   第三方 OpenAI 兼容网关适配:容忍流结束缺失 [DONE] 哨兵
customers/          (预留)每客户一个 bundle:选插件 + 配参数,不放业务代码
```

## 安装到本地 profile

```sh
dsh plugin --profile web add ./packages/astock
```

每个包在 `package.json` 里声明 `dsh.bundle` 指向自己的 `cordis.patch.yml`,安装后由 dsh 自动挂载配置层。

## 约定

- 通用插件不出现客户专属逻辑;部署差异一律走 Config 字段或 Provider 缝。
- object schema 必须显式声明 `additionalProperties`(dsh 工具 schema 编译器强制)。
- 每个插件带 `test/*.test.js` 单元测试(Node 内置 `node --test`,零依赖);根 `npm test` 跑全部,单包 `npm test -w <包名>`。
- 发布给客户前:补 `prepare` 脚本(git 直装场景)或发私有 npm。
