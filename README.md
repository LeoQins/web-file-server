# Web 文件服务器

无需登录，功能强大：
- 目录浏览、下载（支持断点续传 Range）
- 上传多个文件（自动避免重名，追加 " (n)" 后缀）
- 删除、重命名、创建文件夹
- 支持中文文件名

## 运行

Windows PowerShell：

```powershell
# 1) 安装依赖（首次）
if (!(Test-Path node_modules)) { npm install }

# 2) 启动服务（默认端口 3000，根目录为 ./storage）
npm start
```

启动后访问：

可选环境变量：

示例：

```powershell
$env:PORT=8080; $env:ROOT_DIR="D:/share"; npm start
```

### 在目录命令行直接启动（跨平台）
在项目根目录下（与 `package.json` 同级）：

```bash
# Linux/macOS
PORT=3000 ROOT_DIR=$(pwd)/storage node src/server.js

# Windows PowerShell
$env:PORT=3000; $env:ROOT_DIR=(Get-Location).Path + "/storage"; node src/server.js
```

## Linux 部署（systemd 开机自启，推荐）

将项目与存储都放在 `/home/userland/web-file-server` 下：

```bash
# 1) 准备目录与代码（已安装 node/npm 且创建了运行用户 userland）
sudo mkdir -p /home/userland/web-file-server
# 把项目代码拷贝到该目录（scp/rsync），例如：
# scp -r ./web-file-server/* user@server:/home/userland/web-file-server/

sudo chown -R userland:userland /home/userland/web-file-server

# 2) 安装依赖与创建存储目录
cd /home/userland/web-file-server
npm install --omit=dev
mkdir -p storage

# 3) 创建 systemd 服务
which node  # 常见为 /usr/bin/node

sudo tee /etc/systemd/system/web-file-server.service >/dev/null <<'EOF'
[Unit]
Description=Simple Web File Server
After=network.target

[Service]
Type=simple
User=userland
Group=userland
WorkingDirectory=/home/userland/web-file-server
Environment=PORT=3000
Environment=ROOT_DIR=/home/userland/web-file-server/storage
# 可选：初始限额（字节；留空或负数=不限）
# Environment=QUOTA_BYTES=10737418240
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now web-file-server

# 4) 验证与日志
systemctl status web-file-server
journalctl -u web-file-server -f
curl http://127.0.0.1:3000/api/list?path=.

# 5) 更新与维护

# 组合命令：查找并停止所有node进程
ps aux | grep -E "(node|npm)" | grep -v grep | awk '{print $2}' | xargs kill

# 更新依赖/代码后重启
cd /home/userland/web-file-server && npm install --omit=dev
sudo systemctl restart web-file-server

# 修改端口/目录/限额后
sudo systemctl daemon-reload
sudo systemctl restart web-file-server
```

可选：Nginx 反向代理到 80/443（简版）

```nginx
server {
	listen 80;
	server_name _;
	location / {
		proxy_pass http://127.0.0.1:3000;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
	}
}
```

## API 简述
// 存储限额

说明：服务器自动避免重名：a.txt → a (1).txt → a (2).txt...

## 注意
- 本服务无鉴权，局域网使用时请留意网络访问权限。
- 删除为递归删除，请谨慎操作。

## 开发

```powershell
npm install
npm run dev
```

目录结构：
- src/server.js：后端服务
- public/index.html：前端单页
- storage/：默认文件根目录（启动时自动创建）

## 存储限额说明
- 页面顶部提供“已用/限额”栏，可输入如 10GB 或字节数并应用；也可点“不限”。
- 上传时会预估新增大小并在超限时拒绝，避免磁盘爆满。

MIT License