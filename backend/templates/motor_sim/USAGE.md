# Motor Simulation Template

A complete Rust-based motor simulation project with WebSocket telemetry.

## What's Included

This template creates a fully functional motor simulation that:

1. **Simulates a DC motor** with realistic physics:
   - Speed control (0-3000 RPM)
   - Torque calculation
   - Temperature dynamics
   - Current consumption
   - Acceleration/deceleration

2. **WebSocket Telemetry Server** (port 8084):
   - Real-time JSON telemetry every 100ms
   - Connection status messages
   - Ready for DLT Timeline viewer integration

3. **Console Logging**:
   - Motor status updates
   - Tracing-based structured logging

## Quick Start

### From VS Code Dashboard

1. Open FIDE Dashboard
2. Select **Motor Simulator (Rust)** board
3. Enter project name
4. Click "Create Project"
5. Open the workspace

### Building and Running

```bash
cargo run
```

The simulation will start immediately and output:
```
INFO Motor: speed=1234 RPM, torque=12.3 Nm, temp=35.2°C, current=1.45A
```

### Connecting to WebSocket

Use the DLT Timeline Viewer or any WebSocket client:

```javascript
const ws = new WebSocket('ws://localhost:8084');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
  // {
  //   "timestamp": 1707652800000,
  //   "speed": 1567.3,
  //   "torque": 15.2,
  //   "temperature": 42.1,
  //   "current": 1.8,
  //   "status": "running"
  // }
};
```

### Viewing in DLT Timeline

1. Open DLT Timeline Viewer from dashboard
2. WebSocket connects to `ws://localhost:8084`
3. See real-time motor telemetry visualization

## Project Structure

```
motor_sim/
├── Cargo.toml          # Dependencies (tokio, websocket, serde)
├── src/
│   ├── main.rs         # Entry point and simulation loop
│   ├── motor.rs        # Motor physics simulation
│   ├── websocket.rs    # WebSocket server implementation
│   └── config.rs       # Configuration parameters
└── README.md
```

## Customization

### Change Simulation Parameters

Edit `src/config.rs`:

```rust
pub struct Config {
    pub max_speed: f64,        // Max RPM (default: 3000)
    pub acceleration: f64,     // RPM/s (default: 500)
    pub websocket_port: u16,   // Port (default: 8084)
}
```

### Add Control Commands

The WebSocket server in `src/websocket.rs` has a message handler ready for control commands:

```rust
Ok(Message::Text(text)) => {
    // Parse commands like: {"command": "set_speed", "value": 2000}
    // Implement your control logic here
}
```

### Modify Motor Physics

See `src/motor.rs` `update()` method to adjust:
- Acceleration curve
- Temperature model
- Current calculation
- Torque characteristics

## Use Cases

- **Algorithm Testing**: Test control algorithms without hardware
- **Telemetry Development**: Develop dashboards and monitoring
- **Education**: Learn motor control concepts
- **Integration Testing**: Test full system with simulated motor
- **Protocol Development**: Design communication protocols

## Integration with FIDE

This template integrates seamlessly with other FIDE features:

- **DLT Timeline Viewer**: Visualize motor telemetry in real-time
- **AI Agent**: Ask AI to modify simulation parameters
- **Build System**: Standard Rust cargo workflow
- **Logging**: Structured logs viewable in dashboard

## Next Steps

After creating your project:

1. Run `cargo run` to start simulation
2. Open DLT Timeline Viewer
3. See real-time motor data
4. Modify parameters in `config.rs`
5. Add your own control logic

## Dependencies

All dependencies are managed by Cargo:

- `tokio` - Async runtime
- `tokio-tungstenite` - WebSocket server
- `serde` / `serde_json` - JSON serialization
- `tracing` - Structured logging
- `futures` - Async utilities

No external tools or libraries required!
