---
title: Generate a Component in One Command
author: tortoisewolfe
date: 2026-08-30
slug: component-generator-tutorial
tags:
  - tutorial
  - components
categories:
  - tutorials
excerpt: Every component in this project needs five files. The generator writes them for you, either through a short set of prompts or from a single command.
featuredImage: /blog-images/component-generator-tutorial/featured.svg
featuredImageAlt: A dark card reading "Generate a component" above a one-line command.
ogImage: /blog-images/component-generator-tutorial/og.png
ogTitle: Generate a Component in One Command
ogDescription: Use the component generator interactively, or give it arguments for scripts and automation.
twitterCard: summary_large_image
---

# Generate a Component in One Command

Each component here is five files: the component, a barrel export (a small file that re-exports it), unit tests, a Storybook story (a live preview page) and an accessibility test. Writing those by hand invites mistakes, so the project ships a generator.

## Run it with prompts

```bash
docker compose exec grand-daze pnpm run generate:component
```

The generator asks for a name and a category, then writes all five files. It also accepts the same answers as arguments on the command-line interface (CLI, the text prompt you type commands into), which is useful when a script runs it. The panel below shows how.

<details>
<summary>CLI Arguments for Automation</summary>

**For scripting and automation:**

```bash
docker compose exec grand-daze pnpm run generate:component -- \
  --name CountdownBanner \
  --category atomic \
  --hasProps true
```

**Available categories:** `subatomic`, `atomic`, `molecular`, `organisms`, `templates`

</details>

## After it runs

Open the new folder, fill in the component and run its tests. The generated tests already pass, so a red test means something you changed.
