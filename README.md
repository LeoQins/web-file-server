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
- http://localhost:3000/

可选环境变量：
- PORT：服务端口（默认 3000）
- ROOT_DIR：文件根目录（默认工作目录下 storage）
- QUOTA_BYTES：启动时的存储限额（字节，留空或负数表示不限）。也可在页面实时修改。

示例：

```powershell
$env:PORT=8080; $env:ROOT_DIR="D:/share"; npm start
```

## API 简述
- GET /api/list?path=相对路径
- POST /api/upload (FormData: files[], dirPath)
- POST /api/delete (JSON: { dirPath, name })
- POST /api/mkdir (JSON: { dirPath, name })
- POST /api/rename (JSON: { dirPath, oldName, newName })
- GET /api/download?filePath=相对路径
// 存储限额
- GET /api/quota → { used, limit }（limit 为 null 表示不限）
- POST /api/quota { limit } → 设置限额（字节；负数或 null 为不限）

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