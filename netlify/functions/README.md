# Netlify Functions: Admin Content Management

This directory contains serverless functions to manage content in the GitHub repository via the GitHub API.

## Function: `update-md`

Endpoint: `/.netlify/functions/update-md`

Actions:
- `create_entry`: Create a new collection/volume/chapter Markdown with front matter
- `toggle_comments`: Set `comments_enabled: true|false` in front matter
- `set_cards`: Add a `cards:` array block in front matter

Request body (JSON):
```json
{
  "repo": "Silent-Tiga/my-private-novel",
  "path": "content/novel-collections/<...>.md",
  "action": "create_entry|toggle_comments|set_cards",
  "title": "章节标题",
  "draft": false,
  "frontmatter": { "tags": ["冒险"], "date": "2025-01-01T00:00:00Z" },
  "content": "# 正文...",
  "message": "Create chapter"
}
```

Environment variables (set in Netlify UI):
- `GITHUB_TOKEN`: A Personal Access Token with `repo` scope for private repo access.
- Optional: `REPO_FULL_NAME`: Defaults to `Silent-Tiga/my-private-novel` if omitted.

## Netlify configuration

`netlify.toml` includes:
```
[build]
  command = "hugo"
  publish = "public"
  functions = "netlify/functions"
```

No additional bundler config is required; the function uses native `fetch`.

## Security
- Only authenticated admins/editors can see the UI controls; the function itself requires the server-side `GITHUB_TOKEN`.
- Rate limit and action validation are minimal; consider adding action whitelisting and path validation if needed.