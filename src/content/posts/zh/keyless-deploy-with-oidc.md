---
title: "GitHub Actions 无密钥部署 Azure：OIDC 联合身份的原理"
description: "这个博客部署到 Azure Static Web Apps 时如何做到 GitHub 端零长效 secret：从 Entra ID 的 workload identity、federated credential 四要素，到 OIDC Discovery 验签、双层 token 与信任边界。"
pubDate: 2026-07-03
tags: ['security', 'azure', 'oidc', 'ci-cd']
series: "security"
---

[上一篇](/posts/strict-csp-on-static-hosting/)讲了这个博客**运行时**的安全头，这篇讲**部署链路**的身份安全——两者是姊妹篇：一个约束浏览器能加载什么，一个约束 CI 能拿到什么权限。

## 一个矛盾：要权限，又不想存密钥

自动部署到 Azure，CI 必然要一份能访问 Azure 的权限。传统做法是在 GitHub Secrets 里塞一份**长效凭据**——要么是 App Registration 的 client secret，要么是 Static Web Apps 的 deployment token。两者都能用，但都有同一个病：

- **长期有效**：不手动轮换就一直能用，泄露一次（日志、fork、误 `echo`、第三方 action 供应链）就是长期风险；
- **轮换麻烦**：换一次要同步改 GitHub、改 Azure，容易漏；
- **权限粗**：一个 token 往往等于"完整部署权"。

目标很明确：**GitHub 端一个长效 secret 都不存**。凭据不再"存储"，而是每次运行时**现场证明身份后临时获取**。实现它的机制，就是 Entra ID 的 **Workload Identity Federation**（工作负载身份联合，基于 OIDC）。

## 先分清 Entra ID 里的"身份"

Entra ID（Azure AD）里的身份先分两大类：

| 大类 | 谁在用 | 例子 |
| --- | --- | --- |
| **Human identity** | 真人 | 你登录用的用户账户 |
| **Workload identity** | 软件 / 服务 / 脚本 / 自动化 | CI 流水线、后台服务、容器 |

CI 用的当然是 **workload identity**。而 workload identity 是个**伞形分类**，底下有两种具体对象：

| 具体对象 | 适用场景 |
| --- | --- |
| **App Registration + Service Principal** | 任何地方运行的应用，**包括 Azure 外部**（如 GitHub runner） |
| **Managed Identity** | **只**给运行在 Azure 内的资源（VM、App Service、Function…） |

这个博客用的是前者：一个 **App Registration**（全局的应用定义），它在租户里对应一个 **Service Principal**（服务主体，承载角色分配）。

> 为什么不用听起来更省事的 **Managed Identity**？因为它只能自动服务于**跑在 Azure 里**的资源，而 GitHub Actions 的 runner 在 Azure **之外**，拿不到 Managed Identity 的凭据端点。"Azure 外部工作负载"想无密钥，App Registration + federated credential 几乎是唯一选择。

## 让身份"无密钥"：federated credential 四要素

普通 App Registration 要认证得带自己的 client secret。**Workload Identity Federation** 的做法是：给这个 App 配一条 **federated credential**，声明"我信任满足以下条件的外部令牌"，于是它可以用**别人签发的 OIDC 令牌**来认证，自己不再持有任何 secret。

配置只有四个字段：

| 字段 | 本项目的值 | 作用 |
| --- | --- | --- |
| `name` | 任意备注名 | 仅标识，无安全语义 |
| `issuer` | `https://token.actions.githubusercontent.com` | **信任锚**：令牌必须由 GitHub 的 OIDC Provider 签发 |
| `subject` | `repo:<owner>/<repo>:ref:refs/heads/main` | **授权谓词**：令牌必须来自这个仓库的 main 分支 |
| `audiences` | `api://AzureADTokenExchange` | **防串用**：令牌的目标受众必须是 Azure AD |

