# butter-export

This is a small utility for doing local exports of <a href="https://butter.video">Butter</a> projects. You can also do these in your browser, but this tool lets you do this in the background.

## Running

Pass it a Butter project magic link, which includes both one-time authentication and the project ID. Ask an agent connected to the <a href="https://butter.video/cocreate">Butter MCP</a> to get this.

```bash
npx butter-export https://butter.video/magic/link/to/project --output="/path/to/file.mp4"
```
