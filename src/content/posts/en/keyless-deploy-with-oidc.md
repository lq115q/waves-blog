---
title: "Keyless Deploys to Azure from GitHub Actions: How OIDC Federation Works"
description: "How this blog deploys to Azure Static Web Apps with zero long-lived secrets on GitHub: workload identity, federated credentials, OIDC Discovery, the two-token dance, and trust boundaries."
pubDate: 2026-07-03
tags: ['security', 'azure', 'oidc', 'ci-cd']
series: "security"
---

The [previous post](/en/posts/strict-csp-on-static-hosting/) covered this blog's **runtime** security headers; this one covers the identity security of the **deployment path**. They're siblings: one constrains what the browser may load, the other constrains what CI is allowed to obtain.

## A tension: you need permissions, but don't want to store keys

To deploy to Azure automatically, CI inevitably needs some credential that grants access. The traditional approach stuffs a **long-lived credential** into GitHub Secrets — either the App Registration's client secret, or the Static Web Apps deployment token. Both work, and both share the same disease:

- **Long-lived**: valid until you manually rotate it, so a single leak (logs, a fork, an accidental `echo`, a third-party action supply chain) is a lasting risk;
- **Painful rotation**: rotating means changing GitHub *and* Azure in sync — easy to miss;
- **Coarse-grained**: one token usually equals "full deploy rights."

The goal is clear: **not a single long-lived secret stored on the GitHub side**. Credentials are no longer "stored" — they're obtained on the fly, after proving identity at runtime. The mechanism that makes this work is Entra ID's **Workload Identity Federation** (OIDC-based).

## First, the "identities" in Entra ID

Entra ID (Azure AD) splits identities into two families:

| Family | Who uses it | Example |
| --- | --- | --- |
| **Human identity** | A real person | The user account you sign in with |
| **Workload identity** | Software / service / script / automation | CI pipelines, background services, containers |

CI clearly uses a **workload identity**. And "workload identity" is an *umbrella category* with two concrete object types underneath:

| Concrete object | When it fits |
| --- | --- |
| **App Registration + Service Principal** | Apps running anywhere, **including outside Azure** (e.g. a GitHub runner) |
| **Managed Identity** | **Only** for resources running *inside* Azure (VM, App Service, Function…) |

This blog uses the former: an **App Registration** (the global app definition) that maps to a **Service Principal** in the tenant (which carries the role assignments).

> Why not the seemingly simpler **Managed Identity**? Because it can only serve resources running *inside* Azure, and the GitHub Actions runner lives *outside* Azure — it can't reach a Managed Identity's credential endpoint. For an "external workload" that wants to be keyless, App Registration + a federated credential is essentially the only option.

## Making the identity keyless: the four fields of a federated credential

A plain App Registration needs its own client secret to authenticate. **Workload Identity Federation** instead attaches a **federated credential** to the app, declaring "I trust external tokens that meet these conditions." The app can then authenticate using a token **signed by someone else** (an external OIDC provider) and hold no secret of its own.

The configuration is just four fields:

| Field | Value in this project | Role |
| --- | --- | --- |
| `name` | Any label | Identifier only, no security meaning |
| `issuer` | `https://token.actions.githubusercontent.com` | **Trust anchor**: the token must be signed by GitHub's OIDC Provider |
| `subject` | `repo:<owner>/<repo>:ref:refs/heads/main` | **Authorization predicate**: the token must come from this repo's main branch |
| `audiences` | `api://AzureADTokenExchange` | **Anti-misuse**: the token's intended audience must be Azure AD |

On the GitHub side, the three identifiers in the workflow live in **Variables, not Secrets**:

```yaml title="deploy.yml (excerpt)"
permissions:
  id-token: write   # key: grants the workflow the ability to request an OIDC token // [!code highlight]
  contents: read

# ...
- name: Azure login (OIDC, no long-lived secret)
  uses: azure/login@v2
  with:
    client-id: ${{ vars.AZURE_CLIENT_ID }}        # vars. not secrets. // [!code highlight]
    tenant-id: ${{ vars.AZURE_TENANT_ID }}
    subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

`client-id` / `tenant-id` / `subscription-id` are all just **public identifiers**, not credentials — leaking them is harmless, because the real credential is the short-lived token exchanged at runtime. This alone captures "zero long-lived secrets": **there is nothing worth stealing in GitHub**.

## The issuer is the trust anchor: how OIDC Discovery verifies signatures

When you configure the federated credential, you **don't** upload GitHub's public key — you only fill in an `issuer` URL. So how does Azure verify the JWT signature? Through standard **OIDC Discovery**. The `issuer` isn't a static label; it's a resolvable trust anchor:

```
① Derive the discovery endpoint from the issuer (OIDC Discovery: issuer + /.well-known/openid-configuration)
   https://token.actions.githubusercontent.com/.well-known/openid-configuration
        │
        ▼
