# Watch as a background service

## macOS (launchd)

Save as `~/Library/LaunchAgents/com.agent-bridge.watch.plist` after
`npm install -g github:Mihirokte/agent-skills` (or point
`ProgramArguments` at your clone's `dist/cli.js`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agent-bridge.watch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/agent-bridge</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/agent-bridge.watch.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/agent-bridge.watch.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.agent-bridge.watch.plist
```

## systemd (user)

`~/.config/systemd/user/agent-bridge-watch.service`:

```ini
[Unit]
Description=agent-bridge watch daemon

[Service]
ExecStart=%h/.local/bin/agent-bridge watch
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now agent-bridge-watch
```
