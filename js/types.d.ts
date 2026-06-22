/**
 * 竞迹计时系统 - 类型定义
 *
 * 为 JavaScript 代码提供 TypeScript 类型检查支持
 * 使用 JSDoc 注解提供 IDE 智能提示
 */

/**
 * @typedef {'idle' | 'ready' | 'running' | 'paused' | 'finished'} TimerState
 */

/**
 * @typedef {'single' | 'starter' | 'finish' | 'score'} RoleMode
 */

/**
 * @typedef {'100m' | '200m' | '400m' | '800m' | '1500m' | '5000m' | '10000m' | 'custom'} Distance
 */

/**
 * 房间信息
 * @typedef {Object} Room
 * @property {string} id - 房间ID
 * @property {string} name - 房间名称
 * @property {string} status - 房间状态
 * @property {number} lanes - 道次数量
 * @property {Distance} distance - 比赛距离
 * @property {string} createdAt - 创建时间
 * @property {string} updatedAt - 更新时间
 */

/**
 * 运动员信息
 * @typedef {Object} Athlete
 * @property {number} lane - 道次
 * @property {string} name - 姓名
 * @property {string} [team] - 队伍/学校
 * @property {string} [number] - 号码
 * @property {string} [class] - 班级
 */

/**
 * 成绩记录
 * @typedef {Object} Result
 * @property {string} id - 成绩ID
 * @property {string} roomId - 房间ID
 * @property {number} lane - 道次
 * @property {string} athlete - 运动员姓名
 * @property {number} time - 成绩（秒）
 * @property {Distance} distance - 距离
 * @property {number} [rank] - 名次
 * @property {string} [round] - 轮次
 * @property {string} [group] - 组别
 * @property {string} createdAt - 创建时间
 */

/**
 * WebSocket 消息
 * @typedef {Object} WSMessage
 * @property {string} type - 消息类型
 * @property {string} [roomId] - 房间ID
 * @property {Object} [payload] - 消息数据
 * @property {number} [timestamp] - 时间戳
 */

/**
 * 计时器状态
 * @typedef {Object} TimerStatus
 * @property {TimerState} state - 当前状态
 * @property {number} elapsed - 已过时间（毫秒）
 * @property {number} [lapTime] - 单圈时间
 * @property {number} startTime - 开始时间戳
 */

/**
 * 终点检测结果
 * @typedef {Object} FinishResult
 * @property {number} lane - 道次
 * @property {number} time - 成绩
 * @property {number} frame - 检测帧号
 * @property {string} [confidence] - 置信度
 */

/**
 * 配置选项
 * @typedef {Object} TimerConfig
 * @property {number} lanes - 道次数量
 * @property {Distance} distance - 比赛距离
 * @property {RoleMode} mode - 角色模式
 * @property {'manual' | 'audio'} startMode - 开始模式
 * @property {number} [sensitivity] - 检测灵敏度
 * @property {boolean} [videoEnabled] - 是否启用录像
 * @property {string} [serverUrl] - 服务器地址
 */

/**
 * API 响应格式
 * @typedef {Object} ApiResponse
 * @property {boolean} success - 是否成功
 * @property {string} [message] - 消息
 * @property {*} [data] - 数据
 * @property {string} [error] - 错误信息
 */

/**
 * 统计信息
 * @typedef {Object} Stats
 * @property {number} totalRooms - 总房间数
 * @property {number} totalResults - 总成绩数
 * @property {number} activeRooms - 活跃房间数
 * @property {string[]} distances - 距离列表
 */

// 导出为空，但提供类型定义
export {};