② Fetch that JSON, read its jwks_uri
   { "issuer": "...githubusercontent.com",
     "jwks_uri": "https://token.actions.githubusercontent.com/.well-known/jwks", ... }
        │
        ▼
③ Fetch the key set (JWKS) from jwks_uri — a set of public keys, each with a kid
        │
        ▼
④ Match the JWT header's kid to a key, verify the RS256 signature
   → proves "this token really was signed by GitHub's private key, untampered"
```

Why "discover from one URL" instead of pinning a public key? The core reason is **key rotation**: GitHub periodically rolls its signing keys (new `kid`). Pinning a key would force you to update the credential on every rotation. Discovery + JWKS lets Azure **fetch the currently valid keys at verification time**, so a rotation takes effect automatically — **zero operational effort**.

One more point worth stressing: **Azure doesn't "know" GitHub**. It treats `issuer` as a generic OIDC Provider — the same mechanism can trust GitLab, Terraform Cloud, any self-hosted IdP. The "GitHub Actions" template in the portal just pre-fills `issuer`; there's no GitHub-specific logic underneath. **GitHub has no privilege here.**

Untangling what each field does (easy to conflate):

- **`issuer` governs authenticity**: passing verification only proves GitHub really signed this token — it does **not** distinguish *which* repo or *which* branch;
- **`subject` governs authorization**: this is what narrows trust to "that one repo's main branch." Without it (or with a wildcard), any repo that can make GitHub sign a token could impersonate you;
- **`audiences` guards against replay elsewhere**: prevents a GitHub OIDC token issued for another service from being used to exchange for an Azure token (audience confusion).

## The full authentication flow

Stringing the pieces together, one deploy's authentication sequence looks like this:

```
GitHub Runner              GitHub OIDC Provider        Azure AD (Entra)         Azure ARM / SWA
     │                            │                          │                       │
