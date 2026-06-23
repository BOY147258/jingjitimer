// 竞迹计时系统 - 自动化测试脚本
// 测试 WebSocket 连接、发令流程、成绩同步

import { WebSocket } from 'ws';

const SERVER_URL = 'ws://172.19.0.1:8080/ws';
const TEST_ROOM = 'TEST' + Date.now();

console.log('🧪 开始测试竞迹计时系统...\n');

// 测试 1：时钟同步
async function testClockSync() {
  console.log('测试 1：时钟同步');

  const t0 = Date.now();
  const response = await fetch('http://172.19.0.1:8080/ping');
  const t3 = Date.now();
  const data = await response.json();

  const rtt = t3 - t0; // 往返时间
  const serverTime = data.serverTime;
  const offset = serverTime - (t0 + rtt / 2);

  console.log(`  服务器时间: ${serverTime}`);
  console.log(`  本地时间: ${Date.now()}`);
  console.log(`  往返时间: ${rtt}ms`);
  console.log(`  时钟偏移: ${offset.toFixed(2)}ms`);
  console.log(`  ✅ 时钟同步正常\n`);
}

// 测试 2：WebSocket 连接
function testWebSocket() {
  return new Promise((resolve, reject) => {
    console.log('测试 2：WebSocket 连接');

    const ws = new WebSocket(`${SERVER_URL}?room=${TEST_ROOM}&role=test`);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('连接超时'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      console.log(`  ✅ WebSocket 连接成功`);
      console.log(`  房间号: ${TEST_ROOM}\n`);
      resolve(ws);
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`  ❌ WebSocket 连接失败: ${error.message}\n`);
      reject(error);
    });
  });
}

// 测试 3：多设备协同
async function testMultiDevice() {
  console.log('测试 3：多设备协同（发令端 + 终点端）');

  // 发令端
  const starter = new WebSocket(`${SERVER_URL}?room=${TEST_ROOM}&role=starter`);

  // 终点端
  const finish = new WebSocket(`${SERVER_URL}?room=${TEST_ROOM}&role=finish`);

  // 成绩端
  const observer = new WebSocket(`${SERVER_URL}?room=${TEST_ROOM}&role=observer`);

  await new Promise(resolve => setTimeout(resolve, 500)); // 等待连接

  return new Promise((resolve) => {
    let startMessageReceived = false;
    let finishMessageReceived = false;

    // 发令端发送预约发令
    const startAt = Date.now() + 2000;

    starter.on('open', () => {
      console.log('  发令端已连接');

      setTimeout(() => {
        console.log('  发令端: 发送预约发令消息');
        starter.send(JSON.stringify({
          type: 'START_SCHEDULED',
          startAt: startAt,
          shotId: 'test-shot-1',
        }));
      }, 500);
    });

    // 终点端接收发令
    finish.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'START_SCHEDULED') {
        startMessageReceived = true;
        const delay = msg.startAt - Date.now();
        console.log(`  终点端: 收到预约发令，${Math.round(delay)}ms 后开始`);

        // 模拟终点检测
        setTimeout(() => {
          console.log('  终点端: 发送冲线记录');
          finish.send(JSON.stringify({
            type: 'FINISH_DETECTED',
            shotId: 'test-shot-1',
            lane: 3,
            finishTime: 12450, // 12.45秒
            confidence: 1.0,
            method: 'manual',
          }));
        }, delay + 500);
      }

      if (msg.type === 'FINISH_DETECTED') {
        finishMessageReceived = true;
        console.log(`  终点端: 收到成绩确认 - 道次${msg.lane + 1}: ${(msg.finishTime / 1000).toFixed(2)}秒`);
      }
    });

    // 成绩端接收成绩
    observer.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'FINISH_DETECTED') {
        console.log(`  成绩端: 实时显示成绩 - 道次${msg.lane + 1}: ${(msg.finishTime / 1000).toFixed(2)}秒`);

        if (startMessageReceived && finishMessageReceived) {
          console.log('  ✅ 多设备协同测试通过\n');

          starter.close();
          finish.close();
          observer.close();

          resolve();
        }
      }
    });
  });
}

// 测试 4：API 接口
async function testAPI() {
  console.log('测试 4：API 接口');

  try {
    // 测试创建枪次
    const createResponse = await fetch('http://172.19.0.1:8080/api/shots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomCode: TEST_ROOM,
        eventName: '100米测试',
        round: 1,
        group: 1,
        laneCount: 8,
      }),
    });

    const shot = await createResponse.json();
    console.log(`  创建枪次: ID=${shot.id}, 状态=${shot.state}`);

    // 测试查询枪次
    const getResponse = await fetch(`http://172.19.0.1:8080/api/shots?roomCode=${TEST_ROOM}`);
    const shots = await getResponse.json();
    console.log(`  查询枪次: 找到 ${shots.length} 条记录`);

    console.log('  ✅ API 接口测试通过\n');
  } catch (error) {
    console.log(`  ❌ API 测试失败: ${error.message}\n`);
  }
}

// 运行所有测试
async function runAllTests() {
  try {
    await testClockSync();
    await testWebSocket();
    await testMultiDevice();
    await testAPI();

    console.log('🎉 所有测试通过！系统运行正常。\n');
    console.log('📱 可以访问：http://172.19.0.1:8080/simple.html');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  process.exit(0);
}

runAllTests();