对应地，GitHub 那边 workflow 里存的三个标识符是放在 **Variables 而不是 Secrets**：

```yaml title="deploy.yml (节选)"
permissions:
  id-token: write   # 关键：授予 workflow 请求 OIDC 令牌的能力 // [!code highlight]
  contents: read

# ...
- name: Azure login (OIDC, no long-lived secret)
  uses: azure/login@v2
  with:
    client-id: ${{ vars.AZURE_CLIENT_ID }}        # vars. 不是 secrets. // [!code highlight]
    tenant-id: ${{ vars.AZURE_TENANT_ID }}
    subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

`client-id` / `tenant-id` / `subscription-id` 都只是**公开标识符**，不是凭据——它们泄露也无所谓，真正的凭据是运行时换来的短效令牌。这一点本身就说明了"零长效 secret"：**GitHub 里根本没有值得偷的东西**。

## issuer 是信任锚：OIDC Discovery 如何自动验签

配 federated credential 时，你**没有**手动上传 GitHub 的公钥，只填了一个 `issuer` URL。Azure 怎么验证 JWT 的签名？答案是标准的 **OIDC Discovery**——`issuer` 不是一个静态标签，而是一个可解析的信任锚：

```
① 从 issuer 拼出发现端点（OIDC Discovery 规范：issuer + /.well-known/openid-configuration）
   https://token.actions.githubusercontent.com/.well-known/openid-configuration
        │
        ▼
② 拉取该 JSON，读出里面的 jwks_uri
   { "issuer": "...githubusercontent.com",
     "jwks_uri": "https://token.actions.githubusercontent.com/.well-known/jwks", ... }
        │
        ▼
③ 从 jwks_uri 拉公钥集（JWKS）——一组带 kid 的公钥
        │
        ▼
④ 用 JWT header 里的 kid 匹配公钥，验 RS256 签名
   → 证明"这 token 确实是 GitHub 用它的私钥签的，且未被篡改"
```

为什么设计成"一个 URL 自动发现"而不是手动配公钥？核心是**公钥轮换**：GitHub 会定期更换签名密钥（换 `kid`）。如果要手动传公钥，每次轮换你都得同步更新配置。Discovery + JWKS 让 Azure 在验签时**动态拉取当前有效公钥**，GitHub 轮换后自动生效，**运维零介入**。

还有一点值得强调：**Azure 并不"认识" GitHub**。它只是把 `issuer` 当成一个标准 OIDC Provider，同样机制可以信任 GitLab、Terraform Cloud、任何自建 IdP。Portal 里那个"GitHub Actions"模板只是帮你预填 `issuer` 而已，底层没有 GitHub 专属逻辑——**GitHub 在这里没有任何特权**。

厘清四个字段的分工（很容易混）：

- **`issuer` 管"真伪"**：验签通过只说明 GitHub 确实签了这个 token，它**不区分**是哪个 repo、哪个分支；
- **`subject` 管"是否授权"**：这才是把信任收窄到"唯一那个仓库的 main 分支"的地方。少了它（或写成通配），任何能让 GitHub 签发 token 的仓库都能冒用；
- **`audiences` 管"防重放到别处"**：防止把签给其他服务的 GitHub OIDC token 拿来换 Azure 令牌（audience confusion）。

## 完整认证流程

把上面几块串起来，一次部署的认证时序是这样的：

```
GitHub Runner              GitHub OIDC Provider        Azure AD (Entra)         Azure ARM / SWA
     │                            │                          │                       │