①id-token:write                   │                          │                       │
     │──request OIDC JWT (aud=api://AzureADTokenExchange)──▶  │                       │
     │◀─② issue JWT (signed by GitHub key, has iss/sub/aud)─│  │                       │
     │                                                        │                       │
③azure/login sends the JWT as client_assertion to token endpoint ─▶│                  │
     │                                              ④ verify sig + check iss/sub/aud   │
     │                                       (fetch GitHub JWKS, match federated cred) │
     │◀────────⑤ return short-lived access_token (ARM scope, ~1h)──│                  │
     │                                                                                │
⑥az staticwebapp secrets list (with access_token)─────────────────────────────────▶│
     │◀───────⑦ return SWA deployment token (in memory only)──────────────────────────│
     │                                                                                │
⑧static-web-apps-deploy uploads dist with that token ─────────────────────────────▶│ live
```

A few easily overlooked points:

1. **`id-token: write` is a prerequisite.** Without it the workflow can't request an OIDC token at all — the chain breaks at step ①.
2. **The JWT claims are not workflow-settable.** `sub=repo:<owner>/<repo>:ref:refs/heads/main` and friends are written by GitHub from the run context and signed with GitHub's **own** private key; a workflow can't forge itself into "a different repo."
3. **Step ③ is standard OAuth 2.0**: `azure/login` uses the client-credentials grant, submitting GitHub's JWT as a `client_assertion` (assertion type `jwt-bearer`) to Azure AD's token endpoint.

## Two planes, and the two-token dance

Here's the **most critical — and most misunderstood — point**: the access token from step ⑤ **cannot deploy content directly**. That's because SWA has two independent planes:

| Plane | Accepts which credential | What it can do |
| --- | --- | --- |
| **Management plane (ARM)** | Azure AD access token (the one OIDC exchanged) | create resources, `listSecrets`, bind domains… |
| **Content plane (content server)** | SWA deployment token (apiKey) | **upload and deploy static files** |

The content server (that `content-xxx.infrastructure.azurestaticapps.net` host) **doesn't accept the ARM token at all**. So the flow needs one more layer: use the ARM token to call `listSecrets` and **exchange it** for the deployment token the content plane accepts. That's steps ⑥⑦:

```yaml title="deploy.yml (excerpt)"
- name: Fetch SWA deployment token (dynamic, via OIDC)
  id: swa
  run: |
    TOKEN=$(az staticwebapp secrets list \
      --name "${{ vars.SWA_NAME }}" \
      --resource-group "${{ vars.SWA_RG }}" \
      --query "properties.apiKey" -o tsv)
    echo "::add-mask::$TOKEN"                  # mask it in logs immediately // [!code highlight]
    echo "token=$TOKEN" >> "$GITHUB_OUTPUT"    # hand to the next step, discard after
```

This gives you a **two-token dance**:

- **Layer 1**: OIDC → ARM access token (proves "I am this repo's main branch"), short-lived ~1h;
- **Layer 2**: use the ARM token to `listSecrets` for the SWA deployment token on the fly — **used once and discarded, never written to GitHub Secrets**.

The result: **GitHub holds neither a client secret nor a deployment token** — both kinds of long-lived credential are eliminated.

## A spectrum of three approaches

Since the deployment token is "exchanged then discarded," it's natural to ask: could we drop it entirely? `static-web-apps-deploy` does have a **native OIDC mode** (leave `azure_static_web_apps_api_token` empty, use `github_id_token` instead) that lets the action authenticate to the content plane with a GitHub identity directly. So there are three approaches:

| Approach | Long-lived secret on GitHub | Deployment-token exposure | Verdict |
| --- | --- | --- | --- |
| Token in GitHub Secrets | **Yes** (long-lived credential on disk) | Persists; a leak is usable indefinitely | Worst |
| **This project**: ARM OIDC + dynamic `listSecrets` | None | Briefly in memory, masked, discarded | Very good |
| Pure OIDC (`github_id_token`) | None | **Never produced** | Equally good; eliminates the credential more thoroughly |

To be fair: **"dynamically fetching the token" is not more secure than "pure OIDC."** Both achieve zero long-lived secrets on GitHub, and pure OIDC doesn't even produce a temporary token. The real security leap is "**not storing the token in Secrets**" — which both of the latter two do.

So why does this project fetch the token dynamically instead of going fully OIDC? Not because it's more secure, but for **fit + reliability**:

- This SWA is a `repo: null` **standalone token-mode** resource (no GitHub integration). Pure OIDC content deployment relies on the SWA-to-repo association, which doesn't directly apply here;
- In practice SWA's native OIDC content deployment was flaky at the time (`InternalServerError` was common), whereas ARM + `listSecrets` rides mature, standard Azure AD federation and is more controllable;
- The permission model is cleaner: the same federated identity can also run any `az` command (bind domains, check state…), rather than being tied to SWA-specific support.

## Reframed: the CI and CD in this chain

`deploy.yml` splits into two jobs — a textbook CI / CD boundary:

| Stage | Definition | In this project |
| --- | --- | --- |
| **CI (Continuous Integration)** | integrate → verify → build a deliverable artifact | `build` job: `astro build` + pagefind → **upload the `blog-dist-<sha>` artifact** |
| **CD (Continuous Deployment)** | publish the verified artifact to an environment | `deploy` job: **download the same artifact** → OIDC login → fetch token → deploy |

Two things worth naming:

- **OIDC login is CD's "authentication prerequisite," not its purpose.** CD's defining action is "deploy"; OIDC is merely the means to obtain authorization.
- **The CI / CD boundary is the artifact handoff.** `build` produces the artifact, `deploy` consumes it, and they're decoupled through nothing but the artifact. `skip_app_build: true` deliberately stops SWA from rebuilding, upholding "**build once, deploy the exact same artifact**" — you ship the very thing you verified.
- Because pushing to `main` goes live automatically with **no human approval gate**, this is strictly Continuous **Deployment**, not the approval-gated Continuous Delivery.

## Security properties, summarized

Where exactly is this "secure"? One table:

| Property | How it's achieved |
| --- | --- |
| **Zero long-lived credentials** | No secret on GitHub; tokens are short-lived (ARM ~1h, deployment token discarded after use) |
| **Strong identity binding** | `subject` pins `repo:<owner>/<repo>:ref:refs/heads/main`; other repos/branches/forks/PRs can't get a token |
| **Unforgeable** | The JWT is signed by GitHub's private key and verified by Azure with the public key; claims can't be tampered |
| **Least privilege** | The app only has `Contributor` on the target SWA resource; even a leaked token can't touch other resources |
| **Auditable** | Every exchange is logged in Entra sign-in logs, with the `subject` |

## Trust boundary: what it protects, what it doesn't

OIDC federation protects against "**credentials being leaked / stolen**," not "the repo being compromised." If an attacker gains write access to `main` (can push malicious commits), this mechanism will **happily issue them a token to deploy** — because at that moment they *are* the "legitimate main branch."

So it must be paired with **branch protection / repo permission management** to form a complete defense. That's exactly why `subject` uses branch mode (`refs/heads/main`) rather than a wildcard: it narrows the trusted source to one single branch.

> A principle, same as the CSP post: **a security boundary you can articulate**. In this deploy chain, "who can deploy" fits in one sentence — only the workflow on this repo's main branch, using a token that expires in minutes and is scoped to a single SWA resource. Trust you can't articulate is trust you can't defend.
