# shotsync API 接入与客户端移植指南

本指南梳理了 **shotsync** 改造后的全部 API 接口规范、鉴权机制、错误码体系、数据结构及常见语言（cURL / Python / Node.js / Web）的调用示例，方便你将文件上传、中转同步与临时分享能力快速集成/移植到其他客户端、脚本或系统。

---

## 1. 基础配置与鉴权机制

- **Base URL**: `https://<你的worker域名>.workers.dev`（例如 `https://shotsync.duxinlovefbj.workers.dev`）
- **认证方式**: HTTP 请求头携带 Bearer Token
  ```http
  Authorization: Bearer <AUTH_TOKEN>
  ```
- **权限说明**:
  - 管理接口（上传、列表、删除、生成分享链接、完整文件读取）：**必须**携带 `Authorization`。
  - 公开健康检查探测接口 (`/api/health`）：**无需** Token，供客户端启动自检与能力嗅探。
  - 公开分享访问接口 (`/s/<id>`）：**无需** Token，基于 URL 中的 HMAC 签名（`sig`）和过期时间戳（`exp`）鉴权。
- **API 路由别名**:
  - 所有 `/api/*` 接口同时支持 `/api/v1/*` 别名（例如 `/api/v1/health`、`/api/v1/upload`、`/api/v1/list`）。

---

## 2. 标准错误码体系 (Error Response)

所有失败请求返回统一的 JSON 错误体与对应的 HTTP 状态码：

```json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "file exceeds upload limit (94371840 bytes)"
  }
}
```

### 常见 Error Code 对照表

| Code | HTTP Status | 说明 |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | 未携带 Token 或 Token 错误 |
| `FORBIDDEN` | 403 | 无权操作或分享链接签名被篡改 |
| `ITEM_NOT_FOUND` | 404 | 文件 ID 不存在或已被删除 |
| `METHOD_NOT_ALLOWED` | 405 | 请求 HTTP Method 不被支持 |
| `LINK_EXPIRED` | 410 | 分享链接已超过设置的有效期 |
| `FILE_TOO_LARGE` | 413 | 上传文件超过最大限制（当前为 90MB） |
| `BAD_REQUEST` | 400 | 请求参数缺失或格式不合法 |

---

## 3. API 接口全集

### 3.1 服务健康与能力检查 (Health Check)
- **方法与路径**: `GET /api/health` 或 `GET /api/v1/health`
- **鉴权**: **不需要**（免登录公开探针）
- **返回数据 (JSON)**:
  ```json
  {
    "ok": true,
    "version": "1.0.0",
    "storage": "r2",
    "maxUploadBytes": 94371840,
    "serverTime": 1725120000000,
    "demoMode": false
  }
  ```
- **用途**: 客户端启动时探测连通性，获取最大文件上传上限（`maxUploadBytes`，90MB = 94371840 字节），以便在客户端本地提早拦截超大文件。

---

### 3.2 文件/文本上传 (Upload)
- **方法与路径**: `POST /api/upload` 或 `POST /api/v1/upload`
- **鉴权**: 必须
- **请求格式**: `multipart/form-data`
- **请求头**:
  - `Authorization: Bearer <AUTH_TOKEN>`
  - `x-source` *(可选)*: 来源标识（例如 `pwa`, `cli`, `macos`, `bot`，默认 `unknown`）
  - `x-filename` *(可选)*: 原始文件名（推荐 URI 编码，例如 `encodeURIComponent("报告.pdf")`，避免非 ASCII 乱码）
- **Form Data 字段**:
  - `full` *(必选)*: 文件二进制 Blob / File，或纯文本内容（最大 90MB）
  - `thumb` *(可选)*: 缩略图 Blob（通常为 JPEG 格式；若非图片可不传）
- **返回数据 (JSON)**:
  ```json
  {
    "id": "7999827361234567-abcdef",
    "origName": "报告.pdf"
  }
  ```

---

### 3.3 获取文件列表 (List)
- **方法与路径**: `GET /api/list` 或 `GET /api/v1/list`
- **鉴权**: 必须
- **Query 参数**:
  - `limit` *(可选)*: 每页数量（默认 50，最大 100）
  - `cursor` *(可选)*: 分页游标
- **返回数据 (JSON)**:
  ```json
  {
    "items": [
      {
        "id": "7999827361234567-abcdef",
        "time": 1725075600000,
        "contentType": "application/pdf",
        "hasThumb": false,
        "source": "cli",
        "origName": "报告.pdf",
        "size": 1048576
      }
    ],
    "cursor": null
  }
  ```
  *(注：列表已按上传时间从新到旧倒序排列)*

---

### 3.4 获取 / 下载私有文件 (Get File)
- **方法与路径**: `GET /i/<id>`
- **鉴权**: 必须
- **Query 参数**:
  - `size=thumb` *(可选)*: 获取缩略图（若无缩略图则自动 fallback 到原文件）
  - `size=full` *(可选)*: 获取完整原文件
  - `download=1` *(可选)*: 将 `Content-Disposition` 设置为 `attachment`，提示浏览器直接下载保存
- **响应头**:
  - `Content-Type`: 文件的真实 MIME 类型（如 `application/pdf`, `image/png` 等）
  - `Content-Disposition`: `inline; filename="..."; filename*=UTF-8''...`（若带 `download=1` 则为 `attachment`）
- **返回**: 文件的二进制流 / 文本流。

---

### 3.5 生成公开分享链接 (Mint Share Link)
- **方法与路径**: `POST /api/share/<id>` 或 `POST /api/v1/share/<id>`
- **鉴权**: 必须
- **Query 参数 / JSON Body**:
  - `ttl` 或 `ttlSec` *(可选)*: 链接有效期（单位：秒）。默认 `604800` (7天)，最大支持 365 天。
    - 常见值：`3600` (1小时), `86400` (1天), `604800` (7天), `2592000` (30天)
- **返回数据 (JSON)**:
  ```json
  {
    "url": "https://shotsync.duxinlovefbj.workers.dev/s/7999827361234567-abcdef?exp=1725680400000&sig=4a8f9c1b...",
    "exp": 1725680400000,
    "ttlSec": 604800
  }
  ```

---

### 3.6 访问/下载公开分享文件 (Public Access)
- **方法与路径**: `GET /s/<id>?exp=<exp>&sig=<sig>`
- **鉴权**: **不需要 Token**（免登录公开可访问）
- **Query 参数**:
  - `exp`: 到期时间戳毫秒
  - `sig`: HMAC 签名
  - `download=1` *(可选)*: 触发附件下载
- **说明**: 对方只能访问该单一文件，无法翻阅池子内其它数据。到期后自动返回 `410 Expired`。

---

### 3.7 删除文件 (Delete)
- **方法与路径**: `DELETE /api/img/<id>` 或 `DELETE /api/v1/img/<id>`
- **鉴权**: 必须
- **返回数据 (JSON)**:
  ```json
  {
    "deleted": true
  }
  ```

---

## 4. 常用语言与工具移植示例

### 4.1 Python 客户端封装示例
```python
import os
import requests
import urllib.parse

class ShotSyncClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.max_upload_bytes = 90 * 1024 * 1024

    def health_check(self) -> dict:
        """检查服务端状态并更新最大上传限制"""
        res = requests.get(f"{self.base_url}/api/health", timeout=5)
        res.raise_for_status()
        data = res.json()
        self.max_upload_bytes = data.get("maxUploadBytes", self.max_upload_bytes)
        return data

    def upload_file(self, file_path: str, source: str = "python-app") -> dict:
        """上传任意文件（保留文件名，客户端前置拦截超大文件）"""
        file_size = os.path.getsize(file_path)
        if file_size > self.max_upload_bytes:
            raise ValueError(f"文件大小 ({file_size}B) 超过服务端限制 ({self.max_upload_bytes}B)")

        filename = os.path.basename(file_path)
        headers = {
            **self.headers,
            "x-source": source,
            "x-filename": urllib.parse.quote(filename),
        }
        with open(file_path, "rb") as f:
            files = {"full": (filename, f)}
            res = requests.post(f"{self.base_url}/api/upload", headers=headers, files=files)
            if not res.ok:
                err_data = res.json().get("error", {})
                raise RuntimeError(f"[{err_data.get('code')}] {err_data.get('message')}")
            return res.json()  # {"id": "...", "origName": "..."}

    def share_item(self, item_id: str, ttl_seconds: int = 86400) -> str:
        """生成指定时长的公开分享链接"""
        res = requests.post(
            f"{self.base_url}/api/share/{item_id}",
            headers=self.headers,
            params={"ttl": ttl_seconds},
        )
        res.raise_for_status()
        return res.json()["url"]

    def list_items(self, limit: int = 50, cursor: str = None) -> dict:
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        res = requests.get(f"{self.base_url}/api/list", headers=self.headers, params=params)
        res.raise_for_status()
        return res.json()

    def delete_item(self, item_id: str) -> bool:
        res = requests.delete(f"{self.base_url}/api/img/{item_id}", headers=self.headers)
        return res.ok

# 快速测试
if __name__ == "__main__":
    client = ShotSyncClient(
        base_url="https://shotsync.duxinlovefbj.workers.dev",
        token="YOUR_AUTH_TOKEN"
    )
    print("服务状态:", client.health_check())
```

---

### 4.2 TypeScript / JavaScript SDK
```typescript
export interface HealthInfo {
  ok: boolean;
  version: string;
  storage: string;
  maxUploadBytes: number;
  serverTime: number;
  demoMode: boolean;
}

export class ShotSyncClient {
  private maxUploadBytes = 90 * 1024 * 1024;

  constructor(private baseUrl: string, private token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private get authHeader() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async health(): Promise<HealthInfo> {
    const res = await fetch(`${this.baseUrl}/api/health`);
    if (!res.ok) throw new Error("Health check failed");
    const data = await res.json();
    this.maxUploadBytes = data.maxUploadBytes;
    return data;
  }

  async upload(file: File | Blob, filename?: string): Promise<{ id: string; origName: string }> {
    if (file.size > this.maxUploadBytes) {
      throw new Error(`File exceeds max upload limit (${this.maxUploadBytes} bytes)`);
    }

    const fd = new FormData();
    const name = filename || (file instanceof File ? file.name : "file.bin");
    fd.set("full", file, name);

    const res = await fetch(`${this.baseUrl}/api/upload`, {
      method: "POST",
      headers: {
        ...this.authHeader,
        "x-source": "ts-client",
        "x-filename": encodeURIComponent(name),
      },
      body: fd,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Upload failed: ${res.statusText}`);
    }
    return res.json();
  }

  async share(id: string, ttlSeconds = 86400): Promise<{ url: string; exp: number }> {
    const res = await fetch(`${this.baseUrl}/api/share/${id}?ttl=${ttlSeconds}`, {
      method: "POST",
      headers: this.authHeader,
    });
    if (!res.ok) throw new Error("Share failed");
    return res.json();
  }
}
```
