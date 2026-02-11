#!/usr/bin/env node

/**
 * Test WebSocket Server for DLT Timeline Viewer
 * Sends three types of messages:
 * 1. Trace events: <ID>:<Timestamp>:<Start|End>:<metadata>
 * 2. Registers: REG:<name>:<value>
 * 3. Call graph: <ThreadID>:<FunctionName>:<Timestamp>:<start|end>
 */

const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8083 });

console.log('🚀 WebSocket server running on ws://localhost:8083');
console.log('📊 Sending trace data, registers, and call graph events');

wss.on('connection', (ws) => {
  console.log('✅ Client connected');

  let timeOffset = 0;
  let taskCounter = 0;
  let callDepth = { Thread_0: [], Thread_1: [], Thread_2: [] };

  // Simulate various task traces
  const tasks = [
    { id: 'Task_Init', duration: 50, metadata: 'System initialization' },
    { id: 'Task_Read', duration: 20, metadata: 'Reading sensor data' },
    { id: 'Task_Process', duration: 80, metadata: 'Processing algorithms' },
    { id: 'Task_Write', duration: 30, metadata: 'Writing output' },
    { id: 'Task_Network', duration: 120, metadata: 'Network communication' },
    { id: 'Task_UI', duration: 40, metadata: 'UI rendering' },
  ];

  // Register names
  const registers = ['R0', 'R1', 'R2', 'R3', 'SP', 'PC', 'LR', 'STATUS'];
  
  // Function call simulation
  const functions = {
    Thread_0: ['main', 'init', 'process_data', 'send_packet', 'cleanup'],
    Thread_1: ['worker_thread', 'read_sensor', 'filter_data', 'log_result'],
    Thread_2: ['ui_thread', 'render_frame', 'handle_input', 'update_display']
  };

  // Send periodic register updates
  const registerInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(registerInterval);
      return;
    }

    const reg = registers[Math.floor(Math.random() * registers.length)];
    const value = '0x' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
    const regMessage = `REG:${reg}:${value}`;
    ws.send(regMessage);
    console.log('📟 Register:', regMessage);
  }, 800);

  // Send periodic call graph events
  const callInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(callInterval);
      return;
    }

    const threadIds = Object.keys(functions);
    const threadId = threadIds[Math.floor(Math.random() * threadIds.length)];
    const threadFuncs = functions[threadId];
    
    if (Math.random() > 0.5 && callDepth[threadId].length < 4) {
      // Start a call
      const func = threadFuncs[Math.floor(Math.random() * threadFuncs.length)];
      const callStart = `${threadId}:${func}:${timeOffset.toFixed(2)}:start`;
      callDepth[threadId].push({ func, time: timeOffset });
      ws.send(callStart);
      console.log('📞 Call:', callStart);
    } else if (callDepth[threadId].length > 0) {
      // End a call
      const call = callDepth[threadId].pop();
      const callEnd = `${threadId}:${call.func}:${timeOffset.toFixed(2)}:end`;
      ws.send(callEnd);
      console.log('📞 Call:', callEnd);
    }
  }, 400);

  // Send periodic trace events
  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
      return;
    }

    // Randomly select a task
    const task = tasks[Math.floor(Math.random() * tasks.length)];
    const startTime = timeOffset;
    const endTime = startTime + task.duration + (Math.random() * 20 - 10); // Add some variance

    // Send START event
    const startEvent = `${task.id}:${startTime.toFixed(2)}:start:${task.metadata}`;
    ws.send(startEvent);
    console.log('📤 Sent:', startEvent);

    // Send END event after duration
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const endEvent = `${task.id}:${endTime.toFixed(2)}:end:${task.metadata}`;
        ws.send(endEvent);
        console.log('📤 Sent:', endEvent);
      }
    }, 100);

    // Increment time offset
    timeOffset += Math.random() * 50 + 10; // Random interval between task starts
    taskCounter++;

    // Slow down after many tasks
    if (taskCounter > 1000) {
      clearInterval(interval);
      clearInterval(registerInterval);
      clearInterval(callInterval);
      console.log('✅ Sent 10000 trace events, stopping...');
    }
  }, 100); // Send new task every 1ms

  ws.on('close', () => {
    console.log('❌ Client disconnected');
    clearInterval(interval);
    clearInterval(registerInterval);
    clearInterval(callInterval);
  });

  ws.on('error', (error) => {
    console.error('⚠️  WebSocket error:', error);
    clearInterval(interval);
    clearInterval(registerInterval);
    clearInterval(callInterval);
  });
});

wss.on('error', (error) => {
  console.error('⚠️  Server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down WebSocket server...');
  wss.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