①id-token:write                   │                          │                       │
     │──请求 OIDC JWT(aud=api://AzureADTokenExchange)──▶     │                       │
     │◀─② 签发 JWT(GitHub 私钥签名，含 iss/sub/aud)──│         │                       │
     │                                                        │                       │
③azure/login 把 JWT 当 client_assertion 发到 token endpoint ─▶│                       │
     │                                              ④ 验签 + 校验 iss/sub/aud          │
     │                                       (拉 GitHub JWKS 验签，比对 federated cred) │
     │◀────────⑤ 返回短效 access_token(ARM 作用域，约 1h)────│                       │
     │                                                                                │
⑥az staticwebapp secrets list（带 access_token）──────────────────────────────────▶│
     │◀───────⑦ 返回 SWA deployment token（仅存在于内存）───────────────────────────│
     │                                                                                │
⑧static-web-apps-deploy 用该 token 上传 dist ─────────────────────────────────────▶│ 上线
```

几个容易忽略的点：

1. **`id-token: write` 是前提**。没有它，workflow 根本无法向 GitHub 请求 OIDC 令牌，整条链断在第 ① 步。
2. **JWT 的 claim 不是 workflow 能填的**。`sub=repo:<owner>/<repo>:ref:refs/heads/main` 这些是 GitHub 根据运行上下文写死并用**自己的私钥**签名的，workflow 无法伪造成"别的仓库"。
3. **第 ③ 步是标准 OAuth 2.0**：`azure/login` 走 client credentials grant，把 GitHub 的 JWT 作为 `client_assertion`（assertion 类型 `jwt-bearer`）提交给 Azure AD 的 token endpoint。

## 两个平面与双层 token

这里有一个**最关键、也最容易误解**的点：第 ⑤ 步换来的 access token **不能直接部署内容**。原因是 SWA 有两个互相独立的平面：

| 平面 | 认什么凭据 | 能干什么 |
| --- | --- | --- |
| **管理平面 (ARM)** | Azure AD access token（就是 OIDC 换来的这个） | 建资源、`listSecrets`、绑域名… |
| **内容平面 (content server)** | SWA deployment token（apiKey） | **上传部署静态文件** |

内容服务器（那台 `content-xxx.infrastructure.azurestaticapps.net`）**根本不认 Azure AD 的 ARM token**。所以流程里必须多一层：用 ARM token 调 `listSecrets`，**换出**内容平面认的那个 deployment token。这就是第 ⑥⑦ 步：

```yaml title="deploy.yml (节选)"
- name: Fetch SWA deployment token (dynamic, via OIDC)
  id: swa
  run: |
    TOKEN=$(az staticwebapp secrets list \
      --name "${{ vars.SWA_NAME }}" \
      --resource-group "${{ vars.SWA_RG }}" \
      --query "properties.apiKey" -o tsv)
    echo "::add-mask::$TOKEN"                  # 立即在日志里打码 // [!code highlight]
    echo "token=$TOKEN" >> "$GITHUB_OUTPUT"    # 传给下一步，用完即弃
```

于是形成**双层 token**：

- **第一层**：OIDC → ARM access token（证明"我是这个仓库的 main 分支"），短效 ~1h；
- **第二层**：用 ARM token 现场 `listSecrets` 取 SWA deployment token，**用完即弃，从不写入 GitHub Secrets**。

结果是 **GitHub 里既没有 client secret，也没有 deployment token**，两种长期凭据全部消除。

## 三种方案的安全谱系

既然 deployment token 是"换出来又用完即弃"的，很自然会问：能不能连它都不要？`static-web-apps-deploy` 确实有一个**原生 OIDC 模式**（把 `azure_static_web_apps_api_token` 留空、改用 `github_id_token`），让 action 用 GitHub 身份直连内容平面。于是有三种做法：

| 做法 | GitHub 端长效 secret | deployment token 暴露面 | 评价 |
| --- | --- | --- | --- |
| token 存 GitHub Secrets | **有**（长期凭据落地） | 长期存在、泄露即长期可用 | 最差 |
| **本项目**：ARM OIDC + 动态 `listSecrets` | 无 | 运行时短暂在内存、打码、用完即弃 | 很好 |
| 纯 OIDC（`github_id_token`） | 无 | **根本不产生** | 同样好，消除凭据更彻底 |

说句公道话：**"动态取 token"并不比"纯 OIDC"更安全**——两者都做到了 GitHub 端零长效 secret，纯 OIDC 甚至连临时 token 都不产生。真正的安全飞跃在于"**不把 token 存进 Secrets**"，而后两者都做到了。

那本项目为什么选"动态取 token"而不是更彻底的纯 OIDC？不是因为更安全，而是**适配 + 可靠**：

- 这个 SWA 是 `repo: null` 的**独立 token 模式**资源（没连 GitHub 集成），纯 OIDC 内容部署依赖 SWA 与仓库的关联关系，对它并不直接适用；
- 实践中 SWA 原生 OIDC 内容部署当时不够稳（`InternalServerError` 常见），而 ARM + `listSecrets` 走的是成熟的标准 Azure AD 联合，更可控；
- 权限模型更清晰：同一套联合身份还能跑任意 `az` 命令（绑域名、查状态…），不被 SWA 特定支持绑死。

## 换个视角：这条链里的 CI 与 CD

`deploy.yml` 拆成两个 job，恰好是教科书式的 CI / CD 分界：

| 阶段 | 定义 | 本项目对应 |
| --- | --- | --- |
| **CI（持续集成）** | 集成 → 验证 → 构建出可交付产物 | `build` job：`astro build` + pagefind → **上传 `blog-dist-<sha>` artifact** |
| **CD（持续部署）** | 把验证过的产物发布到环境 | `deploy` job：**下载同一个 artifact** → OIDC 登录 → 取 token → 部署 |

两点值得点出：

- **OIDC 登录是 CD 的"认证前置"，不是目的**。CD 的定义性动作是"部署"，OIDC 只是拿授权的手段。
- **CI / CD 的边界在 artifact 交接处**。`build` 产出 artifact、`deploy` 消费 artifact，两者只通过 artifact 解耦。刻意用 `skip_app_build: true` 让 SWA 端**不重复构建**，坚持 "**build once, deploy the exact same artifact**"——部署的就是验证过的那一份。
- 由于 push 到 `main` 就自动上线、**没有人工审批闸门**，严格说这是 Continuous **Deployment**（持续部署），而非需要人工批准的 Continuous Delivery。

## 安全性质小结

这套机制到底"安全"在哪，一张表收束：

| 性质 | 怎么做到的 |
| --- | --- |
| **零长效凭据** | GitHub 端无 secret；令牌短效（ARM ~1h，deployment token 用完即弃） |
| **强身份绑定** | `subject` 锁死 `repo:<owner>/<repo>:ref:refs/heads/main`，别的仓库/分支/fork/PR 换不到令牌 |
| **不可伪造** | JWT 由 GitHub 私钥签名、Azure 用公钥验签，claim 无法篡改 |
| **最小权限** | App 只在目标 SWA 资源上有 `Contributor`，令牌即便泄露也碰不到别的资源 |
| **可审计** | 每次换令牌都在 Entra 登录日志留痕，带 `subject` 信息 |

## 信任边界：它保护什么，不保护什么

OIDC 联合保护的是"**凭据不被泄露 / 盗用**"，不是"仓库不被入侵"。如果攻击者拿到了对 `main` 分支的写权限（能推恶意 commit），这套机制会**照常给他发令牌部署**——因为此刻他就是"合法的 main 分支"。

所以它必须和**分支保护 / 仓库权限管理**配合，才构成完整防线。这也是 `subject` 用 branch 模式（`refs/heads/main`）而非通配的原因：把可信来源收窄到唯一一个分支。

> 一个原则，和上一篇讲 CSP 时一样：**安全的边界要说得清**。这套部署链里，"谁能部署"可以一句话讲明——只有本仓库 main 分支的 workflow，用一个几分钟就过期、且只对一个 SWA 资源有权的令牌。说不清的信任，就是防不住的信任。
