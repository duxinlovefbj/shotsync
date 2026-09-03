# shotsync API 接入与客户端移植指南

本指南梳理了 **shotsync** 的全部 API 接口规范、分块上传（最高 3GB）、分块下载（断点续传）、鉴权机制、大文件 TTL 约束与常见语言调用示例。

---

## 1. 基础配置与能力指标

- **Base URL**: `https://<你的worker域名>.workers.dev`（例如 `https://shotsync.duxinlovefbj.workers.dev`）
- **认证方式**: HTTP 请求头携带 Bearer Token
  ```http
  Authorization: Bearer <AUTH_TOKEN>
  ```
- **核心规格与限制**:
  - **单次直传上限**: 90 MB（单请求 POST `/api/upload`）
  - **分块上传支持**: **最高 3 GB**（S3 兼容 Multipart API，推荐分块大小 **50 MB**）
  - **分块并发/断点续传**: 客户端可并发上传分块；需持久化 init 返回的 `id`、`uploadId`、`uploadToken` 和已完成分块的 ETag
  - **分块下载/断点续传**: 支持 HTTP `Range` 头（`206 Partial Content`）
  - **大文件分享时效**: 
    - 普通文件（≤ 500 MB）：最长可分享 **30 天**（默认 7 天）
    - 大文件（> 500 MB）：为保护 10 GB 存储桶容量，分享链接最长有效期自动收紧至 **3 天**（259,200 秒）
- **API 路由别名**:
  - 所有 `/api/*` 接口同时支持 `/api/v1/*` 别名。

---

## 2. 服务探测接口 (Health & Capabilities)

### `GET /api/health` 或 `GET /api/v1/health`
- **鉴权**: **无需 Token**（公开探针）
- **返回数据 (JSON)**:
  ```json
  {
    "ok": true,
    "version": "1.1.0",
    "storage": "r2",
    "maxUploadBytes": 94371840,
    "maxSingleUploadBytes": 20971520,
    "maxTotalFileBytes": 3221225472,
    "recommendedChunkSizeBytes": 20971520,
    "largeFileThresholdBytes": 524288000,
    "largeFileMaxShareTtlSec": 259200,
    "features": {
      "rangeRequests": true,
      "multipartUpload": true
    },
    "serverTime": 1725120000000,
    "demoMode": false
  }
  ```

---

## 3. 大文件分块上传链路 (Multipart Upload, 20MB ~ 3GB)

针对大于 20MB 的大文件，采用 3 步分块传输：

```text
客户端                                     Worker (R2)
  │                                           │
  ├─── 1. POST /api/upload/multipart/init ───>│ (创建分块会话, 返回 uploadId, id)
  │                                           │
  ├─── 2. PUT  /api/upload/multipart/part ────>│ (并发/循环上传每个 20MB 分块, 返回 etag)
  ├───    PUT  /api/upload/multipart/part ────>│
  │                                           │
  └─── 3. POST /api/upload/multipart/complete >│ (提交所有分块的 partNumber+etag, 完成合并)
```

### 3.1 初始化分块上传
- **方法与路径**: `POST /api/upload/multipart/init`
- **鉴权**: 必须
- **请求体 (JSON)**:
  ```json
  {
    "filename": "huge_video.mp4",
    "contentType": "video/mp4",
    "size": 1572864000
  }
  ```
- **返回数据 (JSON)**:
  ```json
  {
    "id": "7999827361234567-abcdef",
    "origName": "huge_video.mp4",
    "uploadId": "IB44gK...xyz",
    "uploadToken": "eyJpZCI6...signature",
    "chunkSize": 20971520,
    "maxTotalBytes": 3221225472
  }
  ```

`uploadToken` 必须原样保存，并在后续三个接口中通过 `X-Multipart-Token` 请求头携带。它绑定了 `id`、`uploadId`、声明文件大小和分块大小，不能由客户端自行修改。

### 3.2 上传单个分块 (20MB)
- **方法与路径**: `PUT /api/upload/multipart/part?id=<id>&uploadId=<uploadId>&partNumber=<N>`
- **鉴权**: 必须
- **请求头**: `X-Multipart-Token: <init 返回的 uploadToken>`；如果提供 `Content-Length`，必须与该分块实际长度一致
- **Query 参数**:
  - `id`: init 返回的文件 ID
  - `uploadId`: init 返回的 uploadId
  - `partNumber`: 分块编号（从 1 开始，1, 2, 3...）
- **请求体**: 该分块的二进制数据流（`application/octet-stream`）
- **分块规则**: 使用 init 返回的 `chunkSize`；除最后一块外必须正好是该大小，最后一块必须正好是剩余字节数。分块编号必须从 1 连续递增，最多 10000 块。
- **返回数据 (JSON)**:
  ```json
  {
    "partNumber": 1,
    "etag": "\"a1b2c3d4e5...\""
  }
  ```

### 3.3 完成合并
- **方法与路径**: `POST /api/upload/multipart/complete`
- **鉴权**: 必须
- **请求头**: `X-Multipart-Token: <init 返回的 uploadToken>`
- **请求体 (JSON)**:
  ```json
  {
    "id": "7999827361234567-abcdef",
    "uploadId": "IB44gK...xyz",
    "parts": [
      { "partNumber": 1, "etag": "\"a1b2c3d4e5...\"" },
      { "partNumber": 2, "etag": "\"f6g7h8i9j0...\"" }
    ]
  }
  ```
