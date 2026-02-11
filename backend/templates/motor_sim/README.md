# {{PROJECT_NAME}} - Motor Simulation

This is a Rust-based motor simulation project that simulates motor control and sends telemetry data via WebSocket.

## Features

- Motor speed control simulation
- Real-time telemetry via WebSocket
- Configurable parameters (speed, torque, etc.)
- Logging to console and WebSocket clients

## Building

```bash
cargo build --release
```

## Running

```bash
cargo run
```

The simulation will start and open a WebSocket server on `ws://localhost:8084`.

## WebSocket Protocol

The server sends register-style messages in DLT viewer compatible format:

```
REG:SPEED:1567.30
REG:TORQUE:25.50
REG:TEMP:45.20
REG:CURRENT:2.30
REG:STATUS:running
```

Each telemetry update sends 5 separate messages (one per register).

### Alternative Formats

The `dlt_format.rs` module provides three formatting options:

1. **Register Format** (default): `REG:NAME:VALUE`
2. **Trace Format**: `ID:Timestamp:event:metadata`
3. **Register Dump**: Single-line format with all values
4. **Chart Format**: `NAME:Timestamp:Value` for chart visualization

To change format, modify `src/main.rs` to use:
- `format_as_dlt_registers()` - Current default (REG:NAME:VALUE)
- `format_as_dlt_trace()` - For DLT timeline view
- `format_as_register_dump()` - Single line output
- `format_as_chart_data()` - For chart view (NAME:timestamp:value)

## Configuration

Edit `src/config.rs` to change simulation parameters:
- Motor max speed
- Update frequency
- WebSocket port
- Simulation step size
