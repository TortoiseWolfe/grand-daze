---
title: Review Without Rewriting
author: tortoisewolfe
date: 2026-08-28
slug: review-without-rewriting
tags:
  - code-review
  - collaboration
categories:
  - process
excerpt: How to ask for a change on someone else's pull request without putting your own commit on their branch, and which approach fits which kind of change.
featuredImage: /blog-images/review-without-rewriting/featured.svg
featuredImageAlt: A dark card reading "Review without rewriting" above three short lines, one for each way to ask for a change.
ogImage: /blog-images/review-without-rewriting/og.png
ogTitle: Review Without Rewriting
ogDescription: Three ways to ask for a change on a collaborator's pull request, and what each one costs.
twitterCard: summary_large_image
---

# Review Without Rewriting

A collaborator opens a pull request (a proposed change that waits for review before it joins the main code). You spot a problem. The quickest move is to push a fix onto their branch yourself. This post explains why that is usually the wrong move, and what to do instead.

> **Suggest, don't overwrite.** A fixup commit on their branch puts your name on their work and skips the checks they run on their own machine.

## The three approaches

The table below compares the ways a reviewer can ask for a change. Scroll sideways on a phone to see every column.

| Approach                                                        | Does the author keep credit for the change? | Does the author's own toolchain still run?                           | Good for                                        |
| --------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| **Fixup commit** pushed to `feature/their-branch-name-here`     | No. The commit carries the reviewer's name  | No. Their pre-commit hooks never see the change                      | Almost never, for a collaborator's pull request |
| **Inline suggestion** accepted with one click                   | Yes. Accepting it commits as the author     | Partly. It lands on the branch before their local checks have run it | A truly trivial one-line typo                   |
| **Request changes** with a short note saying what to do and why | Yes. The author writes and commits the fix  | Yes. Their editor, hooks and type checks all run                     | Anything with more than one moving part         |

An inline suggestion keeps the author's name on the commit, which is the whole point of the feature. It still lands without the author's local checks, so keep it for trivia.

## Why the note matters

A bare "please fix" costs the author a round trip. A note that names the file, says what is wrong and explains the reason lets them fix it in one pass.

> **Say what and why.** "The button is 36 pixels tall, and our touch-target rule is 44" beats "make this bigger".

## When you can overrule this

Some changes belong to the reviewer: a release the author cannot cut, or a fix to the shared build. Say so in the review, so the author knows why their branch changed.

> **Tell them before it happens.** A surprise commit on your branch feels like a correction. The same commit, announced in advance, feels like help.
