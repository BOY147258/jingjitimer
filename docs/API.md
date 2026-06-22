# 竞迹计时器 - API 文档

## 概述

竞迹计时器支持 WebSocket 实时同步和 REST API 两种通信方式。

## WebSocket API

### 连接

```
ws://server:port?room={roomCode}&role={role}&deviceId={deviceId}
```

### 消息格式

```json
{
  "type": "MESSAGE_TYPE",
  "payload": {},
  "timestamp": 1699999999999,
  "roomCode": "1234",
  "deviceId": "device-uuid"
}
```

### 消息类型

#### 发令端 → 终点端

| 类型 | 方向 | 描述 |
|------|------|------|
| `START_RACE` | start → finish | 发令开始 |
| `FALSE_START` | start → finish | 抢跑召回 |
| `COUNTDOWN` | start → finish | 倒计时 |
| `RACE_CONFIG` | start → finish | 比赛配置 |
| `ROOM_LOCKED` | start → finish | 房间已锁定 |

#### 终点端 → 发令端/成绩端

| 类型 | 方向 | 描述 |
|------|------|------|
| `FINISH_TIME` | finish → all | 冲线时间 |
| `DEVICE_READY` | finish → start | 设备就绪 |
| `CONFIG_ACK` | finish → start | 配置确认 |

#### 成绩端

| 类型 | 描述 |
|------|------|
| `RACE_RESULT` | 比赛成绩 |
| `HISTORY_REQUEST` | 请求历史 |
| `EXPORT_REQUEST` | 导出请求 |

### 事件示例

#### 发令
```json
{
  "type": "START_RACE",
  "payload": {
    "timestamp": 1699999999000,
    "raceName": "100米决赛",
    "distance": 100,
    "laneCount": 8
  },
  "roomCode": "1234"
}
```

#### 冲线
```json
{
  "type": "FINISH_TIME",
  "payload": {
    "lane": 1,
    "time": 11500,
    "rank": 1,
    "timestamp": 1700000015000
  },
  "roomCode": "1234",
  "deviceId": "finish-device-1"
}
```

## REST API

### 基础 URL

```
https://jingjitimer.onrender.com/api
```

### 端点

#### GET /api/health

健康检查

**响应:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "connections": 5
}
```

#### POST /api/races

创建比赛记录

**请求体:**
```json
{
  "raceName": "100米决赛",
  "orgName": "XX学校",
  "distance": 100,
  "laneCount": 8,
  "lapCount": 1,
  "results": [
    { "lane": 1, "time": 11500, "rank": 1 },
    { "lane": 2, "time": 11700, "rank": 2 }
  ],
  "timestamp": 1699999999000
}
```

**响应:**
```json
{
  "success": true,
  "id": "race-uuid",
  "timestamp": 1699999999000
}
```

#### GET /api/races

获取比赛记录列表

**查询参数:**
- `limit` - 返回数量（默认50）
- `offset` - 偏移量
- `distance` - 按距离筛选

**响应:**
```json
{
  "races": [...],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### GET /api/races/:id

获取单个比赛详情

#### DELETE /api/races/:id

删除比赛记录

## 错误码

| 码 | 描述 |
|-----|------|
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 404 | 资源不存在 |
| 409 | 冲突（如重复提交） |
| 500 | 服务器错误 |
| 503 | 服务不可用（离线） |

## 离线策略

1. **本地优先**: 数据先保存到 IndexedDB
2. **后台同步**: 网络恢复后自动同步到服务器
3. **冲突解决**: 以服务器数据为准，显示冲突提示

## 连接状态

| 状态 | 描述 |
|------|------|
| `connected` | 已连接 |
| `connecting` | 连接中 |
| `disconnected` | 断开 |
| `reconnecting` | 重连中 |
| `offline` | 离线 |
