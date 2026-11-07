---
title: 'A Token Is an Identity: Scope One Per Automation'
author: tortoisewolfe
date: 2026-08-29
slug: scoped-tokens-for-automation
tags:
  - github
  - security
  - automation
categories:
  - security
excerpt: When a script or an assistant acts on your repository, whose name does GitHub record? A short guide to fine-grained tokens and least privilege.
featuredImage: /blog-images/scoped-tokens-for-automation/featured.svg
featuredImageAlt: A dark card reading "A token is an identity" above the words "scope one per automation".
ogImage: /blog-images/scoped-tokens-for-automation/og.png
ogTitle: A Token Is an Identity
ogDescription: Why every automation should get its own narrowly scoped GitHub token, and how to set one up.
twitterCard: summary_large_image
---

# A Token Is an Identity: Scope One Per Automation

Sooner or later something other than you needs to act on your repository: a script, a scheduled job, or an assistant in an editor such as [Cursor](https://cursor.com/). It needs credentials, and those credentials decide who [GitHub](https://github.com/) believes is acting.

> **The core idea.** A token is not a key you copy around. It is an identity. Whatever holds it acts as the person or service it was issued to.

## 🔒 The trap: sharing your own token

Handing over a copy of your Personal Access Token (PAT, a password-like string that lets software act as you) is quick. It breaks three things at once:

- **Attribution.** Every commit and issue the automation creates is recorded under your name.
- **Security.** One leaked copy exposes everything your account can reach.
- **Revocation.** You cannot cut off the automation without also cutting off yourself.

> **Short version.** Shared tokens trade five minutes of setup for a mess you cannot undo.

## Fine-Grained Tokens and Least Privilege

Least privilege means giving a task the smallest set of permissions that lets it finish. GitHub's fine-grained tokens let you choose one repository and a short list of permissions. This table shows a typical set for an automation that opens issues and pull requests.

| Permission    | Access       | Why the automation needs it                      |
| ------------- | ------------ | ------------------------------------------------ |
| Contents      | Read & write | To push a branch with its changes                |
| Pull requests | Read & write | To open the pull request and answer review notes |
| Issues        | Read & write | To open and label issues                         |
| Metadata      | Read-only    | Required by GitHub for every fine-grained token  |

> **Start from nothing.** Add a permission only when something fails without it.

> **Pick an expiry.** A token that lapses in 30 days is a token that cannot be forgotten.

> **Name it for the job.** `issue-bot-grand-daze` tells you what to revoke. `my-token` does not.

## Check who you are before you act

Before an automation does anything, confirm which identity it holds:

```bash
# Shows the account and the token's scopes
gh auth status
```

If the answer is not the identity you meant, stop and fix it. Everything that follows will be recorded under that name.

> **Check, then act.** A one-second status command is cheaper than rewriting history.

## Summary

- One token per automation, one repository per token.
- The smallest permissions that work, with an expiry date.
- Confirm the identity first.
