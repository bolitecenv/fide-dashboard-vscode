# FIDE Backend

Rust backend server for managing embedded project templates and board configurations.

## Features

- **Board Management**: Support for STM32F4, ESP32, Raspberry Pi Pico, nRF52840
- **Project Templates**: Pre-configured project structures for each board
- **File Serving**: Dynamic file generation with template variable substitution
- **REST API**: Simple HTTP API for VS Code extension integration

## API Endpoints

### GET /api/boards
Returns list of available development boards.

**Response:**
```json
[
  {
    "id": "stm32f4_discovery",
    "name": "STM32F4 Discovery",
    "mcu": "STM32F407VG",
    "architecture": "ARM Cortex-M4",
    "ram_kb": 192,
    "flash_kb": 1024,
    "template_path": "templates/stm32f4"
  }
]
```

### POST /api/projects
Create a new project from a board template.

**Request:**
```json
{
  "project_name": "my_project",
  "board_id": "stm32f4_discovery"
}
```

**Response:**
```json
{
  "project_id": "uuid",
  "container_id": "uuid",
  "file_tree": [...],
  "workspace_url": "/workspace/uuid"
}
```

### GET /api/projects/:id/files/*path
Get file content from a project template.

## Running

```bash
cargo run
```

Server will start on `http://localhost:3000`

## Development

```bash
# Build
cargo build

# Run with logs
RUST_LOG=debug cargo run

# Format code
cargo fmt

# Check
cargo check
```

## Template Structure

Templates are stored in `backend/templates/` directory:

```
templates/
├── stm32f4/
│   ├── README.md
│   ├── Makefile
│   └── src/
│       └── main.c
├── esp32/
├── rpi_pico/
└── nrf52840/
```

Templates support variable substitution:
- `{{PROJECT_NAME}}` - Replaced with the user's project name

## Dependencies

- **axum**: Web framework
- **tokio**: Async runtime
- **serde**: Serialization
- **tower-http**: CORS middleware
- **walkdir**: Directory traversal
- **uuid**: Unique ID generation
