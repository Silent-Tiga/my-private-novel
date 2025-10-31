---
# 讨论帖原型（静态）
# 使用：hugo new forum/discussion/<slug>.md

title: "主题标题"
date: {{ .Date }}
type: "discussion"
category: "板块" # 如：综合讨论、作品讨论、角色讨论
participants: ["楼主", "参与者A", "参与者B"]
tags: ["讨论", "作品名"]
status: "open" # open/closed
posts:
  - id: 1
    author: "楼主"
    time: "{{ .Date }}"
    content: |
      开帖内容，支持 Markdown。
  - id: 2
    author: "参与者A"
    time: "{{ .Date }}"
    content: |
      回复内容示例。
draft: false
---

可在正文区继续补充归档说明或外链。