- **返回数据 (JSON)**:
  ```json
  {
    "id": "7999827361234567-abcdef",
    "size": 1572864000,
    "etag": "\"combined-etag...\"",
    "origName": "huge_video.mp4"
  }
  ```

### 3.4 取消与中止分块上传
- **方法与路径**: `POST /api/upload/multipart/abort`
- **鉴权**: 必须
- **请求头**: `X-Multipart-Token: <init 返回的 uploadToken>`
- **请求体 (JSON)**: `{"id": "...", "uploadId": "..."}`

取消是幂等的；如果会话已经被 R2 自动清理，也返回成功。

客户端应在每个分块成功后保存 ETag。网络错误只需要重试对应的 `partNumber`；不要因为单个分块失败就立即丢弃整个会话。R2 未完成的 multipart 会话默认在 7 天后自动中止。

---

## 4. 分块下载与多线程/断点续传 (HTTP Range)

无论是私有文件访问（`GET /i/<id>`）还是公开分享链接（`GET /s/<id>?exp=..&sig=..`），均支持标准的 HTTP `Range` 请求头：

### 请求示例
```http
GET /i/7999827361234567-abcdef HTTP/1.1
Host: shotsync.duxinlovefbj.workers.dev
Authorization: Bearer <AUTH_TOKEN>
Range: bytes=0-1048575
```

### 响应示例
```http
HTTP/1.1 206 Partial Content
Content-Type: video/mp4
Content-Range: bytes 0-1048575/1572864000
Content-Length: 1048576
Accept-Ranges: bytes
```

---

## 5. Python 智能客户端移植代码（支持自动判断直传/分块）

下面是最小的顺序上传示例；生产客户端应把 `id`、`uploadId`、`uploadToken` 和 `parts` 持久化，并可并发上传尚未完成的分块。网页端和 Mac 客户端已经这样处理。

```python
import os
import math
import requests
import urllib.parse

class ShotSyncClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.chunk_size = 50 * 1024 * 1024       # 50MB 分块
        self.direct_limit = 90 * 1024 * 1024     # 90MB 内直传
        self.max_file_size = 3 * 1024 * 1024 * 1024 # 3GB 上限

    def upload(self, file_path: str, source: str = "python-app") -> dict:
        """智能上传：<=90MB 直传，>90MB 自动分块，最大 3GB"""
        file_size = os.path.getsize(file_path)
        if file_size > self.max_file_size:
            raise ValueError(f"文件大小 ({file_size}B) 超过 3GB 上限")

        filename = os.path.basename(file_path)

        # 1. 小于 90MB -> 单次直传
        if file_size <= self.direct_limit:
            headers = {
                **self.headers,
                "x-source": source,
                "x-filename": urllib.parse.quote(filename),
            }
            with open(file_path, "rb") as f:
                res = requests.post(f"{self.base_url}/api/upload", headers=headers, files={"full": (filename, f)})
                res.raise_for_status()
                return res.json()

        # 2. 大于 90MB -> 50MB 分块传输
        print(f"文件大于 90MB ({file_size / 1024 / 1024:.1f} MB)，启动 50MB 分块上传...")
        init_res = requests.post(
            f"{self.base_url}/api/upload/multipart/init",
            headers={**self.headers, "x-source": source},
            json={"filename": filename, "contentType": "application/octet-stream", "size": file_size},
        )
        init_res.raise_for_status()
        init_data = init_res.json()
        item_id = init_data["id"]
        upload_id = init_data["uploadId"]
        upload_token = init_data["uploadToken"]

        parts = []
        total_parts = math.ceil(file_size / self.chunk_size)

        try:
            with open(file_path, "rb") as f:
                for part_num in range(1, total_parts + 1):
                    chunk_data = f.read(self.chunk_size)
                    print(f"上传分块 {part_num}/{total_parts} ({len(chunk_data)} bytes)...")
                    part_res = requests.put(
                        f"{self.base_url}/api/upload/multipart/part",
                        headers={**self.headers, "x-multipart-token": upload_token,
                                 "content-type": "application/octet-stream"},
                        params={"id": item_id, "uploadId": upload_id, "partNumber": part_num},
                        data=chunk_data,
                    )
                    part_res.raise_for_status()
                    parts.append(part_res.json())

            # 完成合并
            comp_res = requests.post(
                f"{self.base_url}/api/upload/multipart/complete",
                headers={**self.headers, "x-multipart-token": upload_token},
                json={"id": item_id, "uploadId": upload_id, "parts": parts},
            )
            comp_res.raise_for_status()
            return comp_res.json()

        except Exception as e:
            # 失败取消
            requests.post(
                f"{self.base_url}/api/upload/multipart/abort",
                headers={**self.headers, "x-multipart-token": upload_token},
                json={"id": item_id, "uploadId": upload_id},
            )
            raise e

    def share(self, item_id: str, ttl_seconds: int = 604800) -> str:
        """生成分享链接（>500MB 大文件服务端自动限制为最长 3 天）"""
        res = requests.post(
            f"{self.base_url}/api/share/{item_id}",
            headers=self.headers,
            params={"ttl": ttl_seconds},
        )
        res.raise_for_status()
        return res.json()["url"]
```
